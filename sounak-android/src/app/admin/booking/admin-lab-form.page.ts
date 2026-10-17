import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
} from '@ionic/angular';
import { AdminBookingService, LabInput } from '../data/admin-booking.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { PhotoFieldComponent } from '../shared/photo-field.component';

@Component({
  selector: 'app-admin-lab-form',
  templateUrl: './admin-lab-form.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    FormsModule, PhotoFieldComponent,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
  ],
})
export class AdminLabFormPage implements OnInit {
  private api = inject(AdminBookingService);
  private feedback = inject(AdminFeedbackService);
  private nav = inject(NavController);

  /** From the route; absent on /admin/labs/new. */
  readonly labId = input<string>();
  readonly isNew = computed(() => !this.labId());

  readonly accreditations = ['NABL', 'ISO 15189', 'CAP'];
  form: LabInput = {
    name: '', phone: '', address: '', openingHours: '', accreditation: '', mapUrl: '', photoUrl: null,
  };
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.isNew()) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getLab(this.labId()!).subscribe({
      next: ({ data: l }) => {
        this.form = {
          name: l.name,
          phone: l.phone,
          address: l.address ?? '',
          openingHours: l.opening_hours ?? '',
          accreditation: l.accreditation ?? '',
          mapUrl: l.map_url ?? '',
          photoUrl: l.photo_url,
        };
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorMessage(err, 'Could not load this test centre.'));
        this.loading.set(false);
      },
    });
  }

  save(): void {
    if (!this.form.name.trim()) return this.formError.set('Give the test centre a name.');
    if (!this.form.phone.trim()) return this.formError.set('Add a phone number — staff call it to confirm bookings.');
    this.formError.set(null);

    const request = this.isNew() ? this.api.createLab(this.form) : this.api.updateLab(this.labId()!, this.form);
    this.saving.set(true);
    request.subscribe({
      next: ({ data }) => {
        this.saving.set(false);
        if (this.isNew()) {
          this.feedback.saved(`Added ${data.name}. Now add its tests.`);
          this.nav.navigateForward(['/admin/labs', data.id, 'add-test'], { replaceUrl: true });
        } else {
          this.feedback.saved('Saved');
          this.nav.navigateBack('/admin/labs');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err, 'Could not save the test centre.'));
      },
    });
  }
}
