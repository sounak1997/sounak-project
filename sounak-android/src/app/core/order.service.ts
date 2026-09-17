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

export interface Order {
  id: string;
  status: string;
  payment_method: 'cod' | 'qr';
  payment_status: string;
  subtotal: string;
  total: string;
  delivery_address: DeliveryAddress;
  items: OrderItem[];
}

interface OrderResponse {
  success: boolean;
  data: Order;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  placeOrder(deliveryAddress: DeliveryAddress, paymentMethod: 'cod' | 'qr' = 'cod'): Observable<OrderResponse> {
    return this.http.post<OrderResponse>(`${this.apiUrl}/api/orders`, { deliveryAddress, paymentMethod });
  }
}
