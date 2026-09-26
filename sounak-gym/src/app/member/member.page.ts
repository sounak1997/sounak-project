import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { CheckinService, MemberAccountService, ScanResult } from '../core/checkin.service';
import { QrScannerComponent } from '../shared/qr-scanner.component';

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
  imports: [CommonModule, RouterLink, QrScannerComponent],
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

  // In-app scanning
  private checkinApi = inject(CheckinService);
  private accounts = inject(MemberAccountService);
  readonly scanning = signal(false);
  readonly scanBusy = signal(false);
  readonly scanResult = signal<ScanResult | null>(null);
  readonly scanError = signal('');

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

  openScanner(): void {
    this.scanResult.set(null);
    this.scanError.set('');
    this.scanning.set(true);
  }

  closeScanner(): void {
    this.scanning.set(false);
  }

  /**
   * A QR has been decoded. Turn it into a check-in.
   *
   * The poster encodes the check-in URL, so the gym code is a query parameter
   * on it — parsed rather than assumed, because a member will inevitably point
   * this at some other QR and that should say "not this gym's code", not throw.
   */
  async onScanned(raw: string): Promise<void> {
    this.scanning.set(false);
    this.scanBusy.set(true);
    this.scanError.set('');
    try {
      let gymCode: string | null = null;
      try {
        gymCode = new URL(raw, location.origin).searchParams.get('g');
      } catch {
        gymCode = null;
      }
      // Also accept a bare code, in case a gym prints just the code.
      if (!gymCode && /^[A-Za-z0-9_-]{6,}$/.test(raw.trim())) gymCode = raw.trim();

      if (!gymCode) {
        this.scanError.set("That doesn't look like a gym check-in code. Scan the QR by the entrance.");
        return;
      }

      // This browser may never have checked in here. The signed-in session is
      // already proof of who they are, so bind the device silently rather than
      // asking them to identify themselves again.
      if (!this.checkinApi.deviceToken(gymCode)) {
        await this.accounts.bindFromSession(gymCode);
      }

      const result = await this.checkinApi.scan(gymCode);
      this.scanResult.set(result);
      const id = this.activeMemberId();
      if (id) await this.load(id);
    } catch (err) {
      this.scanError.set(
        err instanceof HttpErrorResponse && err.error?.message
          ? err.error.message
          : 'Could not record that. Please try again.',
      );
    } finally {
      this.scanBusy.set(false);
    }
  }

  onScannerFailed(message: string): void {
    this.scanning.set(false);
    this.scanError.set(message);
  }

  scanHeadline(outcome: ScanResult['outcome']): string {
    switch (outcome) {
      case 'checked_in': return "You're checked in";
      case 'checked_out': return 'Checked out';
      case 'duplicate_ignored': return "You're already checked in";
      case 'already_complete': return "That's you done for today";
      case 'no_subscription': return 'No active membership';
      case 'subscription_expired': return 'Your membership has expired';
    }
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
