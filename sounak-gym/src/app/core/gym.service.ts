import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface DashboardSummary {
  active_members: number;
  active_subscriptions: number;
  expired_subscriptions: number;
  visits_today: number;
  currently_in: number;
  payments_awaiting: number;
  collected_this_month: string;
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
