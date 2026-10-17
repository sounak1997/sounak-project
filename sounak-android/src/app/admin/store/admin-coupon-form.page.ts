import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonButton, IonList, IonItem, IonInput, IonSegment, IonSegmentButton, IonLabel,
} from '@ionic/angular';
import { AdminStoreService, CouponInput } from '../data/admin-store.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';

interface CouponForm {
  code: string;
  discountType: 'percentage' | 'flat';
  value: string | number;
  minCartValue: string | number;
  usageLimit: string | number;
  validFrom: string; // 'YYYY-MM-DD' in the admin's own time zone
  validTo: string;
}

/** A timestamp as the 'YYYY-MM-DD' a date input shows, in local time. */
const toDateInput = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');

/** Start of the chosen day, local time. */
const startOfDay = (date: string): string => new Date(`${date}T00:00:00`).toISOString();

/** End of the chosen day, local time — "valid until 31 Oct" includes the 31st. */
const endOfDay = (date: string): string => new Date(`${date}T23:59:59`).toISOString();

@Component({
  selector: 'app-admin-coupon-form',
  templateUrl: './admin-coupon-form.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonButton, IonList, IonItem, IonInput, IonSegment, IonSegmentButton, IonLabel,
  ],
})
export class AdminCouponFormPage implements OnInit {
  private api = inject(AdminStoreService);
  private feedback = inject(AdminFeedbackService);
  private nav = inject(NavController);

  /** From the route; absent on /admin/coupons/new. */
  readonly couponId = input<string>();
  readonly isNew = computed(() => !this.couponId());

  form: CouponForm = {
    code: '',
    discountType: 'percentage',
    value: '',
    minCartValue: '',
    usageLimit: '',
    validFrom: toDateInput(new Date().toISOString()),
    validTo: '',
  };
  readonly timesUsed = signal(0);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.isNew()) this.load();
  }

  /** There is no single-coupon endpoint; the list is short, so find it there. */
  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.listCoupons().subscribe({
      next: (res) => {
        const c = res.data.find((x) => x.id === this.couponId());
        if (!c) {
          this.loadError.set('This coupon no longer exists.');
        } else {
          this.form = {
            code: c.code,
            discountType: c.discount_type,
            value: Number(c.value),
            minCartValue: c.min_cart_value !== null ? Number(c.min_cart_value) : '',
            usageLimit: c.usage_limit ?? '',
            validFrom: toDateInput(c.valid_from),
            validTo: toDateInput(c.valid_to),
          };
          this.timesUsed.set(c.times_used);
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorMessage(err, 'Could not load this coupon.'));
        this.loading.set(false);
      },
    });
  }

  private validate(): string | null {
    if (this.isNew() && !/^[A-Za-z0-9_-]{3,20}$/.test(this.form.code.trim())) {
      return 'The code needs 3–20 letters or numbers, no spaces (e.g. DIWALI20).';
    }
    const value = Number(this.form.value);
    if (this.form.value === '' || Number.isNaN(value) || value <= 0) return 'Enter the discount amount.';
    if (this.form.discountType === 'percentage' && value > 100) return 'A percentage discount cannot be more than 100%.';
    if (this.form.usageLimit !== '' && (!Number.isInteger(Number(this.form.usageLimit)) || Number(this.form.usageLimit) < 1)) {
      return 'The usage limit must be a whole number, 1 or more.';
    }
    if (this.form.validFrom && this.form.validTo && this.form.validTo < this.form.validFrom) {
      return 'The end date is before the start date.';
    }
    return null;
  }

  save(): void {
    const problem = this.validate();
    this.formError.set(problem);
    if (problem) return;

    const f = this.form;
    const body: CouponInput = {
      discountType: f.discountType,
      value: Number(f.value),
      minCartValue: f.minCartValue === '' ? null : Number(f.minCartValue),
      usageLimit: f.usageLimit === '' ? null : Number(f.usageLimit),
      // valid_from is required in the database: blank means "now" on create
      // and "leave as it was" on edit.
      validFrom: f.validFrom ? startOfDay(f.validFrom) : null,
      validTo: f.validTo ? endOfDay(f.validTo) : null,
    };
    if (!body.validFrom) delete (body as Partial<CouponInput>).validFrom;

    const request = this.isNew()
      ? this.api.createCoupon({ ...body, code: f.code.trim().toUpperCase() })
      : this.api.updateCoupon(this.couponId()!, body);

    this.saving.set(true);
    request.subscribe({
      next: ({ data }) => {
        this.saving.set(false);
        this.feedback.saved(this.isNew() ? `Created ${data.code}` : 'Saved');
        this.nav.navigateBack('/admin/coupons');
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err, 'Could not save the coupon.'));
      },
    });
  }
}
