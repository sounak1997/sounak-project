import { Component } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent } from '@ionic/angular';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

@Component({
  selector: 'app-helper',
  templateUrl: './helper.page.html',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, HelperContactComponent],
})
export class HelperPage {}
