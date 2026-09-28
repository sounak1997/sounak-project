import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import QRCode from 'qrcode';
import { environment } from '../../environment/environment';
import { AuthService } from '../core/auth.service';
import {
  CashPosition,
  CreatedMember,
  DashboardSummary,
  GymService,
  MemberRow,
  OpenPayment,
  PaymentProvider,
  ReversedPayment,
  Plan,
  SettledPayment,
  Today,
  Watchlist,
} from '../core/gym.service';

/** The minimum the renewal dialog needs: who, and whether they have a plan. */
export type RenewTarget = {
  id: string;
  full_name: string;
  expiry?: MemberRow['expiry'];
  end_date?: string | null;
};

/**
 * The minimum a reversal needs. Both a settled row from the record and an open
 * row still on its way satisfy it, so Undo can sit wherever the payment is
 * rather than only in the history.
 */
export type ReversiblePayment = {
  id: string;
  amount: string;
  full_name: string;
  method: 'cash' | 'qr' | 'gateway';
  marked_by_name: string | null;
  verified_at: string | null;
};

/** Which slice of the member list the chips are showing. */
export type MemberScope = 'attention' | 'active' | 'all';

/**
 * One store behind the whole console.
 *
 * The console used to be a single 1,000-line component, so its four screens now
 * share this rather than each re-fetching the same figures. Everything here was
 * lifted from that component with its behaviour intact — the same endpoints, the
 * same owner/staff gates, the same optimistic updates. What is new is only what
 * the split needs: which member is open, and which slice of the list is showing.
 *
 * Root-provided because the shell holds the dialogs and the pages read the same
 * signals; a page-scoped store would reload every figure on every tab change.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleStore {
  private api = inject(GymService);
  readonly auth = inject(AuthService);

  // --- the screen ---
  readonly summary = signal<DashboardSummary | null>(null);
  readonly watchlist = signal<Watchlist | null>(null);
  readonly members = signal<MemberRow[]>([]);
  readonly today = signal<Today | null>(null);
  readonly plans = signal<Plan[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly marking = signal<string | null>(null);
  readonly refreshing = signal(false);

  // --- registering a new member (front desk) ---
  readonly newName = signal('');
  readonly newPhone = signal('');
  readonly adding = signal(false);
  /** Held after a successful add so the desk can read the code out loud. */
  readonly justAdded = signal<CreatedMember['member'] | null>(null);
  readonly newPhoto = signal<File | null>(null);
  readonly newPhotoPreview = signal('');
  readonly addOpen = signal(false);

  // --- taking a renewal ---
  readonly renewing = signal<RenewTarget | null>(null);
  readonly renewPlanId = signal('');
  readonly renewMethod = signal<'cash' | 'qr'>('cash');
  /** Blank means "charge the plan's price". Owner-only; the server agrees. */
  readonly renewAmount = signal('');
  readonly savingRenewal = signal(false);

  // --- money: ONE list, one lifecycle ---
  /**
   * Every payment that has not reached the owner yet, whatever stage it is at.
   * There were three lists — unconfirmed, cash with staff, UPI to check — and
   * confirming a payment moved it between them, so a count went UP just after
   * the owner had dealt with something. A row now changes stage in place and
   * leaves only when the money has actually arrived.
   */
  readonly openPayments = signal<OpenPayment[]>([]);
  readonly payFilter = signal<'all' | 'cash' | 'upi'>('all');
  readonly receiving = signal<string | null>(null);
  readonly bulkReceiving = signal(false);
  readonly settling = signal<string | null>(null);
  readonly myCash = signal<{ cash_in_hand: string; cash_payments: number } | null>(null);
  readonly recentPaid = signal<SettledPayment[]>([]);
  readonly reversing = signal<string | null>(null);
  /** Held for confirmation: undoing locks a member out, so it is never one tap. */
  readonly confirmReverse = signal<ReversiblePayment | null>(null);
  readonly position = signal<CashPosition | null>(null);
  readonly closing = signal<string | null>(null);
  /** Which payments the history log shows. Applied by the server, not here. */
  readonly logMethod = signal<'' | 'cash' | 'upi'>('');
  /**
   * Which log History shows: what reached you, or what was undone. Two
   * genuinely different lists, so two views rather than one filtered one.
   */
  readonly logView = signal<'received' | 'undone'>('received');
  /** The audit log of undone payments. Read-only by design. */
  readonly reversed = signal<ReversedPayment[]>([]);

  readonly confirmBulk = signal<'cash' | 'upi' | null>(null);
  /** Which half of the Money tab is showing. */
  readonly moneyTab = signal<'settle' | 'history'>('settle');

  // --- setup ---
  readonly payQrUrl = signal('');
  readonly savingQr = signal(false);
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

  // --- the member list and its sheet ---
  /**
   * Free-text filter over the member list. Matched in the browser rather than
   * round-tripping per keystroke: the list is already loaded, and at the desk
   * with someone waiting, instant beats thorough. It searches everything
   * visible in the row, because the desk does not know which of those the
   * person on the other side of the counter will say.
   */
  readonly memberFilter = signal('');
  /**
   * Everyone, by default.
   *
   * The sort already puts the work at the top — expiring, then lapsed, then
   * never-started, then current — so filtering to "needs action" as well hid
   * the other 90% of the gym and left most of a laptop screen blank. The chip
   * is still there for when the worklist is all you want.
   */
  readonly scope = signal<MemberScope>('all');
  /** The member whose sheet is open — a bottom sheet on a phone, a panel on a laptop. */
  readonly selected = signal<MemberRow | null>(null);

  // --- editing a member ---
  readonly editing = signal<MemberRow | null>(null);
  readonly editName = signal('');
  readonly editPhone = signal('');
  readonly editEmergency = signal('');
  readonly editNotes = signal('');
  readonly editStatus = signal<'active' | 'inactive'>('active');
  readonly editPhoto = signal<File | null>(null);
  readonly editPhotoPreview = signal('');
  readonly savingEdit = signal(false);

  // --- the paged payment record ---
  readonly outstandingPaid = signal<SettledPayment[]>([]);
  readonly paidPageSize = 20;
  readonly paidOffset = signal(0);
  readonly paidTotal = signal(0);
  readonly paidHasMore = signal(false);
  readonly loadingPaid = signal(false);

  /**
   * Only the owner may set a price other than the plan's. Mirrors the server,
   * which refuses a custom amount from a staff account — this hides the field,
   * it does not enforce anything.
   */
  readonly canSetPrice = computed(() => this.auth.activeGym()?.staff_role !== 'staff');

  constructor() {
    // Reloads whenever the owner switches gym — an owner of two gyms sees each
    // one's numbers without a page refresh.
    effect(() => {
      const gym = this.auth.activeGym();
      if (gym) void this.load(gym.id, gym.gym_code, true);
    });
  }

  // =========================================================================
  // Derived
  // =========================================================================

  /** Expiring first, then lapsed, then never-started: preventable before lost. */
  private rank(m: MemberRow): number {
    return { expiring: 0, expired: 1, none: 2, active: 3 }[m.expiry];
  }

  private matches(m: MemberRow, q: string): boolean {
    const haystack = [m.full_name, m.member_code, m.phone, m.plan_name, m.expiry, m.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (haystack.includes(q)) return true;
    // Digits-only query: match phone loosely, so "9609" finds "+91 96099 87874"
    // and the punctuation a number was typed with never hides it.
    const digits = q.replace(/\D/g, '');
    return digits.length >= 3 && (m.phone ?? '').replace(/\D/g, '').includes(digits);
  }

  readonly needsAction = computed(() => this.members().filter((m) => m.expiry !== 'active'));
  readonly activeMembers = computed(() => this.members().filter((m) => m.expiry === 'active'));

  /** What the list actually renders: the chip, then the search box, then order. */
  readonly visibleMembers = computed(() => {
    const scope = this.scope();
    const q = this.memberFilter().trim().toLowerCase();
    // A search is a search: typing a name looks through everyone, not through
    // whichever chip happened to be selected. Nothing is more annoying than a
    // member you know exists being reported as missing.
    const base = q
      ? this.members()
      : scope === 'attention'
        ? this.needsAction()
        : scope === 'active'
          ? this.activeMembers()
          : this.members();
    const rows = q ? base.filter((m) => this.matches(m, q)) : [...base];
    return rows.sort(
      (a, b) =>
        this.rank(a) - this.rank(b) ||
        Math.abs(a.days_remaining ?? 9999) - Math.abs(b.days_remaining ?? 9999) ||
        a.full_name.localeCompare(b.full_name),
    );
  });

  /**
   * Where the worklist ends and the ordinary members begin, so the list can say
   * so instead of making you notice the badges change colour.
   * -1 when there is no boundary to draw.
   */
  readonly firstCurrentIndex = computed(() => {
    const rows = this.visibleMembers();
    const i = rows.findIndex((m) => m.expiry === 'active');
    return i > 0 ? i : -1;
  });

  /** Member ids currently on the floor, for the row and the sheet. */
  readonly inGymNow = computed(
    () => new Set((this.today()?.visits ?? []).filter((v) => !v.check_out_at).map((v) => v.member_id)),
  );

  /** What the filter is showing. */
  readonly visiblePayments = computed(() => {
    const f = this.payFilter();
    if (f === 'all') return this.openPayments();
    return this.openPayments().filter((p) =>
      f === 'cash' ? p.method === 'cash' : p.method !== 'cash',
    );
  });

  readonly visibleTotal = computed(() =>
    this.visiblePayments().reduce((sum, p) => sum + Number(p.amount), 0),
  );

  /** The three stages, for the "needs you" rows on Today. */
  readonly unconfirmed = computed(() =>
    this.openPayments().filter((p) => p.stage === 'unconfirmed'),
  );
  readonly withStaff = computed(() => this.openPayments().filter((p) => p.stage === 'with_staff'));
  readonly toCheck = computed(() => this.openPayments().filter((p) => p.stage === 'to_check'));

  readonly unconfirmedTotal = computed(() => this.sum(this.unconfirmed()));
  readonly withStaffTotal = computed(() => this.sum(this.withStaff()));
  readonly toCheckTotal = computed(() => this.sum(this.toCheck()));

  /** Everything that has not reached the owner, in money. */
  readonly outstandingTotal = computed(() => this.sum(this.openPayments()));

  sum(rows: { amount: string }[]): number {
    return rows.reduce((total, r) => total + Number(r.amount), 0);
  }

  /** Who is holding what, for the "cash sitting with the desk" row. */
  readonly holders = computed(() => {
    const by = new Map<string, number>();
    for (const p of this.withStaff()) {
      const who = p.marked_by_name ?? 'staff';
      by.set(who, (by.get(who) ?? 0) + Number(p.amount));
    }
    return [...by].map(([name, amount]) => ({ name, amount }));
  });

  /** How many things need doing on the Money tab — the tab's badge. */
  readonly moneyTodo = computed(() => this.openPayments().length);

  readonly paidRangeLabel = computed(() => {
    const total = this.paidTotal();
    if (!total) return '';
    const from = this.paidOffset() + 1;
    const to = Math.min(this.paidOffset() + this.recentPaid().length, total);
    return `${from}–${to} of ${total}`;
  });

  /**
   * The dates a renewal will cover, shown before it is recorded.
   *
   * Mirrors the server's rule (resolveStartDate): a renewal continues from the
   * day after the last one ended, not from today — unless the whole period
   * would already be over, in which case it starts today. A PREVIEW only; the
   * server computes it again and is the authority.
   */
  readonly renewalPeriod = computed(() => {
    const plan = this.plans().find((p) => p.id === this.renewPlanId());
    if (!plan) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const prevEnd = this.renewing()?.end_date ? this.parseDay(this.renewing()!.end_date!) : null;

    let start = today;
    let continuing = false;
    if (prevEnd) {
      const dayAfter = new Date(prevEnd);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const wouldEnd = new Date(dayAfter);
      wouldEnd.setDate(wouldEnd.getDate() + plan.duration_days - 1);
      if (wouldEnd >= today) {
        start = dayAfter;
        continuing = true;
      }
    }
    const end = new Date(start);
    end.setDate(end.getDate() + plan.duration_days - 1);

    // True when the member has been lapsed and is paying for that gap.
    return { start, end, continuing, backdated: continuing && start < today };
  });

  // =========================================================================
  // Loading
  // =========================================================================

  /**
   * Fetches the whole screen. Only for arriving and for switching gym.
   *
   * `initial` is what puts the page into its loading state; actions pass false
   * and call the refresh* helpers, which re-fetch only the slices their action
   * can have changed.
   */
  async load(gymId: string, gymCode: string, initial = false): Promise<void> {
    if (initial) this.loading.set(true);
    this.error.set('');
    // environment.publicUrl, never location.origin — see the comment there.
    // Falls back to this origin only if it is somehow unset, which at least
    // keeps the QR scannable for whoever generated it.
    const origin = environment.publicUrl || location.origin;
    const poster = `${origin}/checkin?g=${gymCode}`;
    this.posterUrl.set(poster);
    // Rendered here rather than shown as a URL to paste into some other QR
    // generator — the poster is the entire member-facing product.
    QRCode.toDataURL(poster, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => this.posterQr.set(url))
      .catch(() => this.posterQr.set(''));
    try {
      // Reconcile BEFORE reading payments, so a UPI payment whose webhook was
      // missed shows as paid rather than as something to chase for no reason.
      // Owner-only: a 403 in a staff console is noise that looks like a fault.
      const owner = this.auth.isOwner();
      if (owner) await this.api.reconcile(gymId).catch(() => undefined);

      const [summary, watchlist, members, today, plans, provider] = await Promise.all([
        this.api.dashboard(gymId),
        this.api.watchlist(gymId, 7),
        this.api.members(gymId),
        this.api.today(gymId),
        this.api.plans(gymId),
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
      this.provider.set(provider.provider);
      this.webhookUrl.set(provider.webhookUrl);
      this.webhookReachable.set(provider.webhookReachable ?? true);
      if (provider.provider) this.keyId.set(provider.provider.key_id);

      // Cash figures last, each swallowing its own failure: they are an extra,
      // and must never be what stops the console rendering.
      this.payQrUrl.set(this.auth.activeGym()?.payment_qr_url ?? '');
      this.myCash.set(await this.api.myCashInHand(gymId).catch(() => null));
      this.openPayments.set(await this.api.openPayments(gymId).catch(() => []));
      if (owner) {
        const [pos, outstanding, page] = await Promise.all([
          this.api.cashPosition(gymId).catch(() => null),
          this.api
            .recentPayments(gymId, { outstanding: true })
            .catch(() => ({ rows: [], total: 0, offset: 0, hasMore: false })),
          this.api
            .recentPayments(gymId, {
              limit: this.paidPageSize,
              offset: this.paidOffset(),
              method: this.logMethod(),
            })
            .catch(() => ({ rows: [], total: 0, offset: 0, hasMore: false })),
        ]);
        this.position.set(pos);
        this.outstandingPaid.set(outstanding.rows);
        this.recentPaid.set(page.rows);
        this.paidOffset.set(page.offset);
        this.paidTotal.set(page.total);
        this.paidHasMore.set(page.hasMore);
        this.reversed.set(await this.api.reversedPayments(gymId).catch(() => []));
      } else {
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

  /** The top bar's refresh. Re-reads everything without blanking the screen. */
  async refreshAll(): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym || this.refreshing()) return;
    this.refreshing.set(true);
    try {
      await this.load(gym.id, gym.gym_code);
    } finally {
      this.refreshing.set(false);
    }
  }

  /**
   * Re-reads the money figures and nothing else. Everything here is owner-only
   * except the unconfirmed list and the caller's own cash, so staff fetch the
   * two they are allowed and skip the rest rather than collecting 403s.
   */
  private async refreshMoney(gymId: string): Promise<void> {
    const owner = this.auth.isOwner();
    const [mine, open] = await Promise.all([
      this.api.myCashInHand(gymId).catch(() => this.myCash()),
      // Staff see only the rows they may act on; the server narrows it.
      this.api.openPayments(gymId).catch(() => this.openPayments()),
    ]);
    this.myCash.set(mine);
    this.openPayments.set(open);
    if (!owner) return;

    const [pos, outstanding] = await Promise.all([
      this.api.cashPosition(gymId).catch(() => this.position()),
      this.api
        .recentPayments(gymId, { outstanding: true })
        .catch(() => ({ rows: this.outstandingPaid(), total: 0, offset: 0, hasMore: false })),
    ]);
    this.position.set(pos);
    this.outstandingPaid.set(outstanding.rows);
    this.reversed.set(await this.api.reversedPayments(gymId).catch(() => this.reversed()));
    // Back to page one: settling something changes what the record contains,
    // and an old offset would show a page that has shifted underneath it.
    await this.loadPaidPage(0);
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
    // The open sheet must show what the list now shows, or it goes stale behind
    // the very action that was taken in it.
    const open = this.selected();
    if (open) this.selected.set(members.find((m) => m.id === open.id) ?? null);
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

  /** Re-reads the gateway block after its keys change. Owner-only, like the route. */
  private async refreshProvider(gymId: string): Promise<void> {
    const p = await this.api.paymentProvider(gymId).catch(() => ({
      provider: this.provider(),
      webhookUrl: this.webhookUrl(),
      webhookReachable: true,
    }));
    this.provider.set(p.provider);
    this.webhookUrl.set(p.webhookUrl);
    this.webhookReachable.set(p.webhookReachable ?? true);
    if (p.provider) this.keyId.set(p.provider.key_id);
  }

  /**
   * Paged on the SERVER: a gym running for a year has thousands of these, and
   * sending them all to render twenty is wasteful in exactly the place — a
   * phone on gym wifi — where it is felt.
   */
  async loadPaidPage(offset: number): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.loadingPaid.set(true);
    try {
      const page = await this.api.recentPayments(gym.id, {
        limit: this.paidPageSize,
        offset: Math.max(0, offset),
        method: this.logMethod(),
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

  /**
   * Switch the history log. Changing the method changes what each page holds, so
   * paging starts over; the undone view pages nothing — it is a bounded window,
   * not a growing record.
   */
  setLog(view: 'received' | 'undone', method: '' | 'cash' | 'upi'): void {
    if (this.logView() === view && this.logMethod() === method) return;
    this.logView.set(view);
    if (view === 'undone') return;
    const changed = this.logMethod() !== method;
    this.logMethod.set(method);
    if (changed) void this.loadPaidPage(0);
  }

  nextPaidPage(): void {
    void this.loadPaidPage(this.paidOffset() + this.paidPageSize);
  }

  prevPaidPage(): void {
    void this.loadPaidPage(this.paidOffset() - this.paidPageSize);
  }

  // =========================================================================
  // Members
  // =========================================================================

  open(m: MemberRow): void {
    this.selected.set(m);
    this.error.set('');
  }

  close(): void {
    this.selected.set(null);
  }

  /**
   * Register a walk-in. Staff can do this — it is the desk's first job — and
   * the member code that comes back is what the member needs to create their
   * own login, so it is shown until dismissed rather than flashed.
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
      // A second call rather than folded into the create: the member exists
      // either way, so a failed photo upload costs a picture, not the
      // registration.
      const photo = this.newPhoto();
      if (photo) {
        try {
          await this.api.uploadMemberPhoto(gym.id, created.member.id, photo);
        } catch {
          this.error.set(
            `${created.member.full_name} was added, but the photo did not upload. Add it from Edit.`,
          );
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

  async markPresent(memberId: string): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.marking.set(memberId);
    try {
      await this.api.markManual(gym.id, memberId);
      await this.refreshAttendance(gym.id);
      this.notice.set('Marked present.');
    } catch {
      this.error.set('Could not record that. Please try again.');
    } finally {
      this.marking.set(null);
    }
  }

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
      await this.refreshMembers(gym.id);
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
      await this.refreshMembers(gym.id);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not remove that photo.'));
    }
  }

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

  // =========================================================================
  // Renewals
  // =========================================================================

  /**
   * Opens the renewal dialog. Takes a narrow target rather than a MemberRow so
   * the worklist and the sheet can both open it — that list is where the owner
   * decides to chase someone, and sending them off to find the same person
   * again in the member table was busywork.
   */
  openRenewal(member: RenewTarget): void {
    this.renewing.set(member);
    this.renewPlanId.set(this.plans()[0]?.id ?? '');
    this.renewAmount.set('');
    // The owner cannot record cash, so their dialog opens on UPI.
    this.renewMethod.set(this.auth.isOwner() ? 'qr' : 'cash');
    this.error.set('');
  }

  /** The plan's list price, to show beside the custom-amount box. */
  selectedPlanPrice(): string {
    return this.plans().find((p) => p.id === this.renewPlanId())?.price ?? '';
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
      this.notice.set(`Recorded for ${member.full_name}.`);
      await Promise.all([this.refreshMembers(gym.id), this.refreshMoney(gym.id)]);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record that payment.'));
    } finally {
      this.savingRenewal.set(false);
    }
  }

  // =========================================================================
  // Money
  // =========================================================================

  /**
   * THE "mark as paid" action. Cash becomes 'collected', a UPI payment the
   * owner has seen land becomes 'verified'. Both record who confirmed it and
   * when — this is the one place a human overrides what the system can see for
   * itself, so it has to be attributable.
   */
  async markPaid(
    payment: { id: string; amount: string; full_name: string },
    method: 'cash' | 'qr',
  ): Promise<void> {
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
      // Move it on at once rather than waiting for the round trip: the row is
      // what the eye is on, and it should stop saying "not confirmed" the moment
      // it has been. The refresh below then reconciles with the server, which is
      // what decides whether the next stage is "with staff" or "check your
      // account".
      this.openPayments.update((list) =>
        list.map((row) =>
          row.id === payment.id
            ? { ...row, stage: method === 'cash' ? 'with_staff' as const : 'to_check' as const }
            : row,
        ),
      );
      await Promise.all([this.refreshMoney(gym.id), this.refreshMembers(gym.id)]);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not mark that as paid. Please try again.'));
    } finally {
      this.settling.set(null);
    }
  }

  /**
   * The money has reached the owner. ONE verb, for cash and for UPI alike —
   * previously cash was "handed over" per person and UPI was "ticked off" per
   * payment, which was two names for the same fact and two places to do it.
   */
  async receive(p: OpenPayment): Promise<void> {
    const gym = this.auth.activeGym();
    if (!gym) return;
    this.receiving.set(p.id);
    this.error.set('');
    try {
      await this.api.closePayment(gym.id, p.id);
      this.notice.set(`₹${p.amount} from ${p.full_name} — received.`);
      await this.refreshMoney(gym.id);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record that.'));
    } finally {
      this.receiving.set(null);
    }
  }

  /** Which queue a bulk receive is acting on — cash held by staff, or UPI to check. */
  bulkRows(method: 'cash' | 'upi'): OpenPayment[] {
    return method === 'cash' ? this.withStaff() : this.toCheck();
  }

  /** What a bulk receive of ONE method is worth, for the button and the dialog. */
  bulkTotal(method: 'cash' | 'upi'): number {
    return this.sum(this.bulkRows(method));
  }

  /**
   * Receive every row of ONE method — all cash, or all UPI.
   *
   * Independent of whatever the browsing filter (All / UPI / Cash) happens to
   * be set to: that filter is for SCANNING the list, and tying the bulk action
   * to it meant the button vanished on the Cash tab whenever cash alone had
   * only one row, even though there was plenty to receive overall. "Receive all
   * cash" and "Receive all UPI" are each their own action now, offered
   * together, so collecting the week's cash never depends on which tab is open.
   */
  async receiveAllOf(method: 'cash' | 'upi'): Promise<void> {
    const gym = this.auth.activeGym();
    const rows = this.bulkRows(method);
    if (!gym || !rows.length) return;
    this.bulkReceiving.set(true);
    this.confirmBulk.set(null);
    this.error.set('');
    try {
      let total = 0;
      for (const p of rows) {
        await this.api.closePayment(gym.id, p.id);
        total += Number(p.amount);
      }
      this.notice.set(
        `₹${total} across ${rows.length} ${method === 'cash' ? 'cash' : 'UPI'} payments — received.`,
      );
      await this.refreshMoney(gym.id);
    } catch (err) {
      this.error.set(this.apiMessage(err, 'Could not record all of those.'));
      // Some may have gone through before it failed, so re-read either way.
      await this.refreshMoney(gym.id);
    } finally {
      this.bulkReceiving.set(false);
    }
  }

  /**
   * Tick a payment off as accounted for — "yes, this is in my account". After
   * it, Undo is gone for that row, which is the point: an undo button that
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

  // =========================================================================
  // Setup
  // =========================================================================

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

  /**
   * Print just the poster. window.print() on the console would produce pages of
   * tables, so the print stylesheet hides everything but the QR card.
   */
  printPoster(): void {
    window.print();
  }

  // =========================================================================
  // Formatting
  // =========================================================================

  photoUrl(photoId: string | null): string | null {
    return this.api.photoUrl(photoId);
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  }

  /** What stage a row is at, in words. */
  stageLabel(p: OpenPayment): string {
    if (p.stage === 'unconfirmed') return 'Not confirmed';
    return p.stage === 'with_staff' ? `With ${p.marked_by_name ?? 'staff'}` : 'Check your account';
  }

  stagePill(p: OpenPayment): string {
    return p.stage === 'unconfirmed'
      ? 'pill--danger'
      : p.stage === 'with_staff'
        ? 'pill--warn'
        : 'pill--neutral';
  }

  /** This member's own outstanding row, for their sheet. */
  openFor(memberId: string): OpenPayment | null {
    return this.openPayments().find((p) => p.member_id === memberId) ?? null;
  }

  payLabel(p: { method: string; status: string }): string {
    if (p.method === 'cash') return 'Cash — due at the desk';
    if (p.status === 'pending_verification') return 'UPI — member says they paid';
    return 'Online — awaiting the gateway';
  }

  /** 'YYYY-MM-DD' as a local date — `new Date(str)` would read it as UTC. */
  private parseDay(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  fmtDay(d: Date): string {
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  day(value: string | null | undefined): string {
    if (!value) return '—';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  time(value: string | null): string {
    return value
      ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '—';
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

  /** The list badge: a word, a tint and a number — never colour on its own. */
  badgeClass(expiry: MemberRow['expiry']): string {
    return {
      active: 'badge--plain',
      expiring: 'badge--warn',
      expired: 'badge--danger',
      none: 'badge--none',
    }[expiry];
  }

  bandClass(expiry: MemberRow['expiry']): string {
    return {
      active: 'band--ok',
      expiring: 'band--warn',
      expired: 'band--danger',
      none: 'band--none',
    }[expiry];
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

  /** "4d left" / "12d ago" / "No plan" — the row's one status word. */
  daysLabel(m: MemberRow): string {
    if (m.expiry === 'none') return 'No plan';
    const d = m.days_remaining ?? 0;
    if (m.expiry === 'expired') return `${Math.abs(d)}d ago`;
    return `${d}d left`;
  }

  /** How far through the membership they are, for the sheet's band. */
  elapsedPct(m: MemberRow): number {
    const d = m.days_remaining;
    if (d === null || d === undefined) return 0;
    if (d <= 0) return 100;
    // No start date on the row, so this is scaled against a 30-day sense of
    // "soon" rather than the plan's real length. It is a feel, not a figure.
    return Math.max(4, Math.min(100, Math.round(((30 - Math.min(d, 30)) / 30) * 100)));
  }

  /**
   * The server's own message where there is one, otherwise something honest.
   * A client-side fault says so rather than masquerading as the server
   * refusing — that cost real time to track down once.
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
}
