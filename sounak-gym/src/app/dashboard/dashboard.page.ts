import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { PasswordFieldComponent } from '../shared/password-field.component';
import QRCode from 'qrcode';
import { FormsModule } from '@angular/forms';
import {
  CashPosition,
  CreatedMember,
  DashboardSummary,
  HandoverPeriod,
  GymService,
  MemberRow,
  PaymentProvider,
  PaymentRow,
  Plan,
  SettledPayment,
  StaffCollection,
  Today,
  Watchlist,
} from '../core/gym.service';

/** The minimum the renewal dialog needs: who, and whether they have a plan. */
type RenewTarget = { id: string; full_name: string; expiry?: MemberRow['expiry']; end_date?: string | null };

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
  imports: [CommonModule, RouterLink, FormsModule, PasswordFieldComponent],
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
  readonly renewing = signal<RenewTarget | null>(null);
  readonly renewPlanId = signal('');
  readonly renewMethod = signal<'cash' | 'qr'>('cash');
  /** Blank means "charge the plan's price". Owner-only; the server agrees. */
  readonly renewAmount = signal('');
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

  // --- undoing a wrong "paid" (owner only) ---
  readonly recentPaid = signal<SettledPayment[]>([]);
  readonly reversing = signal<string | null>(null);
  /** Held for confirmation: undoing locks a member out, so it is never one tap. */
  readonly confirmReverse = signal<SettledPayment | null>(null);

  // --- what the owner has collected, over time ---
  readonly handovers = signal<HandoverPeriod[]>([]);
  readonly handoverPeriod = signal<'day' | 'week' | 'month'>('week');
  /** Which money stream the history shows: cash collected, UPI, or both. */
  readonly handoverMethod = signal<'cash' | 'qr' | 'all'>('cash');
  readonly closing = signal<string | null>(null);
  readonly loadingHandovers = signal(false);
  /** Everything collected across the periods shown. */
  readonly handoverTotal = computed(() =>
    this.handovers().reduce((sum, h) => sum + Number(h.total), 0),
  );
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
  /** The poster QR as a data URL, so it can be printed straight from here. */
  readonly posterQr = signal('');

  // Photo capture when registering
  readonly newPhoto = signal<File | null>(null);
  readonly newPhotoPreview = signal('');

  /**
   * Free-text filter over the member list.
   *
   * Matched in the browser rather than round-tripping per keystroke: the list is
   * already loaded, and at the desk with someone waiting, instant beats
   * thorough. It searches everything visible in the row — name, mobile, member
   * code, plan, status — because the desk does not know which of those the
   * person on the other side of the counter will say.
   */
  readonly memberFilter = signal('');

  readonly filteredMembers = computed(() => {
    const q = this.memberFilter().trim().toLowerCase();
    if (!q) return this.members();
    // Digits-only query: match phone loosely, so "9609" finds "+91 96099 87874"
    // and the punctuation a number was typed with never hides it.
    const digits = q.replace(/\D/g, '');
    return this.members().filter((m) => {
      const haystack = [
        m.full_name, m.member_code, m.phone, m.plan_name, m.expiry, m.status,
      ].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(q)) return true;
      return digits.length >= 3 && (m.phone ?? '').replace(/\D/g, '').includes(digits);
    });
  });

  // Editing a member
  readonly editing = signal<MemberRow | null>(null);
  readonly editName = signal('');
  readonly editPhone = signal('');
  readonly editEmergency = signal('');
  readonly editNotes = signal('');
  readonly editStatus = signal<'active' | 'inactive'>('active');
  readonly editPhoto = signal<File | null>(null);
  readonly editPhotoPreview = signal('');
  readonly savingEdit = signal(false);

  /**
   * Only the owner may set a price other than the plan's.
   *
   * Mirrors the server, which refuses a custom amount from a staff account —
   * this hides the field, it does not enforce anything.
   */
  readonly canSetPrice = computed(() => this.auth.activeGym()?.staff_role !== 'staff');

  constructor() {
    // Reloads whenever the owner switches gym — an owner of two gyms sees each
    // one's numbers without a page refresh. `initial` here because a different
    // gym's figures are a genuinely new screen.
    effect(() => {
      const gym = this.auth.activeGym();
      if (gym) void this.load(gym.id, gym.gym_code, true);
    });
  }

  /**
   * Fetches the whole screen. Only for arriving and for switching gym.
   *
   * `initial` is what puts the page into its loading state, and actions pass
   * false — nothing they do warrants replacing the screen with "Loading…" and
   * losing the reader's place. They call the refresh* helpers below instead,
   * which re-fetch only the slices their action can have changed; signals then
   * re-render just the bindings that read those slices.
   */
  private async load(gymId: string, gymCode: string, initial = false): Promise<void> {
    if (initial) this.loading.set(true);
    this.error.set('');
    const poster = `${location.origin}/checkin?g=${gymCode}`;
    this.posterUrl.set(poster);
    // Rendered here rather than shown as a URL to paste into some other QR
    // generator — the poster is the entire member-facing product, and asking an
    // owner to find a third-party site to make it is a strange place to stop.
    QRCode.toDataURL(poster, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => this.posterQr.set(url))
      .catch(() => this.posterQr.set(''));
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
        const [rows, pos, outstanding, page, hist] = await Promise.all([
          this.api.collections(gymId).catch(() => []),
          this.api.cashPosition(gymId).catch(() => null),
          this.api.recentPayments(gymId, { outstanding: true }).catch(() => ({ rows: [], total: 0, offset: 0, hasMore: false })),
          this.api.recentPayments(gymId, { limit: this.paidPageSize, offset: this.paidOffset() })
            .catch(() => ({ rows: [], total: 0, offset: 0, hasMore: false })),
          this.api.handovers(gymId, this.handoverPeriod(), this.handoverMethod()).catch(() => []),
        ]);
        this.collections.set(rows);
        this.position.set(pos);
        this.outstandingPaid.set(outstanding.rows);
        this.recentPaid.set(page.rows);
        this.paidOffset.set(page.offset);
        this.paidTotal.set(page.total);
        this.paidHasMore.set(page.hasMore);
        this.handovers.set(hist);
      } else {
        this.collections.set([]);
        this.position.set(null);
        this.recentPaid.set([]);
        this.outstandingPaid.set([]);
      }
    } catch {
      this.error.set('Could not load this gym. Please try again.');
    } finally {
      if (initial) this.loading.set(false);
    }
  }

  /**
   * Re-reads the money figures and nothing else: the position tiles, who is
   * holding cash, what has been marked paid, and what is still unconfirmed.
   *
   * Everything here is owner-only except the unconfirmed list and the caller's
   * own cash, so staff fetch the two they are allowed and skip the rest rather
   * than collecting 403s.
   */
  private async refreshMoney(gymId: string): Promise<void> {
    const owner = this.auth.isOwner();
    const [payments, mine] = await Promise.all([
      this.api.payments(gymId).catch(() => this.payments()),
      this.api.myCashInHand(gymId).catch(() => this.myCash()),
    ]);
    this.payments.set(payments);
    this.myCash.set(mine);
    if (!owner) return;

    const [rows, pos, outstanding] = await Promise.all([
      this.api.collections(gymId).catch(() => this.collections()),
      this.api.cashPosition(gymId).catch(() => this.position()),
      this.api
        .recentPayments(gymId, { outstanding: true })
        .catch(() => ({ rows: this.outstandingPaid(), total: 0, offset: 0, hasMore: false })),
    ]);
    this.collections.set(rows);
    this.position.set(pos);
    this.outstandingPaid.set(outstanding.rows);
    // Back to page one: settling something changes what the record contains, and
    // holding an old offset would show a page that has shifted underneath it.
    await this.loadPaidPage(0);
    await this.loadHandovers();
  }

  /** Re-reads the member list, the renewal worklist and the headline counts. */
  private async refreshMembers(gymId: string): Promise<void> {
    const [members, watchlist, summary] = await Promise.all([
      this.api.members(gymId).catch(() => this.members()),
      this.api.watchlist(gymId, 7).catch(() => this.watchlist()),
      this.api.dashboard(gymId).catch(() => this.summary()),
    ]);
    this.members.set(members);
    this.watchlist.set(watchlist);
    this.summary.set(summary);
  }

  /**
   * Re-reads the collection history. Its own loader, not the page's: switching
   * day/week/month must not blank the rest of the screen.
   */
  async loadHandovers(
    period?: 'day' | 'week' | 'month',
    method?: 'cash' | 'qr' | 'all',
  ): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym || !this.auth.isOwner()) return;
    if (period) this.handoverPeriod.set(period);
    if (method) this.handoverMethod.set(method);
    this.loadingHandovers.set(true);
    try {
      this.handovers.set(
        await this.api.handovers(gym.id, this.handoverPeriod(), this.handoverMethod()),
      );
    } catch {
      this.handovers.set([]);
    } finally {
      this.loadingHandovers.set(false);
    }
  }

  /** Re-reads the gateway block after its keys change. Owner-only, like the route. */
  private async refreshProvider(gymId: string): Promise<void> {
    const p = await this.api
      .paymentProvider(gymId)
      .catch(() => ({ provider: this.provider(), webhookUrl: this.webhookUrl(), webhookReachable: true }));
    this.provider.set(p.provider);
    this.webhookUrl.set(p.webhookUrl);
    this.webhookReachable.set(p.webhookReachable ?? true);
    if (p.provider) this.keyId.set(p.provider.key_id);
  }

  /** Re-reads today's attendance and the counts that move with it. */
  private async refreshAttendance(gymId: string): Promise<void> {
    const [today, summary] = await Promise.all([
      this.api.today(gymId).catch(() => this.today()),
      this.api.dashboard(gymId).catch(() => this.summary()),
    ]);
    this.today.set(today);
    this.summary.set(summary);
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
      // Their row drops to zero the moment it lands, so the table answers before
      // the round trip; the refresh then reconciles with the server.
      this.collections.update((list) =>
        list.map((r) => (r.account_id === row.account_id ? { ...r, cash_in_hand: '0' } : r)),
      );
      await this.refreshMoney(gym.id);
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

  /**
   * Tick a payment off as accounted for — "yes, this is in my account".
   *
   * After it, Undo is gone for that row, which is the point: an undo button that
   * never expires means a payment is never really settled.
   */
  async closePaid(row: SettledPayment): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.closing.set(row.id);
    this.error.set('');
    try {
      await this.api.closePayment(gym.id, row.id);
      this.notice.set(`₹${row.amount} from ${row.full_name} is checked off.`);
      await this.refreshMoney(gym.id);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not check that off.'));
    } finally {
      this.closing.set(null);
    }
  }

  /**
   * Undo a payment marked paid by mistake, and lock the member out again.
   *
   * Owner only, and confirmed first: this takes away access someone currently
   * has, so it must never happen on a mis-tap.
   */
  async undoPaid(): Promise<void> {
    const gym = this.auth.activeGym();
    const row = this.confirmReverse();
    if (!gym || !row) return;
    this.reversing.set(row.id);
    this.error.set('');
    try {
      const done = await this.api.reversePayment(gym.id, row.id);
      this.notice.set(
        done.membership_suspended
          ? `₹${row.amount} for ${row.full_name} is back to unpaid, and their membership is on hold.`
          : `₹${row.amount} for ${row.full_name} is back to unpaid.`,
      );
      this.confirmReverse.set(null);
      this.recentPaid.update((list) => list.filter((r) => r.id !== row.id));
      await Promise.all([this.refreshMoney(gym.id), this.refreshMembers(gym.id)]);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not undo that payment.'));
    } finally {
      this.reversing.set(null);
    }
  }

  /**
   * The people the owner collects cash from: staff, and only staff.
   *
   * The owner is not at the gym and never takes cash at the desk, so their own
   * row is not something to collect — and a row for members paying online is
   * nobody to collect from at all. Both are dropped rather than shown with a
   * disabled button, which would only raise the question of why it is there.
   */
  /**
   * Staff who are ACTUALLY holding cash right now.
   *
   * Previously every staff member, which meant that once everyone had handed
   * over, this card still listed them with a dash in every column — a table of
   * nothing, on a card whose whole job is to say what is left to do. A to-do
   * list that keeps showing finished work stops being read.
   *
   * Their historical totals have not gone anywhere: they belong on "Money
   * you've accounted for", which is the card for what has already happened.
   */
  readonly staffHoldingCash = computed(() =>
    this.collections().filter(
      (r) => r.staff_role === 'staff' && r.account_id && Number(r.cash_in_hand) > 0,
    ),
  );

  /** Total cash out with staff — what the owner should leave with on a visit. */
  readonly cashOutstanding = computed(() =>
    this.staffHoldingCash().reduce((sum, r) => sum + Number(r.cash_in_hand), 0),
  );

  /**
   * What the unconfirmed rows add up to. Shown on the card that lists them
   * rather than beside the money figures: an unpaid amount is not a place the
   * gym's money sits, it is money that has not arrived.
   */
  readonly unconfirmedTotal = computed(() =>
    this.outstanding().reduce((sum, p) => sum + Number(p.amount), 0),
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
      // Drop it from the unconfirmed list at once — that card is the one the eye
      // is on, and it should empty as the row is dealt with.
      this.payments.update((list) => list.filter((p) => p.id !== payment.id));
      await Promise.all([this.refreshMoney(gym.id), this.refreshMembers(gym.id)]);
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
      await this.refreshProvider(gym.id);
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

  /**
   * Print just the poster.
   *
   * window.print() on the console would produce pages of tables, so the print
   * stylesheet hides everything but the QR card. Nothing to install, and it
   * works from a phone as well as a desktop.
   */
  printPoster(): void {
    window.print();
  }

  // --- photo capture --------------------------------------------------------

  /**
   * `capture="environment"` on the input opens the camera directly on a phone
   * and falls back to a file picker on a desktop, so one control covers the
   * desk taking a picture and someone uploading one later.
   */
  onPhotoPicked(event: Event, which: 'new' | 'edit'): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (!file) return;
    const preview = URL.createObjectURL(file);
    if (which === 'new') {
      this.newPhoto.set(file);
      this.newPhotoPreview.set(preview);
    } else {
      this.editPhoto.set(file);
      this.editPhotoPreview.set(preview);
    }
  }

  clearNewPhoto(): void {
    this.newPhoto.set(null);
    this.newPhotoPreview.set('');
  }

  photoUrl(photoId: string | null): string | null {
    return this.api.photoUrl(photoId);
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }

  // --- editing a member -----------------------------------------------------

  startEdit(m: MemberRow): void {
    this.editing.set(m);
    this.editName.set(m.full_name);
    this.editPhone.set(m.phone ?? '');
    this.editEmergency.set(m.emergency_contact ?? '');
    this.editNotes.set(m.notes ?? '');
    this.editStatus.set(m.status === 'inactive' ? 'inactive' : 'active');
    this.editPhoto.set(null);
    this.editPhotoPreview.set('');
    this.error.set('');
  }

  /**
   * The dates this renewal will actually cover, shown before it is recorded.
   *
   * Mirrors the server's rule (see resolveStartDate): a renewal continues from
   * the day after the last one ended, not from today — unless the whole period
   * would already be over, in which case it starts today. The owner is charging
   * money for a span of days and should see which days those are; getting this
   * silently wrong is how a member ends up short a week.
   *
   * A PREVIEW only. The server computes it again and is the authority.
   */
  readonly renewalPeriod = computed(() => {
    const plan = this.plans().find((p) => p.id === this.renewPlanId());
    if (!plan) return null;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const prevEnd = this.renewing()?.end_date ? this.parseDay(this.renewing()!.end_date!) : null;

    let start = today;
    let continuing = false;
    if (prevEnd) {
      const dayAfter = new Date(prevEnd); dayAfter.setDate(dayAfter.getDate() + 1);
      const wouldEnd = new Date(dayAfter); wouldEnd.setDate(wouldEnd.getDate() + plan.duration_days - 1);
      if (wouldEnd >= today) { start = dayAfter; continuing = true; }
    }
    const end = new Date(start); end.setDate(end.getDate() + plan.duration_days - 1);

    return {
      start, end, continuing,
      // True when the member has been lapsed and is paying for that gap.
      backdated: continuing && start < today,
    };
  });

  /** 'YYYY-MM-DD' as a local date — `new Date(str)` would read it as UTC. */
  private parseDay(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  fmtDay(d: Date): string {
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** The plan's list price, to show beside the custom-amount box. */
  selectedPlanPrice(): string {
    return this.plans().find((p) => p.id === this.renewPlanId())?.price ?? '';
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.editPhoto.set(null);
    this.editPhotoPreview.set('');
  }

  async saveEdit(): Promise<void> {
    const gym = this.auth.activeGym();
    const m = this.editing();
    if (!gym || !m) return;
    this.savingEdit.set(true);
    this.error.set('');
    try {
      await this.api.updateMember(gym.id, m.id, {
        fullName: this.editName().trim(),
        phone: this.editPhone().trim(),
        emergencyContact: this.editEmergency().trim(),
        notes: this.editNotes().trim(),
        status: this.editStatus(),
      });
      const photo = this.editPhoto();
      if (photo) await this.api.uploadMemberPhoto(gym.id, m.id, photo);
      this.notice.set(`${this.editName().trim()} updated.`);
      this.cancelEdit();
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not save those changes.'));
    } finally {
      this.savingEdit.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    const gym = this.auth.activeGym();
    const m = this.editing();
    if (!gym || !m) return;
    try {
      await this.api.deleteMemberPhoto(gym.id, m.id);
      this.editPhotoPreview.set('');
      this.editPhoto.set(null);
      this.editing.set({ ...m, photo_id: null });
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not remove that photo.'));
    }
  }

  // --- accounting for money -------------------------------------------------

  /**
   * UPI payments the owner has not yet ticked off.
   *
   * Cash is excluded because cash becomes accounted for by somebody handing it
   * over, never by ticking a row — see closePayment on the server.
   */
  readonly upiToConfirm = computed(() =>
    this.outstandingPaid().filter((p) => p.method !== 'cash' && !p.handed_over_at),
  );

  readonly upiToConfirmTotal = computed(() =>
    this.upiToConfirm().reduce((sum, p) => sum + Number(p.amount), 0),
  );

  /** Everything already accounted for — a log, not a to-do list. */
  /**
   * Everything still needing the owner's action — fetched unpaged, separately
   * from the record below. Deriving it from a page of history would hide
   * anything past the first page, and money the owner cannot see is money they
   * wrongly believe is settled.
   */
  readonly outstandingPaid = signal<SettledPayment[]>([]);

  // The paged record.
  readonly paidPageSize = 20;
  readonly paidOffset = signal(0);
  readonly paidTotal = signal(0);
  readonly paidHasMore = signal(false);
  readonly loadingPaid = signal(false);

  readonly paidRangeLabel = computed(() => {
    const total = this.paidTotal();
    if (!total) return '';
    const from = this.paidOffset() + 1;
    const to = Math.min(this.paidOffset() + this.recentPaid().length, total);
    return `${from}–${to} of ${total}`;
  });

  async loadPaidPage(offset: number): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.loadingPaid.set(true);
    try {
      const page = await this.api.recentPayments(gym.id, {
        limit: this.paidPageSize,
        offset: Math.max(0, offset),
      });
      this.recentPaid.set(page.rows);
      this.paidOffset.set(page.offset);
      this.paidTotal.set(page.total);
      this.paidHasMore.set(page.hasMore);
    } catch {
      this.error.set('Could not load that page of payments.');
    } finally {
      this.loadingPaid.set(false);
    }
  }

  nextPaidPage(): void { void this.loadPaidPage(this.paidOffset() + this.paidPageSize); }
  prevPaidPage(): void { void this.loadPaidPage(this.paidOffset() - this.paidPageSize); }

  readonly bulkCash = signal(false);
  readonly bulkUpi = signal(false);
  readonly confirmBulk = signal<'cash' | 'upi' | null>(null);

  async takeAllCash(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.bulkCash.set(true);
    this.confirmBulk.set(null);
    this.error.set('');
    try {
      const r = await this.api.handoverAllCash(gym.id);
      this.notice.set(
        r.payments
          ? `₹${r.total} collected from ${r.people} ${r.people === 1 ? 'person' : 'people'}.`
          : 'There was no cash left to collect.',
      );
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record that collection.'));
    } finally {
      this.bulkCash.set(false);
    }
  }

  async confirmAllUpi(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.bulkUpi.set(true);
    this.confirmBulk.set(null);
    this.error.set('');
    try {
      const r = await this.api.closeAllUpiPayments(gym.id);
      this.notice.set(
        r.payments ? `₹${r.total} across ${r.payments} payments ticked off.` : 'Nothing left to confirm.',
      );
      await this.load(gym.id, gym.gym_code);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not confirm those payments.'));
    } finally {
      this.bulkUpi.set(false);
    }
  }

  async markPresent(memberId: string): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.marking.set(memberId);
    try {
      await this.api.markManual(gym.id, memberId);
      await this.refreshAttendance(gym.id);
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
      // Uploaded as a second call rather than folded into the create: the
      // member exists either way, so a failed photo upload costs a picture
      // rather than the registration.
      const photo = this.newPhoto();
      if (photo) {
        try {
          await this.api.uploadMemberPhoto(gym.id, created.member.id, photo);
        } catch {
          this.error.set(`${created.member.full_name} was added, but the photo did not upload. Add it from Edit.`);
        }
      }
      this.justAdded.set(created.member);
      this.newName.set('');
      this.newPhone.set('');
      this.clearNewPhoto();
      await this.refreshMembers(gym.id);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not add that member.'));
    } finally {
      this.adding.set(false);
    }
  }

  /**
   * Opens the renewal dialog.
   *
   * Takes the narrow RenewTarget rather than a MemberRow so the renewal worklist
   * can open it too — that list is where the owner decides to chase someone, and
   * sending them off to find the same person again in the member table below was
   * busywork. Its rows carry no `expiry`, so the label falls back to "Renew",
   * except for the never-started section which passes 'none' explicitly.
   */
  openRenewal(member: RenewTarget): void {
    this.renewing.set(member);
    this.renewPlanId.set(this.plans()[0]?.id ?? '');
    this.renewAmount.set('');
    // The owner cannot record cash, so their dialog opens on UPI.
    this.renewMethod.set(this.auth.isOwner() ? 'qr' : 'cash');
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
      // String(...) rather than .trim() directly: ngModelChange is typed `any`,
      // so nothing at compile time guarantees a string is what arrived.
      const typed = String(this.renewAmount() ?? '').trim();
      const custom = this.canSetPrice() && typed !== '' ? Number(typed) : undefined;

      if (custom !== undefined && (!Number.isFinite(custom) || custom < 0)) {
        this.error.set('Enter the amount as a number, or leave it blank for the plan price.');
        return;
      }

      await this.api.createSubscription(gym.id, member.id, {
        planId: this.renewPlanId(),
        method: this.renewMethod(),
        // Sent only when the owner actually typed one, so the server charges
        // the plan's price by default rather than whatever was last in the box.
        amount: custom,
      });
      this.renewing.set(null);
      await Promise.all([this.refreshMembers(gym.id), this.refreshMoney(gym.id)]);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record that payment.'));
    } finally {
      this.savingRenewal.set(false);
    }
  }

  /**
   * The server's own message where there is one, otherwise something honest.
   *
   * This used to return a flat fallback for anything that was not an
   * HttpErrorResponse, so a bug in this file reported itself as "could not
   * record that payment" — indistinguishable from the server refusing, and it
   * cost real time to track down. A client-side fault now says so.
   */
  private apiMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.error?.message) return err.error.message;
      if (err.status === 0) return 'Could not reach the server. Check your connection and try again.';
      return `${fallback} (server said ${err.status})`;
    }
    if (err instanceof Error) return `${fallback} — ${err.message}`;
    return fallback;
  }

  /**
   * How a period reads in the history table. A month shows as "September 2026",
   * a week as "Mon 15 Sep", a day as "21 Sep" — the unit is already in the
   * column heading, so the label does not repeat it.
   */
  periodLabel(value: string): string {
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (this.handoverPeriod() === 'month') {
      return date.toLocaleDateString([], { month: 'long', year: 'numeric' });
    }
    const opts: Intl.DateTimeFormatOptions =
      this.handoverPeriod() === 'week'
        ? { weekday: 'short', day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short' };
    return date.toLocaleDateString([], opts);
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
