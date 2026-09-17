// src/app/shared/helper-contact/helper-contact.component.ts
//
// Reusable "call/WhatsApp the assistant" banner (FR-3.10). Dropped into any
// screen where a customer might otherwise get stuck — can't find an item,
// wants to order verbally, wants to book by phone instead of the app — so
// the fallback is always one tap away instead of only living on the
// standalone Helper page.
import { Component, Input } from '@angular/core';
import { IonIcon, IonButton } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { callOutline, logoWhatsapp } from 'ionicons/icons';
import { ASSISTANT_CONTACT } from '../../core/assistant-contact';

@Component({
  selector: 'app-helper-contact',
  templateUrl: './helper-contact.component.html',
  styleUrls: ['./helper-contact.component.scss'],
  imports: [IonIcon, IonButton],
})
export class HelperContactComponent {
  /** Context-specific lead-in line; each host screen sets its own. */
  @Input() message = 'Need a hand? Call or WhatsApp the assistant.';

  readonly contact = ASSISTANT_CONTACT;

  constructor() {
    addIcons({ callOutline, logoWhatsapp });
  }
}
