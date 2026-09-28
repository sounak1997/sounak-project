import { Component, computed, inject } from '@angular/core';
import { ConsoleStore } from '../console.store';
import { IconComponent } from '../icon.component';

/**
 * Everything about one member, and every action on them.
 *
 * This is the move that shrinks the member list. The list row used to carry the
 * code, the phone, the plan, the end date, the status and three buttons; on a
 * phone that stacked into roughly 200px per person, so a gym with 128 members
 * was a scroll of some 25,000px. The row now carries a name, a plan and a
 * status, and everything else lives here.
 *
 * A bottom sheet on a phone — where the thumb is — and a panel beside the list
 * on a laptop. Same markup; the difference is entirely in CSS, so there is one
 * of these rather than a phone one and a desktop one that drift apart.
 */
@Component({
  selector: 'app-member-sheet',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './member-sheet.component.html',
})
export class MemberSheetComponent {
  readonly store = inject(ConsoleStore);
  readonly auth = this.store.auth;

  readonly m = computed(() => this.store.selected());
  readonly onFloor = computed(() => {
    const id = this.m()?.id;
    return !!id && this.store.inGymNow().has(id);
  });

  /** This member's own payment that has not finished arriving, if they have one. */
  readonly openPayment = computed(() => {
    const id = this.m()?.id;
    return id ? this.store.openFor(id) : null;
  });

  /** The one sentence the band leads with. */
  headline(): string {
    const m = this.m();
    if (!m) return '';
    if (m.expiry === 'none') return 'No plan yet';
    const when = this.store.day(m.end_date);
    return m.expiry === 'expired' ? `${m.plan_name} · ended ${when}` : `${m.plan_name} · to ${when}`;
  }

  renew(): void {
    const m = this.m();
    if (m) this.store.openRenewal({ id: m.id, full_name: m.full_name, expiry: m.expiry, end_date: m.end_date });
  }
}
