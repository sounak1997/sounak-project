import { Component, computed, inject } from '@angular/core';
import { ConsoleStore } from '../console.store';
import { IconComponent } from '../icon.component';

/**
 * Where the gym's money is, and what has not reached the owner yet.
 *
 * Two halves rather than eight cards down one scroll: what is still outstanding,
 * and what already happened. The outstanding half is ONE list with a stage per
 * row — not confirmed, with the desk, check your account — because those are
 * three points on one journey, and when they were three lists confirming a
 * payment made a count go up somewhere else.
 *
 * A staff account sees their own drawer and the rows they are allowed to
 * confirm. That is the same line the server enforces on every money route;
 * hiding a figure is not the control.
 */
@Component({
  selector: 'app-money',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './money.page.html',
})
export class MoneyPage {
  readonly store = inject(ConsoleStore);
  readonly auth = this.store.auth;

  readonly filters: ReadonlyArray<{ key: 'all' | 'upi' | 'cash'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'upi', label: 'UPI' },
    { key: 'cash', label: 'Cash' },
  ];

  readonly logFilters: ReadonlyArray<{ key: '' | 'cash' | 'upi'; label: string }> = [
    { key: '', label: 'All' },
    { key: 'upi', label: 'UPI' },
    { key: 'cash', label: 'Cash' },
  ];

  readonly myCashHeld = computed(() => Number(this.store.myCash()?.cash_in_hand ?? 0));
}
