import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConsoleStore } from '../console.store';
import { IconComponent } from '../icon.component';

/**
 * What is happening right now, and what needs doing.
 *
 * One live figure at the top, then a list that only shows a row when there is
 * something behind it — on a quiet day this screen is almost empty, which is
 * the honest answer and much easier to read than six tiles of zeroes. The old
 * console led with a permanent wall of counts, so nothing on it stood out.
 *
 * Deliberately does NOT repeat the lapsed-member list: that is the Members tab
 * filtered to "needs action", and two lists of the same people drift apart.
 * The rows here link there instead.
 */
@Component({
  selector: 'app-today',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './today.page.html',
})
export class TodayPage {
  readonly store = inject(ConsoleStore);
  readonly auth = this.store.auth;

  readonly expired = computed(() => this.store.members().filter((m) => m.expiry === 'expired'));
  readonly expiring = computed(() => this.store.members().filter((m) => m.expiry === 'expiring'));
  readonly neverStarted = computed(() => this.store.members().filter((m) => m.expiry === 'none'));

  /** The first few names, so the row says who rather than only how many. */
  names(rows: { full_name: string }[]): string {
    const first = rows.slice(0, 3).map((r) => r.full_name.split(' ')[0]);
    return rows.length > 3 ? `${first.join(', ')} and ${rows.length - 3} more` : first.join(', ');
  }

  /** Still in the gym first, then most recent arrival. */
  readonly floor = computed(() => {
    const visits = this.store.today()?.visits ?? [];
    return [...visits].sort((a, b) => {
      const inA = a.check_out_at ? 1 : 0;
      const inB = b.check_out_at ? 1 : 0;
      return inA - inB || (b.check_in_at ?? '').localeCompare(a.check_in_at ?? '');
    });
  });

  /** What this account is personally holding in cash — staff see their own. */
  readonly myCashHeld = computed(() => Number(this.store.myCash()?.cash_in_hand ?? 0));

  /** Whether there is anything at all in the "needs you" list. */
  readonly anythingToDo = computed(
    () =>
      this.expired().length > 0 ||
      this.neverStarted().length > 0 ||
      this.store.moneyTodo() > 0 ||
      Number(this.store.myCash()?.cash_in_hand ?? 0) > 0,
  );

  /** Opens the sheet for a member on the floor, for a quick renewal or a call. */
  openById(memberId: string): void {
    const m = this.store.members().find((x) => x.id === memberId);
    if (m) this.store.open(m);
  }
}
