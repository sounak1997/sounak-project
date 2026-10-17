// src/app/admin/data/admin-store.service.ts
//
// Shop-wide settings: discount coupons and the Scan & Pay QR shown at checkout.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Coupon {
  id: string;
  code: string;
  discount_type: 'percentage' | 'flat';
  value: string;
  min_cart_value: string | null;
  usage_limit: number | null;
  times_used: number;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
}

export interface CouponInput {
  code?: string; // create only — a code customers already have cannot change
  discountType: 'percentage' | 'flat';
  value: number;
  minCartValue: number | null;
  usageLimit: number | null;
  validFrom: string | null; // ISO timestamp
  validTo: string | null;
}

export interface PaymentQr {
  qr_image_url: string | null;
  updated_at: string | null;
}

interface One<T> {
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminStoreService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/api`;

  listCoupons(): Observable<{ data: Coupon[] }> {
    return this.http.get<{ data: Coupon[] }>(`${this.api}/coupons`);
  }

  createCoupon(input: CouponInput): Observable<One<Coupon>> {
    return this.http.post<One<Coupon>>(`${this.api}/coupons`, input);
  }

  updateCoupon(id: string, input: CouponInput): Observable<One<Coupon>> {
    return this.http.put<One<Coupon>>(`${this.api}/coupons/${encodeURIComponent(id)}`, input);
  }

  setCouponActive(id: string, active: boolean): Observable<One<Coupon>> {
    return this.http.patch<One<Coupon>>(`${this.api}/coupons/${encodeURIComponent(id)}/active`, { active });
  }

  getQr(): Observable<One<PaymentQr>> {
    return this.http.get<One<PaymentQr>>(`${this.api}/payment-config/qr`);
  }

  uploadQr(file: File): Observable<One<PaymentQr>> {
    const body = new FormData();
    body.append('image', file);
    return this.http.post<One<PaymentQr>>(`${this.api}/payment-config/qr`, body);
  }
}
