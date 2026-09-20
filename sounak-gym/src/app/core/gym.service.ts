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

  members(gymId: string, search = ''): Promise<MemberRow[]> {
    const params: Record<string, string> = {};
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
   * 'cash' is booked as already collected — the note has changed hands at the
   * desk. 'qr' is booked as awaiting verification, because only the owner can
   * see the bank and confirm the money actually landed.
   */
  createSubscription(
    gymId: string,
    memberId: string,
    fields: { planId: string; method: 'cash' | 'qr' },
  ): Promise<unknown> {
    return firstValueFrom(
      this.http.post<{ data: unknown }>(`${this.base(gymId)}/members/${memberId}/subscriptions`, {
        planId: fields.planId,
        payment: {
          method: fields.method,
          status: fields.method === 'cash' ? 'collected' : 'pending_verification',
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
  ): Promise<PaymentRow> {
    return firstValueFrom(
      this.http.post<{ data: PaymentRow }>(`${this.base(gymId)}/payments/${paymentId}/settle`, {
        status,
        reference: reference || undefined,
      }),
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
