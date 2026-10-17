import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
} from '@ionic/angular';
import { AdminBookingService, CenterInput } from '../data/admin-booking.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { PhotoFieldComponent } from '../shared/photo-field.component';

@Component({
  selector: 'app-admin-center-form',
  templateUrl: './admin-center-form.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    FormsModule, PhotoFieldComponent,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
  ],
})
export class AdminCenterFormPage implements OnInit {
  private api = inject(AdminBookingService);
  private feedback = inject(AdminFeedbackService);
  private nav = inject(NavController);

  /** From the route; absent on /admin/doctors/clinic/new. */
  readonly centerId = input<string>();
  readonly isNew = computed(() => !this.centerId());

  form: CenterInput = { name: '', phone: '', address: '', mapUrl: '', photoUrl: null };
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
    this.api.getCenter(this.centerId()!).subscribe({
      next: ({ data: c }) => {
        this.form = {
          name: c.name,
          phone: c.phone,
          address: c.address ?? '',
          mapUrl: c.map_url ?? '',
          photoUrl: c.photo_url,
        };
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorMessage(err, 'Could not load this clinic.'));
        this.loading.set(false);
      },
    });
  }

  save(): void {
    if (!this.form.name.trim()) return this.formError.set('Give the clinic a name.');
    if (!this.form.phone.trim()) return this.formError.set('Add the clinic’s phone number — staff call it to confirm bookings.');
    this.formError.set(null);

    const request = this.isNew()
      ? this.api.createCenter(this.form)
      : this.api.updateCenter(this.centerId()!, this.form);
    this.saving.set(true);
    request.subscribe({
      next: ({ data }) => {
        this.saving.set(false);
        if (this.isNew()) {
          this.feedback.saved(`Added ${data.name}. Now add its doctors.`);
          // Straight on to the obvious next step instead of back to the list.
          this.nav.navigateForward(['/admin/doctors/clinic', data.id, 'add-doctor'], { replaceUrl: true });
        } else {
          this.feedback.saved('Saved');
          this.nav.navigateBack('/admin/doctors');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err, 'Could not save the clinic.'));
      },
    });
  }
}
