import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonList, IonItem, IonLabel, IonInput, IonTextarea, IonSelect, IonSelectOption,
  IonButton, IonSpinner, IonChip, ToastController,
} from '@ionic/angular';
import { AssistanceService, AssistanceReason, AssistanceRequest } from '../core/assistance.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

@Component({
  selector: 'app-helper',
  templateUrl: './helper.page.html',
  styleUrls: ['./helper.page.scss'],
  imports: [
    DatePipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonList, IonItem, IonLabel, IonInput, IonTextarea, IonSelect, IonSelectOption,
    IonButton, IonSpinner, IonChip,
    HelperContactComponent,
  ],
})
export class HelperPage implements OnInit {
  private assistanceService = inject(AssistanceService);
  private toastController = inject(ToastController);

  readonly reasons: { value: AssistanceReason; label: string }[] = [
    { value: 'place_order', label: 'Place an order over the phone' },
    { value: 'general_help', label: 'General help' },
    { value: 'delivery_issue', label: 'A delivery issue' },
    { value: 'custom', label: 'Something else' },
  ];

  reason: AssistanceReason = 'place_order';
  phone = '';
  note = '';

  submitting = signal(false);
  requests = signal<AssistanceRequest[]>([]);
  loadingRequests = signal(true);

  ngOnInit(): void {
    this.loadRequests();
  }

  private loadRequests(): void {
    this.loadingRequests.set(true);
    this.assistanceService.listMine().subscribe({
      next: (res) => {
        this.requests.set(res.data);
        this.loadingRequests.set(false);
      },
      error: () => this.loadingRequests.set(false),
    });
  }

  reasonLabel(reason: AssistanceReason): string {
    return this.reasons.find((r) => r.value === reason)?.label ?? reason;
  }

  statusColor(status: AssistanceRequest['status']): string {
    if (status === 'resolved') return 'success';
    if (status === 'contacted') return 'tertiary';
    return 'warning';
  }

  submit(): void {
    if (!this.phone.trim()) {
      this.showToast('Enter a phone number we can call you back on.', 'danger');
      return;
    }

    this.submitting.set(true);
    this.assistanceService.create(this.reason, this.phone.trim(), this.note.trim() || undefined).subscribe({
      next: async () => {
        this.submitting.set(false);
        this.note = '';
        this.loadRequests();
        await this.showToast("Request received — we'll call you back shortly.", 'success');
      },
      error: async (err) => {
        this.submitting.set(false);
        await this.showToast(err?.error?.message || 'Could not send your request.', 'danger');
      },
    });
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }
}
