import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
  IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { AdminStoreService, Coupon } from '../data/admin-store.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { plural } from '../shared/plural';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

@Component({
  selector: 'app-admin-coupons',
  templateUrl: './admin-coupons.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
    IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
  ],
})
export class AdminCouponsPage {
  private api = inject(AdminStoreService);
  private feedback = inject(AdminFeedbackService);
  private router = inject(Router);

  readonly coupons = signal<Coupon[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    addIcons({ addOutline });
  }

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    if (this.coupons().length === 0) this.loading.set(true);
    this.error.set(null);
    this.api.listCoupons().subscribe({
      next: (res) => {
        this.coupons.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'Could not load coupons.'));
        this.loading.set(false);
      },
    });
  }

  discount(c: Coupon): string {
    const value = Number(c.value);
    const off = c.discount_type === 'percentage' ? `${value}% off` : `₹${value} off`;
    return c.min_cart_value ? `${off} on orders over ₹${Number(c.min_cart_value)}` : off;
  }

  usage(c: Coupon): string {
    const validity = c.valid_to ? `until ${shortDate(c.valid_to)}` : 'no end date';
    const used = c.usage_limit !== null
      ? `used ${c.times_used} of ${c.usage_limit}`
      : c.times_used ? `used ${plural(c.times_used, 'time')}` : 'not used yet';
    return `${used} · ${validity}`;
  }

  /** Why a coupon customers can't use right now, even though it is switched on. */
  problem(c: Coupon): string | null {
    const now = Date.now();
    if (c.valid_to && new Date(c.valid_to).getTime() < now) return 'Expired';
    if (new Date(c.valid_from).getTime() > now) return 'Not started';
    if (c.usage_limit !== null && c.times_used >= c.usage_limit) return 'Used up';
    return null;
  }

  add(): void {
    this.router.navigateByUrl('/admin/coupons/new');
  }

  open(c: Coupon): void {
    this.router.navigate(['/admin/coupons', c.id]);
  }

  setActive(c: Coupon, active: boolean): void {
    const patch = (v: boolean) => this.coupons.update((list) => list.map((x) => (x.id === c.id ? { ...x, active: v } : x)));
    patch(active);
    this.api.setCouponActive(c.id, active).subscribe({
      error: (err) => {
        patch(!active);
        this.feedback.failed(err, 'Could not update the coupon.');
      },
    });
  }
}
