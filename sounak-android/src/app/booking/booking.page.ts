import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSegment, IonSegmentButton, IonLabel, IonSpinner,
} from '@ionic/angular';
import { MedicalCenterService, MedicalCenter, Doctor, DoctorScheduleSlot } from '../core/medical-center.service';
import { LabService, Lab, LabTest } from '../core/lab.service';
import { environment } from '../../environments/environment';
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

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "17:00:00" -> "5 PM", "09:30:00" -> "9:30 AM". */
function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * "5–8 PM" when both ends share AM/PM, otherwise "10 AM–1 PM". Non-breaking
 * spaces inside, so a long line wraps between sittings, never mid-range.
 */
function formatRange(start: string, end: string): string {
  const from = formatTime(start);
  const to = formatTime(end);
  const range = from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
  // U+2060 (word joiner) either side of the dash: browsers otherwise break after it.
  return range.replace(/ /g, '\u00a0').replace('–', '\u2060–\u2060');
}

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
  /** A clinic the admin has added but not yet staffed has nothing to book. */
  bookableCenters = computed(() => this.centers().filter((c) => c.doctors.length > 0));
  labs = signal<Lab[]>([]);
  bookableLabs = computed(() => this.labs().filter((l) => l.tests.length > 0));
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

  /** "General physician · MBBS, MD (Medicine)" */
  doctorTitle(doctor: Doctor): string {
    return [doctor.specialization, doctor.qualification].filter(Boolean).join(' · ');
  }

  /** "12 yrs experience · ₹400 fee · Bengali, Hindi" — whatever has been filled in. */
  doctorFacts(doctor: Doctor): string {
    return [
      doctor.experience_years ? `${doctor.experience_years} yrs experience` : null,
      doctor.consultation_fee ? `₹${Number(doctor.consultation_fee)} fee` : null,
      doctor.languages,
    ].filter(Boolean).join(' · ');
  }

  /**
   * Visiting hours, with days that share the same sittings grouped:
   * ["Mon, Wed, Fri · 5–8 PM", "Sat · 10 AM–1 PM, 5–8 PM"]. A doctor can sit
   * twice in a day, so every sitting is listed rather than just the first.
   */
  hoursSummary(doctor: Doctor): string[] {
    const byDay = new Map<number, DoctorScheduleSlot[]>();
    for (const slot of doctor.schedule) {
      byDay.set(slot.day_of_week, [...(byDay.get(slot.day_of_week) ?? []), slot]);
    }
    const groups = new Map<string, string[]>();
    for (const day of WEEK_STRIP) {
      const slots = byDay.get(day.dayOfWeek);
      if (!slots) continue;
      const hours = slots
        .slice()
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .map((s) => formatRange(s.start_time, s.end_time))
        .join(', ');
      groups.set(hours, [...(groups.get(hours) ?? []), DAY_SHORT[day.dayOfWeek]]);
    }
    return [...groups].map(([hours, days]) => `${days.join(', ')} · ${hours}`);
  }

  testFacts(test: LabTest): string[] {
    return [test.sample_type, test.preparation, test.report_time && `Report: ${test.report_time}`].filter(
      (v): v is string => !!v
    );
  }

  photo(path: string | null): string | null {
    return path ? `${environment.apiUrl}${path}` : null;
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
