import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ConsoleStore } from './console.store';
import { IconComponent } from './icon.component';

/**
 * The console's frame: who you are, where you can go, and every dialog.
 *
 * The four screens inside are routed children rather than sections of one
 * scroll — setting up a payment gateway and finding a member at the desk are
 * different jobs, and on a phone they were thousands of pixels apart on the
 * same page.
 *
 * The dialogs live here, not in the pages, because more than one page opens the
 * same ones: a renewal starts from the worklist on Today, from a row on
 * Members and from the sheet. Holding them in the shell means one copy and one
 * piece of state in the store.
 */
@Component({
  selector: 'app-console',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    FormsModule,
    IconComponent,
  ],
  templateUrl: './console.shell.html',
})
export class ConsoleShell {
  readonly store = inject(ConsoleStore);
  readonly auth = inject(AuthService);

  constructor() {
    // "Marked present." is true of the tab it was said on and confusing on the
    // next one, so a message lasts as long as the screen that produced it.
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.store.notice.set('');
        this.store.error.set('');
      });
  }

  /** Staff never see the gym's takings, so their third tab is their own cash. */
  moneyLabel(): string {
    return this.auth.isOwner() ? 'Money' : 'My cash';
  }
}
