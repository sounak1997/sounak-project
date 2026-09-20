import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface CheckinSummary {
  attendedDays: number;
  openDays: number;
  percentage: number | null;
  periodStart: string;
  periodEnd: string;
}

export interface CheckinState {
  gymName: string;
  recognised: boolean;
  member?: { id: string; fullName: string; memberCode: string; joinedOn: string };
  subscription?: {
    planName: string;
    startDate: string;
    endDate: string;
    isExpired: boolean;
    daysRemaining: number;
  } | null;
  today?: { visitDate: string; checkInAt: string; checkOutAt: string | null; method: string } | null;
  nextAction?: 'check_in' | 'check_out' | 'none';
  summary?: CheckinSummary | null;
}

export interface Candidate {
  id: string;
  fullName: string;
  phoneHint: string | null;
  claimable: boolean;
}

export type ScanOutcome =
  | 'checked_in'
  | 'checked_out'
  | 'duplicate_ignored'
  | 'already_complete'
  | 'no_subscription'
  | 'subscription_expired';

export interface ScanResult {
  outcome: ScanOutcome;
  gymName: string;
  member: { fullName: string };
  visit?: { visitDate: string; checkInAt: string; checkOutAt: string | null } | null;
  subscription?: { planName: string; endDate: string; daysRemaining?: number } | null;
  summary?: CheckinSummary | null;
  gymPhone?: string | null;
}

/**
 * The public door flow. No login anywhere in here.
 *
 * The device token is stored per gym code, because a member who trains at two
 * gyms on the platform holds one token for each, and the backend refuses a
 * token presented against the wrong gym.
 */
@Injectable({ providedIn: 'root' })
export class CheckinService {
  private http = inject(HttpClient);

  private key(gymCode: string): string {
    return `gymDeviceToken:${gymCode}`;
  }

  /** Wrapped: localStorage throws in private windows and when site data is blocked. */
  deviceToken(gymCode: string): string | null {
    try {
      return localStorage.getItem(this.key(gymCode));
    } catch {
      return null;
    }
  }

  private rememberDevice(gymCode: string, token: string): void {
    try {
      localStorage.setItem(this.key(gymCode), token);
    } catch {
      /* The member will be asked for their number again next time. */
    }
  }

  forgetDevice(gymCode: string): void {
    try {
      localStorage.removeItem(this.key(gymCode));
    } catch {
      /* nothing to do */
    }
  }

  /**
   * Called the moment the check-in page loads, which also serves as the wake-up
   * call for the backend.
   *
   * Render's free tier sleeps after 15 minutes and the first request then takes
   * 30-60 seconds. The member is standing at the door, so that wait must not
   * start when they press the button — firing this on load means the service is
   * usually already awake by the time they have read the screen and tapped. No
   * separate ping is needed: this request is the ping.
   */
  state(gymCode: string): Promise<CheckinState> {
    const token = this.deviceToken(gymCode);
    const params: Record<string, string> = { g: gymCode };
    if (token) params['deviceToken'] = token;
    return firstValueFrom(
      this.http.get<{ data: CheckinState }>('/api/gym/checkin/state', { params }),
    ).then((r) => r.data);
  }

  search(gymCode: string, query: string): Promise<{ matchedBy: 'phone' | 'name'; candidates: Candidate[] }> {
    return firstValueFrom(
      this.http.post<{ data: { matchedBy: 'phone' | 'name'; candidates: Candidate[] } }>(
        '/api/gym/checkin/search',
        { gymCode, query },
      ),
    ).then((r) => r.data);
  }

  /** Binds this phone to a member. `verify` is the last 4 digits of their mobile. */
  async claim(gymCode: string, memberId: string, verify: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ data: { deviceToken: string } }>('/api/gym/checkin/claim', {
        gymCode,
        memberId,
        verify,
      }),
    );
    this.rememberDevice(gymCode, res.data.deviceToken);
  }

  /**
   * Marks the visit. The server decides whether this is an arrival or a
   * departure — the client never says, so a reload or a double tap cannot
   * corrupt anything.
   *
   * `clientTime` is sent so a tap made while the backend is waking still
   * records the moment the member actually tapped.
   */
  scan(gymCode: string): Promise<ScanResult> {
    return firstValueFrom(
      this.http.post<{ data: ScanResult }>('/api/gym/checkin', {
        gymCode,
        deviceToken: this.deviceToken(gymCode),
        clientTime: new Date().toISOString(),
      }),
    ).then((r) => r.data);
  }
}

export interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: string;
  description: string | null;
}

export interface CheckoutParams {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  gymName: string;
  planName: string;
  memberName: string;
  memberPhone: string | null;
}

/** Razorpay's Checkout widget, loaded from their CDN at runtime. */
declare const Razorpay: new (options: Record<string, unknown>) => { open(): void };

/**
 * Online renewal by UPI.
 *
 * Confirmation reaches the server three independent ways — this class drives
 * two of them. `confirm()` is the fast path (the signed receipt Checkout hands
 * back). `pollStatus()` is the safety net for when the browser never gets that
 * far, or when the webhook could not be delivered because the free-tier backend
 * was asleep. Both are idempotent server-side, so racing them is safe.
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private http = inject(HttpClient);
  private checkin = inject(CheckinService);
  private scriptLoaded?: Promise<void>;

  plans(gymCode: string): Promise<{ plans: Plan[]; onlinePaymentAvailable: boolean }> {
    return firstValueFrom(
      this.http.get<{ data: { plans: Plan[]; onlinePaymentAvailable: boolean } }>(
        '/api/gym/checkin/plans',
        { params: { g: gymCode } },
      ),
    ).then((r) => r.data);
  }

  /**
   * Loaded on demand rather than in index.html: the door screen is opened on a
   * phone by someone in a hurry, and the overwhelming majority of visits are a
   * check-in, not a payment. No reason to make everyone download a payment SDK.
   */
  private loadCheckout(): Promise<void> {
    if (!this.scriptLoaded) {
      this.scriptLoaded = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => resolve();
        script.onerror = () => {
          this.scriptLoaded = undefined; // let a later attempt retry
          reject(new Error('Could not load the payment window. Check your connection.'));
        };
        document.head.appendChild(script);
      });
    }
    return this.scriptLoaded;
  }

  private start(gymCode: string, planId: string): Promise<{ paymentId: string; checkout: CheckoutParams }> {
    return firstValueFrom(
      this.http.post<{ data: { paymentId: string; checkout: CheckoutParams } }>(
        '/api/gym/checkin/pay/start',
        { gymCode, deviceToken: this.checkin.deviceToken(gymCode), planId },
      ),
    ).then((r) => r.data);
  }

  /**
   * Runs the whole payment. Resolves 'paid' only once the SERVER says so —
   * never on the widget's word alone, since the client cannot be trusted about
   * whether money moved.
   */
  async pay(gymCode: string, planId: string): Promise<'paid' | 'pending' | 'cancelled'> {
    const { paymentId, checkout } = await this.start(gymCode, planId);
    await this.loadCheckout();

    const outcome = await new Promise<'success' | 'dismissed'>((resolve) => {
      const rzp = new Razorpay({
        key: checkout.keyId,
        order_id: checkout.orderId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: checkout.gymName,
        description: `${checkout.planName} membership`,
        prefill: { name: checkout.memberName, contact: checkout.memberPhone ?? '' },
        // UPI first: on a phone this offers GPay / PhonePe / Paytm directly
        // rather than burying them under card entry.
        config: { display: { blocks: {}, sequence: ['block.upi'], preferences: { show_default_blocks: true } } },
        handler: async (response: Record<string, string>) => {
          try {
            await firstValueFrom(
              this.http.post('/api/gym/checkin/pay/confirm', {
                gymCode,
                deviceToken: this.checkin.deviceToken(gymCode),
                paymentId,
                orderId: response['razorpay_order_id'],
                gatewayPaymentId: response['razorpay_payment_id'],
                signature: response['razorpay_signature'],
              }),
            );
          } catch {
            // Confirmation failed, but the money may well have moved. Say
            // nothing here and let the status poll below decide — telling the
            // member "failed" when their account was debited is the worst
            // possible outcome.
          }
          resolve('success');
        },
        modal: { ondismiss: () => resolve('dismissed') },
      });
      rzp.open();
    });

    // Ask the server regardless of what the widget reported. On 'dismissed' the
    // member may still have completed the payment in their UPI app and closed
    // the window before it returned.
    const status = await this.pollStatus(gymCode, paymentId, outcome === 'success' ? 5 : 2);
    if (status === 'verified') return 'paid';
    return outcome === 'dismissed' ? 'cancelled' : 'pending';
  }

  /**
   * Polls until the payment is settled, or gives up.
   *
   * The endpoint reconciles against the gateway before answering, so this is
   * authoritative rather than a read of whatever the webhook happened to have
   * delivered by now.
   */
  async pollStatus(gymCode: string, paymentId: string, attempts = 5): Promise<string> {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await firstValueFrom(
          this.http.get<{ data: { status: string } }>('/api/gym/checkin/pay/status', {
            params: { g: gymCode, deviceToken: this.checkin.deviceToken(gymCode) ?? '', paymentId },
          }),
        );
        if (res.data.status !== 'pending') return res.data.status;
      } catch {
        /* keep trying — a cold-starting backend fails the first call or two */
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
    }
    return 'pending';
  }
}
