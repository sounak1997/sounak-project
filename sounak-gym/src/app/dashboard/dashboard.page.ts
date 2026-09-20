import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import {
  DashboardSummary,
  GymService,
  MemberRow,
  Today,
  Watchlist,
} from '../core/gym.service';

/**
 * The owner's console: what needs doing today.
 *
 * Ordered by what the owner acts on rather than by data model — who is in the
 * gym now, who has lapsed and needs a call, then the member list. The renewal
 * numbers are `tel:` links, because "call them to renew" is the actual job.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  private api = inject(GymService);
  readonly auth = inject(AuthService);

  readonly summary = signal<DashboardSummary | null>(null);
  readonly watchlist = signal<Watchlist | null>(null);
  readonly members = signal<MemberRow[]>([]);
  readonly today = signal<Today | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly marking = signal<string | null>(null);

  /** The door URL to print. Absolute, because it goes on a physical poster. */
  readonly posterUrl = signal('');

  constructor() {
    // Reloads whenever the owner switches gym — an owner of two gyms sees each
    // one's numbers without a page refresh.
    effect(() => {
      const gym = this.auth.activeGym();
      if (gym) void this.load(gym.id, gym.gym_code);
    });
  }

  private async load(gymId: string, gymCode: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.posterUrl.set(`${location.origin}/checkin?g=${gymCode}`);
    try {
      const [summary, watchlist, members, today] = await Promise.all([
        this.api.dashboard(gymId),
        this.api.watchlist(gymId, 7),
        this.api.members(gymId),
        this.api.today(gymId),
      ]);
      this.summary.set(summary);
      this.watchlist.set(watchlist);
      this.members.set(members);
      this.today.set(today);
    } catch {
      this.error.set('Could not load this gym. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async markPresent(memberId: string): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.marking.set(memberId);
    try {
      await this.api.markManual(gym.id, memberId);
      await this.load(gym.id, gym.gym_code);
    } catch {
      this.error.set('Could not record that. Please try again.');
    } finally {
      this.marking.set(null);
    }
  }

  time(value: string | null): string {
    return value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  }

  day(value: string | null | undefined): string {
    if (!value) return '—';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  pill(expiry: MemberRow['expiry']): string {
    return {
      active: 'pill--ok',
      expiring: 'pill--warn',
      expired: 'pill--danger',
      none: 'pill--neutral',
    }[expiry];
  }

  expiryLabel(expiry: MemberRow['expiry']): string {
    return { active: 'Active', expiring: 'Expiring', expired: 'Expired', none: 'No plan' }[expiry];
  }
}
