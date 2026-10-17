import { Component, OnInit, inject, signal } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon, IonSpinner, IonButton } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { qrCodeOutline } from 'ionicons/icons';
import { AdminStoreService, PaymentQr } from '../data/admin-store.service';
import { AdminImagesService } from '../data/admin-images.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';

@Component({
  selector: 'app-admin-payment-qr',
  templateUrl: './admin-payment-qr.page.html',
  styleUrls: ['../shared/admin.scss', './admin-payment-qr.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon, IonSpinner, IonButton],
})
export class AdminPaymentQrPage implements OnInit {
  private api = inject(AdminStoreService);
  private feedback = inject(AdminFeedbackService);
  images = inject(AdminImagesService);

  readonly qr = signal<PaymentQr | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly uploading = signal(false);

  constructor() {
    addIcons({ qrCodeOutline });
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getQr().subscribe({
      next: (res) => {
        this.qr.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'Could not load the payment QR.'));
        this.loading.set(false);
      },
    });
  }

  updatedLabel(): string | null {
    const at = this.qr()?.updated_at;
    if (!at || !this.qr()?.qr_image_url) return null;
    return new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async onPicked(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;

    // Money goes wherever this QR points, so replacing it gets one deliberate tap.
    if (this.qr()?.qr_image_url) {
      const ok = await this.feedback.confirm(
        'Replace the payment QR?',
        'Customers paying by Scan & Pay will send money to the new QR from now on. Check it is your account before confirming.',
        'Replace'
      );
      if (!ok) return;
    }

    this.uploading.set(true);
    this.api.uploadQr(file).subscribe({
      next: (res) => {
        this.qr.set(res.data);
        this.uploading.set(false);
        this.feedback.saved('Payment QR updated');
      },
      error: (err) => {
        this.uploading.set(false);
        this.feedback.failed(err, 'Could not upload the QR.');
      },
    });
  }
}
