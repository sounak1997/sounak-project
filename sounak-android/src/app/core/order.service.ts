// src/app/core/order.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DeliveryAddress {
  name: string;
  phone: string;
  address: string;
}

export interface OrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  price_at_purchase: string;
}

export type OrderStatus = 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'pending_verification' | 'verified' | 'collected';

export interface Order {
  id: string;
  status: OrderStatus;
  payment_method: 'cod' | 'qr';
  payment_status: PaymentStatus;
  payment_reference: string | null;
  subtotal: string;
  discount_applied: string;
  coupon_code: string | null;
  total: string;
  delivery_address: DeliveryAddress;
  created_at: string;
  items: OrderItem[];
  history?: { event: string; changed_by: string; changed_at: string }[];
}

export interface PlaceOrderPayload {
  deliveryAddress: DeliveryAddress;
  paymentMethod: 'cod' | 'qr';
  couponCode?: string;
  paymentReference?: string;
}

interface OrderResponse {
  success: boolean;
  data: Order;
}

interface OrderListResponse {
  success: boolean;
  count: number;
  data: Order[];
  pagination: { page: number; limit: number; totalCount: number; totalPages: number };
}

/** Human-readable labels for the status values the API returns. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed: 'Placed',
  packed: 'Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Due on delivery',
  pending_verification: 'Awaiting verification',
  verified: 'Payment verified',
  collected: 'Cash collected',
};

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  placeOrder(payload: PlaceOrderPayload): Observable<OrderResponse> {
    return this.http.post<OrderResponse>(`${this.apiUrl}/api/orders`, payload);
  }

  /** The customer's own order history (FR-3.9) — the API scopes by role. */
  list(page = 1, limit = 20): Observable<OrderListResponse> {
    return this.http.get<OrderListResponse>(`${this.apiUrl}/api/orders?page=${page}&limit=${limit}`);
  }

  getById(orderId: string): Observable<OrderResponse> {
    return this.http.get<OrderResponse>(`${this.apiUrl}/api/orders/${orderId}`);
  }

  statusLabel(status: OrderStatus): string {
    return ORDER_STATUS_LABELS[status] ?? status;
  }

  paymentStatusLabel(status: PaymentStatus): string {
    return PAYMENT_STATUS_LABELS[status] ?? status;
  }
}
