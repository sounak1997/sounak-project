import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
  IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, searchOutline, flaskOutline } from 'ionicons/icons';
import { Lab, LabTest } from '../../core/lab.service';
import { AdminBookingService } from '../data/admin-booking.service';
import { AdminImagesService } from '../data/admin-images.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { plural } from '../shared/plural';

@Component({
  selector: 'app-admin-labs',
  templateUrl: './admin-labs.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
    IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
  ],
})
export class AdminLabsPage {
  private api = inject(AdminBookingService);
  private feedback = inject(AdminFeedbackService);
  private router = inject(Router);
  images = inject(AdminImagesService);
  readonly plural = plural;

  readonly labs = signal<Lab[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal('');

  /** Matches a lab by its own name or by any test it offers. */
  readonly visible = computed(() => {
    const q = this.search().toLowerCase();
    if (!q) return this.labs();
    return this.labs()
      .map((lab) => {
        if (lab.name.toLowerCase().includes(q)) return lab;
        const tests = lab.tests.filter((t) => t.name.toLowerCase().includes(q));
        return tests.length ? { ...lab, tests } : null;
      })
      .filter((l): l is Lab => l !== null);
  });

  readonly testCount = computed(() => this.labs().reduce((n, l) => n + l.tests.length, 0));

  constructor() {
    addIcons({ addOutline, searchOutline, flaskOutline });
  }

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    if (this.labs().length === 0) this.loading.set(true);
    this.error.set(null);
    this.api.listLabs().subscribe({
      next: (res) => {
        this.labs.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'Could not load test centres.'));
        this.loading.set(false);
      },
    });
  }

  labLine(lab: Lab): string {
    return [lab.phone, lab.opening_hours, lab.accreditation].filter(Boolean).join(' · ');
  }

  testLine(test: LabTest): string {
    return [test.price ? `₹${test.price}` : 'No price set', test.sample_type, test.report_time].filter(Boolean).join(' · ');
  }

  addLab(): void {
    this.router.navigateByUrl('/admin/labs/new');
  }

  editLab(lab: Lab): void {
    this.router.navigate(['/admin/labs', lab.id]);
  }

  addTest(lab: Lab): void {
    this.router.navigate(['/admin/labs', lab.id, 'add-test']);
  }

  editTest(test: LabTest): void {
    this.router.navigate(['/admin/tests', test.id]);
  }

  setLabVisible(lab: Lab, active: boolean): void {
    const patch = (v: boolean) => this.labs.update((list) => list.map((l) => (l.id === lab.id ? { ...l, active: v } : l)));
    patch(active);
    this.api.setLabActive(lab.id, active).subscribe({
      error: (err) => {
        patch(!active);
        this.feedback.failed(err, 'Could not update the test centre.');
      },
    });
  }

  setTestVisible(test: LabTest, active: boolean): void {
    const patch = (v: boolean) =>
      this.labs.update((list) =>
        list.map((l) => ({ ...l, tests: l.tests.map((t) => (t.id === test.id ? { ...t, active: v } : t)) }))
      );
    patch(active);
    this.api.setTestActive(test.id, active).subscribe({
      error: (err) => {
        patch(!active);
        this.feedback.failed(err, 'Could not update the test.');
      },
    });
  }
}
