import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
} from '@ionic/angular';
import { AdminBookingService, TestInput } from '../data/admin-booking.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';

const blankForm = (): TestInput => ({
  name: '', price: '', description: '', sampleType: '', preparation: '', reportTime: '',
});

@Component({
  selector: 'app-admin-test-form',
  templateUrl: './admin-test-form.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea,
  ],
})
export class AdminTestFormPage implements OnInit {
  private api = inject(AdminBookingService);
  private feedback = inject(AdminFeedbackService);
  private nav = inject(NavController);

  /** /admin/labs/:labId/add-test */
  readonly labId = input<string>();
  /** /admin/tests/:testId */
  readonly testId = input<string>();
  readonly isNew = computed(() => !this.testId());

  // Tap-to-fill suggestions; anything else can be typed.
  readonly commonTests = [
    'Complete blood count (CBC)', 'Blood sugar (fasting)', 'HbA1c', 'Lipid profile', 'Thyroid profile (T3, T4, TSH)',
    'Liver function test (LFT)', 'Kidney function test (KFT)', 'Vitamin D', 'Vitamin B12', 'Urine routine',
    'ECG', 'Chest X-ray', 'Ultrasound (whole abdomen)',
  ];
  readonly sampleTypes = ['Blood', 'Urine', 'Stool', 'Swab', 'Imaging', 'None'];
  readonly preparations = ['No preparation needed', '10–12 hours fasting', 'First morning urine sample', 'Full bladder'];
  readonly reportTimes = ['Same day', 'Within 24 hours', '2–3 days', 'Report on the spot'];

  form: TestInput = blankForm();
  readonly labName = signal('');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    if (this.isNew()) {
      this.api.getLab(this.labId()!).subscribe({
        next: ({ data }) => {
          this.labName.set(data.name);
          this.loading.set(false);
        },
        error: (err) => {
          this.loadError.set(errorMessage(err, 'Could not load the test centre.'));
          this.loading.set(false);
        },
      });
      return;
    }

    this.api.getTest(this.testId()!).subscribe({
      next: ({ data: t }) => {
        this.labName.set(t.lab_name);
        this.form = {
          name: t.name,
          price: t.price ?? '',
          description: t.description ?? '',
          sampleType: t.sample_type ?? '',
          preparation: t.preparation ?? '',
          reportTime: t.report_time ?? '',
        };
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorMessage(err, 'Could not load this test.'));
        this.loading.set(false);
      },
    });
  }

  save(addAnother = false): void {
    if (!this.form.name.trim()) return this.formError.set('Enter the test’s name.');
    if (this.form.price !== '' && (Number.isNaN(Number(this.form.price)) || Number(this.form.price) < 0)) {
      return this.formError.set('The price must be a number.');
    }
    this.formError.set(null);

    const request = this.isNew()
      ? this.api.createTest(this.labId()!, this.form)
      : this.api.updateTest(this.testId()!, this.form);
    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.feedback.saved(this.isNew() ? `Added ${this.form.name.trim()}` : 'Saved');
        if (addAnother) {
          this.form = blankForm();
        } else {
          this.nav.navigateBack('/admin/labs');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err, 'Could not save the test.'));
      },
    });
  }
}
