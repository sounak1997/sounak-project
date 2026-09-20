import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Candidate,
  CheckinService,
  CheckinState,
  MemberAccountService,
  PaymentService,
  Plan,
  ScanResult,
} from '../core/checkin.service';

type Phase =
  | 'loading' | 'ready' | 'identify' | 'choose' | 'verify' | 'result' | 'blocked'
  | 'plans' | 'paying' | 'signup';

/**
 * The gym door screen — the whole member-facing product.
 *
 * Reached by pointing a phone camera at the static QR printed on the gym's
 * wall, which opens /checkin?g=<gymCode> in the browser. There is no login, no
 * app to install, and no QR scanner in this page: the phone's own camera did
 * the scanning, and this is just the page it opened.
 *
 * Because the poster is identical for every member, the URL cannot say who is
 * scanning. So on a phone's first visit the member finds themselves once
 * (phase 'identify' -> 'choose' -> 'verify'), the device is remembered, and
 * every later scan lands straight on a single large button.
 *
 * That button never says what it will do based on a client guess — `nextAction`
 * comes from the server, which decides arrival vs departure from whether
 * today's visit is still open.
 */
@Component({
  selector: 'app-checkin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './checkin.page.html',
  styleUrl: './checkin.page.scss',
})
export class CheckinPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private api = inject(CheckinService);
  private payments = inject(PaymentService);
  private accounts = inject(MemberAccountService);
  private auth = inject(AuthService);

  readonly gymCode = signal<string>('');
  readonly phase = signal<Phase>('loading');
  readonly state = signal<CheckinState | null>(null);
  readonly result = signal<ScanResult | null>(null);
  readonly error = signal<string>('');
  readonly busy = signal(false);

  // Identify flow
  readonly query = signal('');
  readonly candidates = signal<Candidate[]>([]);
  readonly matchedBy = signal<'phone' | 'name'>('phone');
  readonly chosen = signal<Candidate | null>(null);
  readonly verifyDigits = signal('');

  // Renewal
  readonly plans = signal<Plan[]>([]);
  readonly onlinePaymentAvailable = signal(false);
  readonly payNotice = signal('');

  // Optional online access
  readonly canSignUp = signal(false);
  readonly signupEmail = signal('');
  readonly signupPassword = signal('');
  readonly signupDone = signal(false);

  /**
   * Seconds until check-out is allowed, ticking down locally.
   *
   * Exists so the button never offers something the server will refuse: inside
   * the re-scan grace window a tap is ignored as an accidental double scan, and
   * a member who was told "Check out" and then got "Already checked in" has
   * every reason to think the app is broken.
   */
  readonly graceLeft = signal(0);
  private graceTimer?: ReturnType<typeof setInterval>;
  private returnTimer?: ReturnType<typeof setTimeout>;

  readonly gymName = computed(() => this.result()?.gymName ?? this.state()?.gymName ?? 'Gym');

  constructor() {
    const code = this.route.snapshot.queryParamMap.get('g') ?? '';
    this.gymCode.set(code);
    if (!code) {
      this.error.set('This link is missing its gym code. Please scan the QR at the gym entrance.');
      this.phase.set('blocked');
    } else {
      void this.load();
    }
  }

  /** Runs on load: fetches state and, as a side effect, wakes a sleeping backend. */
  private async load(): Promise<void> {
    this.phase.set('loading');
    try {
      let state = await this.api.state(this.gymCode());

      // Not recognised, but signed in? Their session already proves who they
      // are — far better evidence than the phone lookup we would otherwise ask
      // for. Being asked to identify yourself seconds after signing in reads as
      // the app having forgotten you.
      if (!state.recognised && this.auth.token) {
        if (await this.accounts.bindFromSession(this.gymCode())) {
          state = await this.api.state(this.gymCode());
        }
      }

      this.state.set(state);
      this.startGraceCountdown(state.graceSecondsRemaining ?? 0);
      this.phase.set(state.recognised ? 'ready' : 'identify');

      // Only offered to a recognised member who has not already set one up.
      if (state.recognised) {
        try {
          const account = await this.accounts.state(this.gymCode());
          this.canSignUp.set(account.recognised && !account.hasAccount);
        } catch {
          this.canSignUp.set(false);
        }
      }
    } catch (err) {
      this.error.set(this.messageFrom(err, 'Could not reach the gym. Please try again.'));
      this.phase.set('blocked');
    }
  }

  async search(): Promise<void> {
    const query = this.query().trim();
    if (!query) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.api.search(this.gymCode(), query);
      this.matchedBy.set(res.matchedBy);
      this.candidates.set(res.candidates);

      // Found by full phone number, and only one match: the member has already
      // typed the digits the server wants as proof, so claim silently rather
      // than asking them to type four of them again.
      if (res.matchedBy === 'phone' && res.candidates.length === 1 && res.candidates[0].claimable) {
        await this.claim(res.candidates[0], query.replace(/\D/g, '').slice(-4));
        return;
      }
      this.phase.set('choose');
    } catch (err) {
      this.error.set(this.messageFrom(err, 'We could not look you up. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  pick(candidate: Candidate): void {
    if (!candidate.claimable) {
      this.error.set('There is no mobile number on that membership yet. Please ask at the gym desk.');
      return;
    }
    this.chosen.set(candidate);
    this.verifyDigits.set('');
    this.error.set('');
    this.phase.set('verify');
  }

  async confirmVerify(): Promise<void> {
    const candidate = this.chosen();
    if (!candidate) return;
    await this.claim(candidate, this.verifyDigits());
  }

  private async claim(candidate: Candidate, digits: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.claim(this.gymCode(), candidate.id, digits);
      await this.load();
    } catch (err) {
      this.error.set(this.messageFrom(err, 'We could not confirm that. Please try again.'));
      // Stay on the verify step so the member can retype, unless they never
      // reached it (the silent phone-match path), in which case go back to the
      // form they did fill in.
      this.phase.set(this.chosen() ? 'verify' : 'identify');
    } finally {
      this.busy.set(false);
    }
  }

  /** The single button at the door. */
  async mark(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.api.scan(this.gymCode());
      this.result.set(res);
      this.startGraceCountdown(res.graceSecondsRemaining ?? 0);
      this.phase.set('result');

      // Return on its own. The member has tapped once and is walking away —
      // making them tap "Done" to dismiss a confirmation is a tap that exists
      // only for the app's benefit. Outcomes that need reading or acting on
      // (an expired membership, the renewal options) stay put.
      const transient = ['checked_in', 'checked_out', 'duplicate_ignored', 'already_complete'];
      if (transient.includes(res.outcome)) {
        clearTimeout(this.returnTimer);
        this.returnTimer = setTimeout(() => void this.done(), 6000);
      }
    } catch (err) {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status === 403) {
        // The device token was revoked (lost phone) or no longer matches.
        this.api.forgetDevice(this.gymCode());
        this.error.set('Please enter your mobile number to check in.');
        this.phase.set('identify');
      } else {
        this.error.set(this.messageFrom(err, 'Could not record that. Please try again.'));
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** After a result, go back to the live state so the button is right again. */
  async done(): Promise<void> {
    clearTimeout(this.returnTimer);
    this.result.set(null);
    await this.load();
  }

  notYou(): void {
    this.api.forgetDevice(this.gymCode());
    this.query.set('');
    this.candidates.set([]);
    this.chosen.set(null);
    this.error.set('');
    this.phase.set('identify');
  }

  /** Ticks the grace window down and re-enables the button when it expires. */
  private startGraceCountdown(seconds: number): void {
    clearInterval(this.graceTimer);
    this.graceLeft.set(Math.max(0, seconds));
    if (seconds <= 0) return;
    this.graceTimer = setInterval(() => {
      const left = this.graceLeft() - 1;
      this.graceLeft.set(Math.max(0, left));
      if (left <= 0) clearInterval(this.graceTimer);
    }, 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.graceTimer);
    clearTimeout(this.returnTimer);
  }

  // --- optional online access ----------------------------------------------

  openSignUp(): void {
    this.signupEmail.set('');
    this.signupPassword.set('');
    this.error.set('');
    this.phase.set('signup');
  }

  async submitSignUp(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.accounts.signUp(this.gymCode(), this.signupEmail().trim(), this.signupPassword());
      this.signupDone.set(true);
      this.canSignUp.set(false);
      await this.load();
    } catch (err) {
      this.error.set(this.messageFrom(err, 'Could not set that up. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  cancelSignUp(): void {
    this.error.set('');
    this.phase.set('ready');
  }

  // --- renewal --------------------------------------------------------------

  /** Opens the plan list so an expired member can pay without leaving the door. */
  async showPlans(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.payNotice.set('');
    try {
      const res = await this.payments.plans(this.gymCode());
      this.plans.set(res.plans);
      this.onlinePaymentAvailable.set(res.onlinePaymentAvailable);
      this.phase.set('plans');
    } catch (err) {
      this.error.set(this.messageFrom(err, 'Could not load the plans. Please ask at the desk.'));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Runs the UPI payment and then reloads.
   *
   * 'pending' is its own outcome, not an error: the member may well have paid
   * while the confirmation was still in flight, and telling someone the payment
   * failed when their account was debited is the worst thing this screen could
   * do. So it says "we're checking" and the reconciliation poll settles it.
   */
  async payWith(plan: Plan): Promise<void> {
    this.phase.set('paying');
    this.error.set('');
    this.payNotice.set('');
    try {
      const outcome = await this.payments.pay(this.gymCode(), plan.id);
      if (outcome === 'paid') {
        this.payNotice.set(`Payment received — your ${plan.name} membership is active.`);
        await this.load();
      } else if (outcome === 'pending') {
        this.payNotice.set(
          "We haven't had confirmation yet. If money has left your account it will be applied " +
          'automatically — check back in a minute, or show this to the gym desk.',
        );
        this.phase.set('plans');
      } else {
        this.phase.set('plans');
      }
    } catch (err) {
      this.error.set(this.messageFrom(err, 'Could not start the payment. Please pay at the desk.'));
      this.phase.set('plans');
    }
  }

  backFromPlans(): void {
    this.payNotice.set('');
    this.error.set('');
    void this.load();
  }

  rupees(price: string): string {
    return Number(price).toLocaleString('en-IN');
  }

  // --- presentation helpers -------------------------------------------------

  time(value: string | null | undefined): string {
    if (!value) return '';
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  day(value: string | null | undefined): string {
    if (!value) return '';
    // Dates arrive as plain 'YYYY-MM-DD'. Splitting rather than using Date()
    // avoids the browser reading a bare date as UTC midnight and showing the
    // previous day west of Greenwich.
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  headline(outcome: ScanResult['outcome']): string {
    switch (outcome) {
      case 'checked_in': return "You're checked in";
      case 'checked_out': return 'Checked out';
      case 'duplicate_ignored': return "You're already checked in";
      case 'already_complete': return "That's you done for today";
      case 'no_subscription': return 'No active membership';
      case 'subscription_expired': return 'Your membership has expired';
    }
  }

  private messageFrom(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && err.error?.message) return err.error.message;
    return fallback;
  }
}
