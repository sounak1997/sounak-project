import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConsoleStore, MemberScope } from '../console.store';
import { IconComponent } from '../icon.component';
import { MemberSheetComponent } from './member-sheet.component';

/**
 * The member list: search first, one line per person.
 *
 * Search is at the top rather than below a registration form, because the desk
 * looks somebody up many times an hour and registers somebody a few times a
 * day. Registering moved into a dialog for the same reason.
 *
 * The list is ordered by what needs doing — expiring before lapsed before
 * never-started before current — so the top of the screen is always the work.
 */
@Component({
  selector: 'app-members',
  standalone: true,
  imports: [FormsModule, IconComponent, MemberSheetComponent],
  templateUrl: './members.page.html',
})
export class MembersPage {
  readonly store = inject(ConsoleStore);

  setScope(scope: MemberScope): void {
    this.store.scope.set(scope);
  }
}
