import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
  IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, searchOutline, businessOutline, personOutline } from 'ionicons/icons';
import { Doctor, MedicalCenter } from '../../core/medical-center.service';
import { AdminBookingService } from '../data/admin-booking.service';
import { AdminImagesService } from '../data/admin-images.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { daysSummary } from './week';
import { plural } from '../shared/plural';

@Component({
  selector: 'app-admin-centers',
  templateUrl: './admin-centers.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
    IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
  ],
})
export class AdminCentersPage {
  private api = inject(AdminBookingService);
  private feedback = inject(AdminFeedbackService);
  private router = inject(Router);
  images = inject(AdminImagesService);
  readonly plural = plural;

  readonly centers = signal<MedicalCenter[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal('');

  /** Matches a clinic by its own name or by any of its doctors. */
  readonly visible = computed(() => {
    const q = this.search().toLowerCase();
    if (!q) return this.centers();
    return this.centers()
      .map((center) => {
        if (center.name.toLowerCase().includes(q)) return center;
        const doctors = center.doctors.filter((d) =>
          [d.name, d.specialization].some((v) => v?.toLowerCase().includes(q))
        );
        return doctors.length ? { ...center, doctors } : null;
      })
      .filter((c): c is MedicalCenter => c !== null);
  });

  readonly doctorCount = computed(() => this.centers().reduce((n, c) => n + c.doctors.length, 0));

  constructor() {
    addIcons({ addOutline, searchOutline, businessOutline, personOutline });
  }

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    if (this.centers().length === 0) this.loading.set(true);
    this.error.set(null);
    this.api.listCenters().subscribe({
      next: (res) => {
        this.centers.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'Could not load clinics.'));
        this.loading.set(false);
      },
    });
  }

  doctorLine(doctor: Doctor): string {
    const days = daysSummary(doctor.schedule);
    return [doctor.specialization, doctor.qualification, days || 'No hours set'].filter(Boolean).join(' · ');
  }

  addCenter(): void {
    this.router.navigateByUrl('/admin/doctors/clinic/new');
  }

  editCenter(center: MedicalCenter): void {
    this.router.navigate(['/admin/doctors/clinic', center.id]);
  }

  addDoctor(center: MedicalCenter): void {
    this.router.navigate(['/admin/doctors/clinic', center.id, 'add-doctor']);
  }

  editDoctor(doctor: Doctor): void {
    this.router.navigate(['/admin/doctors', doctor.id]);
  }

  setCenterVisible(center: MedicalCenter, active: boolean): void {
    const patch = (v: boolean) =>
      this.centers.update((list) => list.map((c) => (c.id === center.id ? { ...c, active: v } : c)));
    patch(active);
    this.api.setCenterActive(center.id, active).subscribe({
      error: (err) => {
        patch(!active);
        this.feedback.failed(err, 'Could not update the clinic.');
      },
    });
  }

  setDoctorVisible(doctor: Doctor, active: boolean): void {
    const patch = (v: boolean) =>
      this.centers.update((list) =>
        list.map((c) => ({ ...c, doctors: c.doctors.map((d) => (d.id === doctor.id ? { ...d, active: v } : d)) }))
      );
    patch(active);
    this.api.setDoctorActive(doctor.id, active).subscribe({
      error: (err) => {
        patch(!active);
        this.feedback.failed(err, 'Could not update the doctor.');
      },
    });
  }
}
