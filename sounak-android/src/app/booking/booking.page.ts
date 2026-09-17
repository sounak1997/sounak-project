import { Component, OnInit, inject, signal } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSegment, IonSegmentButton, IonLabel, IonSpinner,
} from '@ionic/angular';
import { MedicalCenterService, MedicalCenter, Doctor } from '../core/medical-center.service';
import { LabService, Lab } from '../core/lab.service';
import { whatsappHrefWithMessage } from '../core/assistant-contact';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

// Weekly strip runs Monday -> Sunday, matching the design prototype, even
// though the DB stores day_of_week as 0=Sunday..6=Saturday (JS convention).
const WEEK_STRIP: { label: string; dayOfWeek: number }[] = [
  { label: 'M', dayOfWeek: 1 },
  { label: 'T', dayOfWeek: 2 },
  { label: 'W', dayOfWeek: 3 },
  { label: 'T', dayOfWeek: 4 },
  { label: 'F', dayOfWeek: 5 },
  { label: 'S', dayOfWeek: 6 },
  { label: 'S', dayOfWeek: 0 },
];

@Component({
  selector: 'app-booking',
  templateUrl: './booking.page.html',
  styleUrls: ['./booking.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSegment, IonSegmentButton, IonLabel, IonSpinner,
    HelperContactComponent,
  ],
})
export class BookingPage implements OnInit {
  private centerService = inject(MedicalCenterService);
  private labService = inject(LabService);

  tab = signal<'doctors' | 'tests'>('doctors');
  centers = signal<MedicalCenter[]>([]);
  labs = signal<Lab[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  readonly weekStrip = WEEK_STRIP;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.centerService.list().subscribe({
      next: (res) => this.centers.set(res.data),
      error: (err) => this.error.set(err?.error?.message || 'Could not load medical centers.'),
    });

    this.labService.list().subscribe({
      next: (res) => {
        this.labs.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load labs.');
        this.loading.set(false);
      },
    });
  }

  onTabChange(value: string | number): void {
    this.tab.set(value as 'doctors' | 'tests');
  }

  isActiveDay(doctor: Doctor, dayOfWeek: number): boolean {
    return doctor.schedule.some((slot) => slot.day_of_week === dayOfWeek);
  }

  doctorMeta(doctor: Doctor): string {
    const days = doctor.schedule
      .slice()
      .sort((a, b) => WEEK_STRIP.findIndex((w) => w.dayOfWeek === a.day_of_week) - WEEK_STRIP.findIndex((w) => w.dayOfWeek === b.day_of_week))
      .map((s) => WEEK_STRIP.find((w) => w.dayOfWeek === s.day_of_week)?.label)
      .join(', ');
    const times = doctor.schedule[0] ? `${doctor.schedule[0].start_time.slice(0, 5)}–${doctor.schedule[0].end_time.slice(0, 5)}` : '';
    return [doctor.specialization, days && `${days} · ${times}`].filter(Boolean).join(' · ');
  }

  // Booking is callback-to-confirm (see docs): this opens WhatsApp pre-filled
  // with exactly what staff needs, rather than posting anything itself —
  // no separate "book" API call to make.
  bookDoctorHref(doctor: Doctor, center: MedicalCenter): string {
    return whatsappHrefWithMessage(
      `Hi, I'd like to book an appointment with ${doctor.name} at ${center.name}.`
    );
  }

  bookTestHref(testName: string, labName: string): string {
    return whatsappHrefWithMessage(`Hi, I'd like to book "${testName}" at ${labName}.`);
  }
}
