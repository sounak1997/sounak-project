// src/app/core/checkout.service.ts
//
// The two checkout-time lookups that aren't cart or order operations:
// previewing a coupon (FR-3.5) and fetching the live Scan & Pay QR (FR-3.8).
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CouponPreview {
  code: string;
  discountType: 'percentage' | 'flat';
  discountAmount: number;
  total: number;
}

interface CouponPreviewResponse {
  success: boolean;
  data: CouponPreview;
}

interface QrConfigResponse {
  success: boolean;
  data: { qr_image_url: string | null; updated_at?: string };
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  validateCoupon(code: string, cartSubtotal: number): Observable<CouponPreviewResponse> {
    return this.http.post<CouponPreviewResponse>(`${this.apiUrl}/api/coupons/validate`, { code, cartSubtotal });
  }

  getPaymentQr(): Observable<QrConfigResponse> {
    return this.http.get<QrConfigResponse>(`${this.apiUrl}/api/payment-config/qr`);
  }

  /** qr_image_url is a backend-relative path, same as product images. */
  qrImageUrl(path: string | null): string | null {
    return path ? `${this.apiUrl}${path}` : null;
  }
}
