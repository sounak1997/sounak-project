import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  basketOutline,
  medkitOutline,
  flaskOutline,
  pricetagOutline,
  qrCodeOutline,
  chevronForwardOutline,
} from 'ionicons/icons';
import { AuthService } from '../core/auth.service';

interface Section {
  path: string;
  title: string;
  sub: string;
  icon: string;
  tone: string;
}

@Component({
  selector: 'app-admin-home',
  templateUrl: './admin-home.page.html',
  styleUrls: ['./shared/admin.scss', './admin-home.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon, RouterLink],
})
export class AdminHomePage {
  auth = inject(AuthService);

  readonly sections: Section[] = [
    {
      path: '/admin/products',
      title: 'Grocery items',
      sub: 'Add items, photos, prices and stock',
      icon: 'basket-outline',
      tone: 'amber',
    },
    {
      path: '/admin/doctors',
      title: 'Doctors & clinics',
      sub: 'Clinics, doctors, degrees and visiting hours',
      icon: 'medkit-outline',
      tone: 'green',
    },
    {
      path: '/admin/labs',
      title: 'Test centres',
      sub: 'Labs, their tests, prices and preparation',
      icon: 'flask-outline',
      tone: 'navy',
    },
    {
      path: '/admin/coupons',
      title: 'Coupons',
      sub: 'Discount codes for checkout',
      icon: 'pricetag-outline',
      tone: 'clay',
    },
    {
      path: '/admin/payment-qr',
      title: 'Payment QR',
      sub: 'The UPI QR customers scan to pay',
      icon: 'qr-code-outline',
      tone: 'ink',
    },
  ];

  constructor() {
    addIcons({ basketOutline, medkitOutline, flaskOutline, pricetagOutline, qrCodeOutline, chevronForwardOutline });
  }
}
