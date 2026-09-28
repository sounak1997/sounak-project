import { Component, input } from '@angular/core';

/**
 * The console's icon set, inline.
 *
 * Inline SVG rather than an icon font or emoji: these have to take their colour
 * from the row they sit in (a tinted status square, a dark rail, a purple tab)
 * and stay crisp on a phone. Stroke-only, one visual weight, 24px grid.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="weight()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      @switch (name()) {
        @case ('today') {
          <polyline points="3 12.5 7 12.5 10 5 14 19 17 12.5 21 12.5" />
        }
        @case ('members') {
          <path d="M15.5 20v-1.6a3.9 3.9 0 0 0-3.9-3.9H6.4A3.9 3.9 0 0 0 2.5 18.4V20" />
          <circle cx="9" cy="7.2" r="3.4" />
          <path d="M17 4.2a3.4 3.4 0 0 1 0 6.6" />
          <path d="M21.5 20v-1.6a3.9 3.9 0 0 0-2.8-3.7" />
        }
        @case ('money') {
          <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
          <circle cx="12" cy="12" r="2.6" />
        }
        @case ('setup') {
          <circle cx="12" cy="12" r="2.9" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.84 2.84l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.84-2.84l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.66 8.7a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.84-2.84l.06.06a1.7 1.7 0 0 0 1.88.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.84 2.84l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1A1.7 1.7 0 0 0 19.4 15z" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4.4-4.4" />
        }
        @case ('chev') {
          <polyline points="9 6 15 12 9 18" />
        }
        @case ('chev-down') {
          <polyline points="6 9 12 15 18 9" />
        }
        @case ('phone') {
          <path
            d="M6.4 3h3.1l1.9 4.8-2.4 1.5a11.4 11.4 0 0 0 5.7 5.7l1.5-2.4L21 14.5v3.1a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.4 5.2 2 2 0 0 1 6.4 3z" />
        }
        @case ('refresh') {
          <path d="M20.5 11.5a8.5 8.5 0 1 0-2.6 6.1" />
          <polyline points="20.5 4.5 20.5 11.5 13.5 11.5" />
        }
        @case ('plus') {
          <path d="M12 5.5v13" />
          <path d="M5.5 12h13" />
        }
        @case ('check') {
          <polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
        }
        @case ('check-circle') {
          <circle cx="12" cy="12" r="9" />
          <polyline points="8 12.4 11 15.3 16.2 9.2" />
        }
        @case ('close') {
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        }
        @case ('alert') {
          <path d="M12 4.5 2.8 19.5h18.4z" />
          <path d="M12 10v4" />
          <path d="M12 17h0" />
        }
        @case ('edit') {
          <path d="M15.2 4.6l4.2 4.2L8.8 19.4H4.6v-4.2z" />
        }
        @case ('qr') {
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <path d="M14 14h3v3h-3z" />
          <path d="M20.5 17.5v3h-3" />
        }
        @case ('out') {
          <path d="M9.5 20H5.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
          <polyline points="15.5 16.5 20 12 15.5 7.5" />
          <path d="M20 12H9.5" />
        }
      }
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; }'],
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input(20);
  readonly weight = input(2);
}
