import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
  IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, closeOutline, copyOutline } from 'ionicons/icons';
import { DoctorScheduleSlot } from '../../core/medical-center.service';
import { AdminBookingService, DoctorInput, ScheduleSlotInput } from '../data/admin-booking.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { PhotoFieldComponent } from '../shared/photo-field.component';
import { WEEK, hhmm } from './week';

interface Sitting {
  start: string;
  end: string;
}

interface DayRow {
  dayOfWeek: number;
  short: string;
  long: string;
  sittings: Sitting[];
}

/** Tap-to-fill suggestions; any other text can still be typed. */
const SPECIALIZATIONS = [
  'General physician', 'Paediatrician', 'Gynaecologist', 'Dentist', 'Orthopaedic',
  'ENT', 'Dermatologist', 'Cardiologist', 'Eye specialist', 'Diabetologist',
  'Neurologist', 'Psychiatrist', 'Physiotherapist',
];

type DoctorDetails = Omit<DoctorInput, 'slots'>;

const blankDetails = (): DoctorDetails => ({
  name: '',
  specialization: '',
  qualification: '',
  experienceYears: '',
  consultationFee: '',
  registrationNo: '',
  languages: '',
  about: '',
  photoUrl: null,
});

@Component({
  selector: 'app-admin-doctor-form',
  templateUrl: './admin-doctor-form.page.html',
  styleUrls: ['../shared/admin.scss', './admin-doctor-form.page.scss'],
  imports: [
    FormsModule, PhotoFieldComponent,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
    IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
  ],
})
export class AdminDoctorFormPage implements OnInit {
  private api = inject(AdminBookingService);
  private feedback = inject(AdminFeedbackService);
  private alerts = inject(AlertController);
  private nav = inject(NavController);

  /** /admin/doctors/clinic/:centerId/add-doctor */
  readonly centerId = input<string>();
  /** /admin/doctors/:doctorId */
  readonly doctorId = input<string>();
  readonly isNew = computed(() => !this.doctorId());

  readonly specializations = SPECIALIZATIONS;
  form: DoctorDetails = blankDetails();
  readonly week = signal<DayRow[]>(this.emptyWeek());
  readonly centerName = signal('');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  constructor() {
    addIcons({ addOutline, closeOutline, copyOutline });
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    if (this.isNew()) {
      this.api.getCenter(this.centerId()!).subscribe({
        next: ({ data }) => {
          this.centerName.set(data.name);
          this.loading.set(false);
        },
        error: (err) => {
          this.loadError.set(errorMessage(err, 'Could not load the clinic.'));
          this.loading.set(false);
        },
      });
      return;
    }

    this.api.getDoctor(this.doctorId()!).subscribe({
      next: ({ data: d }) => {
        this.centerName.set(d.center_name);
        this.form = {
          name: d.name,
          specialization: d.specialization ?? '',
          qualification: d.qualification ?? '',
          experienceYears: d.experience_years ?? '',
          consultationFee: d.consultation_fee ?? '',
          registrationNo: d.registration_no ?? '',
          languages: d.languages ?? '',
          about: d.about ?? '',
          photoUrl: d.photo_url,
        };
        this.week.set(this.weekFrom(d.schedule));
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorMessage(err, 'Could not load this doctor.'));
        this.loading.set(false);
      },
    });
  }

  // --- Weekly hours -----------------------------------------------------------

  private emptyWeek(): DayRow[] {
    return WEEK.map((d) => ({ ...d, sittings: [] }));
  }

  private weekFrom(schedule: DoctorScheduleSlot[]): DayRow[] {
    return WEEK.map((d) => ({
      ...d,
      sittings: schedule
        .filter((s) => s.day_of_week === d.dayOfWeek)
        .map((s) => ({ start: hhmm(s.start_time), end: hhmm(s.end_time) })),
    }));
  }

  private updateDay(dayOfWeek: number, change: (sittings: Sitting[]) => Sitting[]): void {
    this.week.update((days) =>
      days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, sittings: change(d.sittings) } : d))
    );
  }

  /** The first sitting defaults to a typical 10–1; a second (evening) one is left blank to fill in. */
  addSitting(day: DayRow): void {
    const next = day.sittings.length ? { start: '', end: '' } : { start: '10:00', end: '13:00' };
    this.updateDay(day.dayOfWeek, (s) => [...s, next]);
  }

  removeSitting(day: DayRow, index: number): void {
    this.updateDay(day.dayOfWeek, (s) => s.filter((_, i) => i !== index));
  }

  setTime(day: DayRow, index: number, key: keyof Sitting, value: string): void {
    this.updateDay(day.dayOfWeek, (s) => s.map((sitting, i) => (i === index ? { ...sitting, [key]: value } : sitting)));
  }

  /** "Same hours on…" — copy one day's sittings onto the days the admin ticks. */
  async copyDay(day: DayRow): Promise<void> {
    const alert = await this.alerts.create({
      header: `Copy ${day.long}'s hours to`,
      inputs: WEEK.filter((d) => d.dayOfWeek !== day.dayOfWeek).map((d) => ({
        type: 'checkbox' as const,
        label: d.long,
        value: d.dayOfWeek,
        // Weekdays are the usual pattern, so pre-tick them from a weekday.
        checked: day.dayOfWeek >= 1 && day.dayOfWeek <= 5 && d.dayOfWeek >= 1 && d.dayOfWeek <= 5,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Copy', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: number[] }>();
    if (role !== 'confirm' || !data?.values?.length) return;

    const targets = new Set(data.values);
    this.week.update((days) =>
      days.map((d) => (targets.has(d.dayOfWeek) ? { ...d, sittings: day.sittings.map((s) => ({ ...s })) } : d))
    );
  }

  private slots(): ScheduleSlotInput[] {
    return this.week().flatMap((d) =>
      d.sittings.map((s) => ({ dayOfWeek: d.dayOfWeek, startTime: s.start, endTime: s.end }))
    );
  }

  // --- Save ---------------------------------------------------------------------

  private validate(): string | null {
    if (!this.form.name.trim()) return 'Enter the doctor’s name.';
    for (const day of this.week()) {
      for (const s of day.sittings) {
        if (!s.start || !s.end) return `${day.long}: fill in both times, or remove that row.`;
        if (s.end <= s.start) return `${day.long}: the end time must be after the start time.`;
      }
    }
    return null;
  }

  save(): void {
    const problem = this.validate();
    this.formError.set(problem);
    if (problem) return;

    const body: DoctorInput = { ...this.form, slots: this.slots() };
    const request = this.isNew()
      ? this.api.createDoctor(this.centerId()!, body)
      : this.api.updateDoctor(this.doctorId()!, body);

    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.feedback.saved(this.isNew() ? `Added ${body.name.trim()}` : 'Saved');
        this.nav.navigateBack('/admin/doctors');
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err, 'Could not save the doctor.'));
      },
    });
  }
}
