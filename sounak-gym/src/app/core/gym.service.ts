import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface DashboardSummary {
  active_members: number;
  active_subscriptions: number;
  expired_subscriptions: number;
  visits_today: number;
  currently_in: number;
  /** Absent for a staff account — the server omits the money figures entirely. */
  payments_awaiting?: number;
  /** Absent for a staff account. */
  collected_this_month?: string;
  staffRole: 'owner' | 'staff' | 'platform_admin';
}

export interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: string;
  description: string | null;
  active: boolean;
}

/** One day, week or month of cash the owner has collected from staff. */
export interface HandoverPeriod {
  /** First day of the period, in the gym's own timezone. */
  period_start: string;
  /** Rows are per period AND per route, because the two arrive differently. */
  method: 'cash' | 'upi';
  total: string;
  payments: number;
  last_at: string;
  /**
   * Who the cash was collected from — comma separated for more than one person,
   * and null for UPI, which nobody hands over: it lands in the owner's account
   * directly.
   */
  from_whom: string | null;
}

/** A payment already marked paid — what the owner reviews for mistakes. */
export interface SettledPayment {
  id: string;
  amount: string;
  method: 'cash' | 'qr' | 'gateway';
  status: 'verified' | 'collected';
  verified_at: string | null;
  /** Once handed over, the cash has physically moved and this cannot be undone. */
  handed_over_at: string | null;
  full_name: string;
  plan_name: string;
  end_date: string;
  marked_by_name: string | null;
  marked_by_role: 'owner' | 'staff' | null;
}

/**
 * Where the gym's money is. The four figures are mutually exclusive and together
 * cover everything the gym has taken.
 */
export interface CashPosition {
  /** UPI and gateway payments — already in the gym's bank account. */
  in_bank: string;
  /** Cash the owner holds: their own takings, plus anything handed over to them. */
  cash_with_owner: string;
  /** Cash still in a staff member's pocket. */
  cash_with_staff: string;
  /** Not money yet: owed, or a transfer nobody has confirmed. */
  still_owed: string;
}

/** One person's collections for a gym. `account_id` is null for a member who paid for themselves. */
export interface StaffCollection {
  account_id: string | null;
  account_name: string | null;
  staff_role: 'owner' | 'staff' | null;
  /** Cash taken and not yet handed to the owner — literally in their pocket. */
  cash_in_hand: string;
  cash_payments: number;
  cash_handed_over: string;
  upi_confirmed: string;
  upi_awaiting: string;
  oldest_unsettled_at: string | null;
}

export interface CreatedMember {
  member: { id: string; full_name: string; member_code: string; phone: string | null };
}

export interface WatchlistRow {
  id: string;
  full_name: string;
  phone: string | null;
  plan_name?: string;
  end_date?: string;
  days_remaining?: number;
  joined_on?: string;
}

export interface Watchlist {
  withinDays: number;
  expired: WatchlistRow[];
  expiring: WatchlistRow[];
  neverStarted: WatchlistRow[];
}

export interface MemberRow {
  id: string;
  full_name: string;
  phone: string | null;
  member_code: string;
  photo_id: string | null;
  emergency_contact: string | null;
  notes: string | null;
  status: string;
  plan_name: string | null;
  end_date: string | null;
  days_remaining: number | null;
  expiry: 'none' | 'active' | 'expiring' | 'expired';
  device_count: number;
}

export interface TodayVisit {
  member_id: string;
  full_name: string;
  check_in_at: string;
  check_out_at: string | null;
  method: string;
}

export interface PaymentRow {
  id: string;
  member_id: string;
  full_name: string;
  phone: string | null;
  amount: string;
  method: 'cash' | 'qr' | 'gateway';
  status: 'pending' | 'pending_verification' | 'verified' | 'collected' | 'failed';
  reference: string | null;
  created_at: string;
  plan_name: string;
  end_date: string;
}

/** A payment that has not finished arriving, at whatever stage. */
export interface OpenPayment {
  id: string;
  member_id: string;
  full_name: string;
  phone: string | null;
  plan_name: string;
  end_date: string;
  amount: string;
  method: 'cash' | 'qr' | 'gateway';
  status: string;
  reference: string | null;
  verified_at: string | null;
  created_at: string;
  marked_by_name: string | null;
  marked_by_id: string | null;
  /** unconfirmed -> with_staff | to_check -> (gone, once received) */
  stage: 'unconfirmed' | 'with_staff' | 'to_check';
}

export interface PaymentProvider {
  provider: string;
  key_id: string;
  enabled: boolean;
  webhook_configured: boolean;
  updated_at: string;
}

export interface Today {
  visitDate: string;
  present: number;
  total: number;
  visits: TodayVisit[];
}

/** The owner console's API client. Every path is scoped by gym id. */
@Injectable({ providedIn: 'root' })
export class GymService {
  private http = inject(HttpClient);

  private base(gymId: string): string {
    return `/api/gym/gyms/${gymId}`;
  }

  dashboard(gymId: string): Promise<DashboardSummary> {
    return firstValueFrom(
      this.http.get<{ data: DashboardSummary }>(`${this.base(gymId)}/dashboard`),
    ).then((r) => r.data);
  }

  watchlist(gymId: string, withinDays = 7): Promise<Watchlist> {
    return firstValueFrom(
      this.http.get<{ data: Watchlist }>(`${this.base(gymId)}/expiring`, {
        params: { withinDays },
      }),
    ).then((r) => r.data);
  }

  /**
   * The gym's members.
   *
   * Asks for the server's maximum, because the console filters the list in the
   * browser for instant results — and a filter over a truncated list is worse
   * than no filter: it says "nobody matches" when somebody does.
   */
  members(gymId: string, search = ''): Promise<MemberRow[]> {
    const params: Record<string, string> = { limit: '500' };
    if (search) params['search'] = search;
    return firstValueFrom(
      this.http.get<{ data: MemberRow[] }>(`${this.base(gymId)}/members`, { params }),
    ).then((r) => r.data);
  }

  today(gymId: string): Promise<Today> {
    return firstValueFrom(
      this.http.get<{ data: Today }>(`${this.base(gymId)}/attendance/today`),
    ).then((r) => r.data);
  }

  /** Active plans only — the server already excludes retired ones. */
  plans(gymId: string): Promise<Plan[]> {
    return firstValueFrom(this.http.get<{ data: Plan[] }>(`${this.base(gymId)}/plans`)).then(
      (r) => r.data,
    );
  }

  /** Register an athlete. Name and phone are all the gym needs to start. */
  createMember(gymId: string, fields: { fullName: string; phone: string }): Promise<CreatedMember> {
    return firstValueFrom(
      this.http.post<{ data: CreatedMember }>(`${this.base(gymId)}/members`, fields),
    ).then((r) => r.data);
  }

  /**
   * Sell or renew a membership and record how it was paid for.
   *
   * Both methods are booked as RECEIVED, because in both cases the person at the
   * desk has just seen the money arrive: cash in their hand, or the member's UPI
   * confirmation on their phone. 'cash' settles as collected, 'qr' as verified —
   * exactly what the Paid cash / Paid UPI buttons on the payments list do.
   *
   * These two paths used to disagree: renewing by UPI booked
   * 'pending_verification', so a membership staff had just sold and been paid for
   * showed up under "Not paid yet" and the money appeared nowhere. Selling a
   * membership and confirming a payment are the same act by the same person, so
   * they must land in the same state.
   */
  createSubscription(
    gymId: string,
    memberId: string,
    fields: { planId: string; method: 'cash' | 'qr'; amount?: number },
  ): Promise<unknown> {
    return firstValueFrom(
      this.http.post<{ data: unknown }>(`${this.base(gymId)}/members/${memberId}/subscriptions`, {
        planId: fields.planId,
        // Left out unless the owner actually set one, so the server falls back
        // to the plan's list price. A staff account sending a custom amount is
        // refused server-side — hiding the field is not the control.
        amount: fields.amount,
        payment: {
          method: fields.method,
          status: fields.method === 'cash' ? 'collected' : 'verified',
        },
      }),
    ).then((r) => r.data);
  }

  /**
   * Money the gym is still waiting on.
   *
   * 'pending_verification' is a member saying they paid by UPI QR; only the
   * owner can see the bank, so only the owner can confirm it. 'pending' is a
   * membership sold but not paid for.
   */
  payments(gymId: string, status = ''): Promise<PaymentRow[]> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    return firstValueFrom(
      this.http.get<{ data: PaymentRow[] }>(`${this.base(gymId)}/payments`, { params }),
    ).then((r) => r.data);
  }

  /**
   * Mark a payment as received. THE "mark as paid" action.
   *
   * 'collected' is cash in the drawer; 'verified' is a UPI payment the owner
   * has seen land. Both record who said so and when, because this is the one
   * place a human overrides what the system knows.
   */
  settlePayment(
    gymId: string,
    paymentId: string,
    status: 'collected' | 'verified',
    reference?: string,
    /** How it was actually paid — overrides how the renewal was booked. */
    method?: 'cash' | 'qr',
  ): Promise<PaymentRow> {
    return firstValueFrom(
      this.http.post<{ data: PaymentRow }>(`${this.base(gymId)}/payments/${paymentId}/settle`, {
        status,
        reference: reference || undefined,
        method,
      }),
    ).then((r) => r.data);
  }

  /**
   * Every payment that has not finished arriving — ONE list.
   *
   * Replaces three overlapping ones. With those, confirming a payment moved it
   * from one list to another, so a count went up just after the owner dealt
   * with something. A single list with a stage per row cannot do that.
   */
  openPayments(gymId: string, method: 'cash' | 'upi' | '' = ''): Promise<OpenPayment[]> {
    const params: Record<string, string> = {};
    if (method) params['method'] = method;
    return firstValueFrom(
      this.http.get<{ data: OpenPayment[] }>(`${this.base(gymId)}/payments/open`, { params }),
    ).then((r) => r.data);
  }

  /** Whether UPI auto-payment is switched on, and which key is in use. */
  paymentProvider(gymId: string): Promise<{
    provider: PaymentProvider | null;
    webhookUrl: string;
    webhookReachable: boolean;
  }> {
    return firstValueFrom(
      this.http.get<{
        data: { provider: PaymentProvider | null; webhookUrl: string; webhookReachable: boolean };
      }>(`${this.base(gymId)}/payment-provider`),
    ).then((r) => r.data);
  }

  /**
   * Confirms the saved keys actually work.
   *
   * Otherwise the first sign of a mistyped key is a member at the door with a
   * failed payment. Read-only — it moves no money.
   */
  testPaymentProvider(gymId: string): Promise<{ ok: boolean; keyId: string; mode: 'live' | 'test'; webhookConfigured: boolean }> {
    return firstValueFrom(
      this.http.post<{ data: { ok: boolean; keyId: string; mode: 'live' | 'test'; webhookConfigured: boolean } }>(
        `${this.base(gymId)}/payment-provider/test`,
        {},
      ),
    ).then((r) => r.data);
  }

  /**
   * Connect this gym's own payment account. The keys stay this gym's: money
   * settles to their bank, never through the platform.
   */
  savePaymentProvider(
    gymId: string,
    fields: { keyId: string; keySecret: string; webhookSecret?: string },
  ): Promise<PaymentProvider> {
    return firstValueFrom(
      this.http.put<{ data: PaymentProvider }>(`${this.base(gymId)}/payment-provider`, fields),
    ).then((r) => r.data);
  }

  /**
   * Ask the gateway what happened to payments still showing pending.
   *
   * Needed because a webhook sent while the backend was asleep never arrived.
   * Run when the owner opens this screen, so it costs nothing when there is
   * nothing outstanding.
   */
  reconcile(gymId: string): Promise<{ checked: number; settled: string[] }> {
    return firstValueFrom(
      this.http.post<{ data: { checked: number; settled: string[] } }>(
        `${this.base(gymId)}/payments/reconcile`,
        {},
      ),
    ).then((r) => r.data);
  }

  /** Owner only: who is holding the gym's cash. */
  collections(gymId: string): Promise<StaffCollection[]> {
    return firstValueFrom(
      this.http.get<{ data: StaffCollection[] }>(`${this.base(gymId)}/collections`),
    ).then((r) => r.data);
  }

  /**
   * Owner only: put up (or change) the gym's UPI QR.
   *
   * A URL rather than an upload — the gym already has this image, from their
   * bank's app or a printout, and hosting it here would mean a file store this
   * app does not otherwise need.
   */
  savePaymentQr(gymId: string, paymentQrUrl: string): Promise<unknown> {
    return firstValueFrom(
      this.http.put<{ data: unknown }>(`${this.base(gymId)}`, { paymentQrUrl }),
    ).then((r) => r.data);
  }

  /** Owner only: recently settled payments, newest first. */
  /**
   * Settled payments.
   *
   * `outstanding: true` asks for everything the owner still has to act on, and
   * the server returns it unpaged — a "Got it" hiding on page two is money the
   * owner believes is accounted for and is not. Omit it for the paged record.
   */
  recentPayments(
    gymId: string,
    opts: { outstanding?: boolean; limit?: number; offset?: number } = {},
  ): Promise<{ rows: SettledPayment[]; total: number; offset: number; hasMore: boolean }> {
    const params: Record<string, string> = {};
    if (opts.outstanding) params['outstanding'] = 'true';
    if (opts.limit !== undefined) params['limit'] = String(opts.limit);
    if (opts.offset !== undefined) params['offset'] = String(opts.offset);

    return firstValueFrom(
      this.http.get<{ data: SettledPayment[]; total: number; offset: number; hasMore: boolean }>(
        `${this.base(gymId)}/payments/recent`,
        { params },
      ),
    ).then((r) => ({ rows: r.data, total: r.total, offset: r.offset, hasMore: r.hasMore }));
  }

  /**
   * Owner only: undo a payment marked paid by mistake.
   *
   * Also suspends the membership it activated — the member is back to unpaid, so
   * the door refuses them until it is settled properly.
   */
  reversePayment(gymId: string, paymentId: string): Promise<{ membership_suspended: boolean }> {
    return firstValueFrom(
      this.http.post<{ data: { membership_suspended: boolean } }>(
        `${this.base(gymId)}/payments/${paymentId}/reverse`,
        {},
      ),
    ).then((r) => r.data);
  }

  /** Owner only: bank vs own hands vs staff pockets. */
  cashPosition(gymId: string): Promise<CashPosition> {
    return firstValueFrom(
      this.http.get<{ data: CashPosition }>(`${this.base(gymId)}/cash-position`),
    ).then((r) => r.data);
  }

  /** What the signed-in account is holding — its own figure, staff included. */
  myCashInHand(gymId: string): Promise<{ cash_in_hand: string; cash_payments: number }> {
    return firstValueFrom(
      this.http.get<{ data: { cash_in_hand: string; cash_payments: number } }>(
        `${this.base(gymId)}/my-collections`,
      ),
    ).then((r) => r.data);
  }

  /** Owner only: cash collected over time, grouped by day, week or month. */
  handovers(
    gymId: string,
    period: 'day' | 'week' | 'month',
    method: 'cash' | 'qr' | 'all' = 'cash',
  ): Promise<HandoverPeriod[]> {
    return firstValueFrom(
      this.http.get<{ data: HandoverPeriod[] }>(`${this.base(gymId)}/handovers`, {
        params: { period, method },
      }),
    ).then((r) => r.data);
  }

  /**
   * Owner only: tick a payment off as accounted for. For UPI this is what a
   * handover is for cash — after it, the payment can no longer be undone.
   */
  /**
   * Take in every staff member's cash at once — the owner settling up on a
   * Sunday rather than tapping through each person to say the same thing.
   */
  handoverAllCash(gymId: string): Promise<{ payments: number; total: number; people: number }> {
    return firstValueFrom(
      this.http.post<{ data: { payments: number; total: number; people: number } }>(
        `${this.base(gymId)}/collections/handover-all`, {},
      ),
    ).then((r) => r.data);
  }

  /** Tick off every UPI payment the owner has seen land. */
  closeAllUpiPayments(gymId: string): Promise<{ payments: number; total: number }> {
    return firstValueFrom(
      this.http.post<{ data: { payments: number; total: number } }>(
        `${this.base(gymId)}/payments/close-all`, {},
      ),
    ).then((r) => r.data);
  }

  closePayment(gymId: string, paymentId: string): Promise<SettledPayment> {
    return firstValueFrom(
      this.http.post<{ data: SettledPayment }>(
        `${this.base(gymId)}/payments/${paymentId}/close`,
        {},
      ),
    ).then((r) => r.data);
  }

  /** Owner only: "I have taken their cash." Settles everything they hold. */
  handover(gymId: string, accountId: string): Promise<{ payments: number; total: number }> {
    return firstValueFrom(
      this.http.post<{ data: { payments: number; total: number } }>(
        `${this.base(gymId)}/collections/${accountId}/handover`,
        {},
      ),
    ).then((r) => r.data);
  }

  /**
   * Update a member's details. Available to staff as well as the owner — a
   * corrected phone number or a new emergency contact is desk work.
   */
  updateMember(
    gymId: string,
    memberId: string,
    fields: {
      fullName?: string;
      phone?: string;
      emergencyContact?: string;
      notes?: string;
      status?: 'active' | 'inactive';
    },
  ): Promise<MemberRow> {
    return firstValueFrom(
      this.http.put<{ data: MemberRow }>(`${this.base(gymId)}/members/${memberId}`, fields),
    ).then((r) => r.data);
  }

  /**
   * Upload a member's photo.
   *
   * Sent as multipart rather than a base64 JSON field: a 4MB camera photo
   * becomes ~5.3MB once base64-encoded, and the server re-encodes from the raw
   * buffer anyway.
   */
  uploadMemberPhoto(gymId: string, memberId: string, file: File): Promise<{ photoId: string; url: string }> {
    const form = new FormData();
    form.append('photo', file);
    return firstValueFrom(
      this.http.post<{ data: { photoId: string; url: string } }>(
        `${this.base(gymId)}/members/${memberId}/photo`,
        form,
      ),
    ).then((r) => r.data);
  }

  deleteMemberPhoto(gymId: string, memberId: string): Promise<{ removed: number }> {
    return firstValueFrom(
      this.http.delete<{ data: { removed: number } }>(
        `${this.base(gymId)}/members/${memberId}/photo`,
      ),
    ).then((r) => r.data);
  }

  /**
   * The public URL for a member's photo.
   *
   * Needs no token — the photo id is 128 random bits and is reissued whenever
   * the photo changes, which is what lets a plain <img> render it.
   */
  photoUrl(photoId: string | null): string | null {
    return photoId ? `/api/gym/members/photo/${photoId}` : null;
  }

  /** The path for members without a smartphone — the owner marks them present. */
  markManual(gymId: string, memberId: string): Promise<{ outcome: string }> {
    return firstValueFrom(
      this.http.post<{ data: { outcome: string } }>(`${this.base(gymId)}/attendance/manual`, {
        memberId,
        clientTime: new Date().toISOString(),
      }),
    ).then((r) => r.data);
  }
}
