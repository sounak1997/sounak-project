// src/app/admin/shared/admin-feedback.service.ts
//
// Toasts for the admin screens, and one place that turns an HTTP error into a
// sentence. The backend answers in three shapes ({ message } from controllers
// and the error handler, { error } from the rate limiter, and nothing at all
// when Render is still waking up), and every screen needs the same reading.
import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AlertController, ToastController } from '@ionic/angular';

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return 'Could not reach the server. It may be waking up — try again in a minute.';
    }
    const body = err.error;
    if (body && typeof body === 'object') {
      return body.message || body.error || fallback;
    }
    if (typeof body === 'string' && body.length < 200) return body;
  }
  return fallback;
}

@Injectable({ providedIn: 'root' })
export class AdminFeedbackService {
  private toasts = inject(ToastController);
  private alerts = inject(AlertController);

  async saved(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 1800, color: 'success', position: 'bottom' });
    await toast.present();
  }

  async failed(err: unknown, fallback: string): Promise<void> {
    const toast = await this.toasts.create({
      message: errorMessage(err, fallback),
      duration: 3500,
      color: 'danger',
      position: 'bottom',
    });
    await toast.present();
  }

  /** Resolves true only if the admin taps the confirming button. */
  async confirm(header: string, message: string, confirmText: string): Promise<boolean> {
    const alert = await this.alerts.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: confirmText, role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
}
