import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';

interface Visit {
  visit_date: string;
  check_in_at: string;
  check_out_at: string | null;
  method: string;
}

interface Payment {
  id: string;
  amount: string;
  method: string;
  status: string;
  created_at: string;
  plan_name: string;
  start_date: string;
  end_date: string;
}

interface Overview {
  membership: { memberId: string; fullName: string; memberCode: string; gymName: string; gymPhone: string | null; gymCode: string };
  subscription: { planName: string; startDate: string; endDate: string; isExpired: boolean; daysRemaining: number } | null;
  summary: { attendedDays: number; openDays: number; percentage: number | null } | null;
  visits: Visit[];
  payments: Payment[];
}

/**
 * The signed-in member's own record.
 *
 * This is the SECOND way in, not the main one: the everyday path stays scanning
 * the door QR, which needs no login at all. This screen exists for the things a
 * scan cannot answer — what have I paid, how often have I actually turned up,
 * when does my membership run out — from any device, anywhere.
 */
@Component({
  selector: 'app-member',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './member.page.html',
  styleUrl: './member.page.scss',
})
export class MemberPage {
  private http = inject(HttpClient);
  private router = inject(Router);
  readonly auth = inject(AuthService);

  readonly overview = signal<Overview | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly activeMemberId = signal<string | null>(null);

  constructor() {
    effect(() => {
      const memberships = this.auth.memberships();
      if (!memberships.length) return;
      const id = this.activeMemberId() ?? memberships[0].member_id;
      if (this.activeMemberId() !== id) this.activeMemberId.set(id);
      void this.load(id);
    });
  }

  private async load(memberId: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: Overview }>(`/api/gym/me/memberships/${memberId}`),
      );
      this.overview.set(res.data);
    } catch {
      this.error.set('Could not load your membership. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  select(memberId: string): void {
    this.activeMemberId.set(memberId);
    void this.load(memberId);
  }

  /** Signed-in members still check in by scanning; this just opens that screen. */
  goToCheckin(): void {
    const gymCode = this.overview()?.membership.gymCode;
    if (gymCode) void this.router.navigate(['/checkin'], { queryParams: { g: gymCode } });
  }

  day(value: string | null | undefined): string {
    if (!value) return '—';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  time(value: string | null): string {
    return value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  }

  payLabel(status: string): string {
    return {
      collected: 'Paid (cash)',
      verified: 'Paid',
      pending: 'Unpaid',
      pending_verification: 'Awaiting confirmation',
      failed: 'Failed',
    }[status] ?? status;
  }

  payPill(status: string): string {
    if (status === 'verified' || status === 'collected') return 'pill--ok';
    if (status === 'failed') return 'pill--danger';
    return 'pill--warn';
  }
}
