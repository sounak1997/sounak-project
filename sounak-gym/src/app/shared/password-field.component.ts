import { Component, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * A password input with a show/hide toggle.
 *
 * One component rather than a toggle copied into each form: there are six
 * password fields across sign-in, sign-up, reset, the door card and the gateway
 * keys, and they should behave identically. Typing a password you cannot see,
 * on a phone, with autocorrect fighting you, is where sign-in attempts are
 * quietly lost.
 *
 * Starts hidden. Revealing is a deliberate act, because the common case is
 * typing it in a gym where other people can see the screen.
 */
@Component({
  selector: 'app-password-field',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="pw">
      <input
        [id]="fieldId()"
        [type]="visible() ? 'text' : 'password'"
        [attr.autocomplete]="autocomplete()"
        [attr.placeholder]="placeholder()"
        [attr.inputmode]="visible() ? 'text' : null"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)"
        (keyup.enter)="submitted.emit()" />
      <button
        type="button"
        class="pw__toggle"
        (click)="visible.set(!visible())"
        [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
        [attr.aria-pressed]="visible()"
        tabindex="-1">
        <!-- Inline SVG rather than an icon font: two icons is not worth a
             dependency or the flash of missing glyph while a font loads. -->
        @if (visible()) {
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            <line x1="3" y1="21" x2="21" y2="3" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
      </button>
    </div>
  `,
  styles: [`
    .pw { position: relative; }
    /* Room for the button, so a long password never runs underneath it. */
    .pw input { padding-right: 46px; }
    .pw__toggle {
      position: absolute;
      top: 50%;
      right: 6px;
      transform: translateY(-50%);
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
      color: var(--text-muted);
      border-radius: 8px;
    }
    .pw__toggle:hover { color: var(--purple); background: rgba(108, 87, 226, 0.08); }
    .pw__toggle svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `],
})
export class PasswordFieldComponent {
  /** Two-way bound: [(value)]="password" at the call site. */
  readonly value = model<string>('');
  readonly fieldId = input<string>('password');
  readonly autocomplete = input<string>('current-password');
  readonly placeholder = input<string>('');
  /** Enter in the field, so a form can submit without reaching for the button. */
  readonly submitted = output<void>();

  readonly visible = signal(false);
}
