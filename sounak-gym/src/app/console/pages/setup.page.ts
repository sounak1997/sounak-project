import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { ConsoleStore } from '../console.store';
import { IconComponent } from '../icon.component';

/**
 * The things you set up once: the door poster, the UPI QR, the gateway, plans.
 *
 * These used to sit at the bottom of the same scroll as the member list, so
 * pasting a QR link meant scrolling past 128 members to reach it. Nothing here
 * is daily work, which is exactly why it belongs behind its own tab.
 */
@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, PasswordFieldComponent],
  templateUrl: './setup.page.html',
})
export class SetupPage {
  readonly store = inject(ConsoleStore);
  readonly auth = this.store.auth;
}
