import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { FormsModule } from '@angular/forms';
import {
  CashPosition,
  CreatedMember,
  DashboardSummary,
  GymService,
  MemberRow,
  PaymentProvider,
  PaymentRow,
  Plan,
  StaffCollection,
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
  imports: [CommonModule, RouterLink, FormsModule],
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
  readonly plans = signal<Plan[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly marking = signal<string | null>(null);

  // --- registering a new member (front desk) ---
  readonly newName = signal('');
  readonly newPhone = signal('');
  readonly adding = signal(false);
  /** Held after a successful add so the desk can read the code out loud. */
  readonly justAdded = signal<CreatedMember['member'] | null>(null);

  // --- taking a renewal (front desk) ---
  readonly renewing = signal<MemberRow | null>(null);
  readonly renewPlanId = signal('');
  readonly renewMethod = signal<'cash' | 'qr'>('cash');
  readonly savingRenewal = signal(false);

  /** The door URL to print. Absolute, because it goes on a physical poster. */
  // Money owed / awaiting confirmation
  readonly payments = signal<PaymentRow[]>([]);
  readonly settling = signal<string | null>(null);
  readonly notice = signal('');

  // --- cash the desk is holding ---
  /** Owner's view: who holds cash. Never fetched for staff. */
  readonly collections = signal<StaffCollection[]>([]);
  /** Every account's own outstanding cash, staff included — what they owe the owner. */
  readonly myCash = signal<{ cash_in_hand: string; cash_payments: number } | null>(null);
  readonly handingOver = signal<string | null>(null);
  /** Owner's view: bank vs own hands vs staff pockets. */
  readonly position = signal<CashPosition | null>(null);

  // --- the gym's UPI QR, shown to members on the door screen ---
  readonly payQrUrl = signal('');
  readonly savingQr = signal(false);

  // UPI auto-payment setup
  readonly provider = signal<PaymentProvider | null>(null);
  readonly webhookUrl = signal('');
  readonly showKeys = signal(false);
  readonly keyId = signal('');
  readonly keySecret = signal('');
  readonly webhookSecret = signal('');
  readonly savingKeys = signal(false);
  readonly testing = signal(false);
  readonly testResult = signal('');
  readonly webhookReachable = signal(true);

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
      // Reconcile BEFORE reading payments, so a UPI payment whose webhook was
      // missed (the backend was asleep) shows as paid rather than as something
      // the owner is about to chase for no reason. Failures are ignored: the
      // gateway may not be configured, which is not an error here.
      // Owner-only, so staff must not even ask: a 403 in their console is noise
      // that looks like a fault, and reconciling talks to the gateway on the
      // owner's credentials. isOwner() is the same line the server enforces.
      const owner = this.auth.isOwner();
      if (owner) await this.api.reconcile(gymId).catch(() => undefined);

      const [summary, watchlist, members, today, plans, payments, provider] = await Promise.all([
        this.api.dashboard(gymId),
        this.api.watchlist(gymId, 7),
        this.api.members(gymId),
        this.api.today(gymId),
        this.api.plans(gymId),
        // Staff get only the unsettled rows from this; the server narrows it.
        // Tolerant of failure because a backend that predates that change
        // refuses it outright, and the rest of the console is still useful.
        this.api.payments(gymId).catch(() => []),
        owner
          ? this.api
              .paymentProvider(gymId)
              .catch(() => ({ provider: null, webhookUrl: '', webhookReachable: true }))
          : Promise.resolve({ provider: null, webhookUrl: '', webhookReachable: true }),
      ]);
      this.summary.set(summary);
      this.watchlist.set(watchlist);
      this.members.set(members);
      this.today.set(today);
      this.plans.set(plans);
      this.payments.set(payments);
      this.provider.set(provider.provider);
      this.webhookUrl.set(provider.webhookUrl);
      this.webhookReachable.set(provider.webhookReachable ?? true);
      if (provider.provider) this.keyId.set(provider.provider.key_id);

      // Cash figures last, each swallowing its own failure: they are an extra,
      // and must never be what stops the console rendering. The owner-only
      // report is skipped for staff rather than fetched and refused.
      this.payQrUrl.set(this.auth.activeGym()?.payment_qr_url ?? '');
      this.myCash.set(await this.api.myCashInHand(gymId).catch(() => null));
      if (owner) {
        const [rows, pos] = await Promise.all([
          this.api.collections(gymId).catch(() => []),
          this.api.cashPosition(gymId).catch(() => null),
        ]);
        this.collections.set(rows);
        this.position.set(pos);
      } else {
        this.collections.set([]);
        this.position.set(null);
      }
    } catch {
      this.error.set('Could not load this gym. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * "I have taken their cash." Settles every outstanding cash payment on that
   * person's name, so the report drops to zero and the trail records who
   * received it.
   */
  async takeCash(row: StaffCollection): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym || !row.account_id) return;
    this.handingOver.set(row.account_id);
    this.error.set('');
    try {
      const done = await this.api.handover(gym.id, row.account_id);
      this.notice.set(`Recorded ₹${done.total} received from ${row.account_name}.`);
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record that handover.'));
    } finally {
      this.handingOver.set(null);
    }
  }

  /**
   * Put up the gym's UPI QR. This is what members scan at the door, so until it
   * is set the only way to pay is cash at the desk.
   */
  async savePaymentQr(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym || !this.payQrUrl().trim()) return;
    this.savingQr.set(true);
    this.error.set('');
    try {
      await this.api.savePaymentQr(gym.id, this.payQrUrl().trim());
      this.notice.set('Payment QR saved. Members will see it when they renew at the door.');
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not save that QR.'));
    } finally {
      this.savingQr.set(false);
    }
  }

  /** Total cash the gym is waiting on, across everyone who holds any. */
  readonly cashOutstanding = computed(() =>
    this.collections().reduce((sum, r) => sum + Number(r.cash_in_hand), 0),
  );

  /** Everything still owed or awaiting the owner's confirmation. */
  readonly outstanding = computed(() =>
    this.payments().filter((p) => p.status === 'pending' || p.status === 'pending_verification'),
  );

  /**
   * THE "mark as paid" action.
   *
   * Cash becomes 'collected', a UPI payment the owner has seen land becomes
   * 'verified'. Both record who confirmed it and when — this is the one place a
   * human overrides what the system can see for itself, so it has to be
   * attributable.
   */
  async markPaid(payment: PaymentRow, method: 'cash' | 'qr'): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.settling.set(payment.id);
    this.error.set('');
    try {
      // The method decides where the money ends up, so it is what was chosen at
      // the desk — not how the renewal happened to be booked earlier.
      await this.api.settlePayment(
        gym.id,
        payment.id,
        method === 'cash' ? 'collected' : 'verified',
        undefined,
        method,
      );
      this.notice.set(
        method === 'cash'
          ? `₹${payment.amount} cash from ${payment.full_name} — it is with you now.`
          : `₹${payment.amount} from ${payment.full_name} marked as received by UPI.`,
      );
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not mark that as paid. Please try again.'));
    } finally {
      this.settling.set(null);
    }
  }

  /** Verifies the saved keys against the gateway. Read-only, moves no money. */
  async testKeys(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.testing.set(true);
    this.testResult.set('');
    try {
      const r = await this.api.testPaymentProvider(gym.id);
      this.testResult.set(
        `Keys work — ${r.mode === 'live' ? 'LIVE mode, real money' : 'test mode, no real money'}.` +
          (r.webhookConfigured ? '' : ' No webhook secret saved yet.'),
      );
    } catch (err) {
      this.testResult.set(this.apiMessage(err, 'Those keys did not work.'));
    } finally {
      this.testing.set(false);
    }
  }

  async saveKeys(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.savingKeys.set(true);
    this.error.set('');
    try {
      await this.api.savePaymentProvider(gym.id, {
        keyId: this.keyId().trim(),
        keySecret: this.keySecret().trim(),
        webhookSecret: this.webhookSecret().trim() || undefined,
      });
      // Never keep the secrets in memory once they have been sent.
      this.keySecret.set('');
      this.webhookSecret.set('');
      this.showKeys.set(false);
      this.notice.set('Online payment is connected. Members can now renew by UPI.');
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not save those keys. Please check them.'));
    } finally {
      this.savingKeys.set(false);
    }
  }

  payLabel(p: PaymentRow): string {
    if (p.method === 'cash') return 'Cash — due at the desk';
    if (p.status === 'pending_verification') return 'UPI — member says they paid';
    return 'Online — awaiting the gateway';
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

  /**
   * Register a walk-in. Staff can do this — it is the desk's first job — and the
   * member code that comes back is what the member needs to create their own
   * login, so it is shown until dismissed rather than flashed.
   */
  async addMember(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym || !this.newName().trim() || !this.newPhone().trim()) return;
    this.adding.set(true);
    this.error.set('');
    try {
      const created = await this.api.createMember(gym.id, {
        fullName: this.newName().trim(),
        phone: this.newPhone().trim(),
      });
      this.justAdded.set(created.member);
      this.newName.set('');
      this.newPhone.set('');
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not add that member.'));
    } finally {
      this.adding.set(false);
    }
  }

  openRenewal(member: MemberRow): void {
    this.renewing.set(member);
    this.renewPlanId.set(this.plans()[0]?.id ?? '');
    this.renewMethod.set('cash');
    this.error.set('');
  }

  /** Sell or renew a membership and book the payment against it. */
  async confirmRenewal(): Promise<void> {
    const gym = this.auth.activeGym();
    const member = this.renewing();
    if (!gym || !member || !this.renewPlanId()) return;
    this.savingRenewal.set(true);
    this.error.set('');
    try {
      await this.api.createSubscription(gym.id, member.id, {
        planId: this.renewPlanId(),
        method: this.renewMethod(),
      });
      this.renewing.set(null);
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record that payment.'));
    } finally {
      this.savingRenewal.set(false);
    }
  }

  private apiMessage(err: unknown, fallback: string): string {
    return err instanceof HttpErrorResponse && err.error?.message ? err.error.message : fallback;
  }

  /**
   * "3 days ago" for a timestamp. Used for how long cash has been sitting: an
   * owner who visits weekly needs the age, not the clock time.
   */
  since(value: string | null): string {
    if (!value) return '—';
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days`;
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? 'over a week' : `${weeks} weeks`;
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
