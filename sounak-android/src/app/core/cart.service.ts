// src/app/core/cart.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CartItem {
  product_id: string;
  quantity: number;
  name: string;
  price: string;
  category: string;
  active: boolean;
  in_stock: boolean;
  stock: number;
  image_urls: string[];
  line_total: string;
}

export interface Cart {
  cartId: string;
  items: CartItem[];
  subtotal: number;
}

interface CartResponse {
  success: boolean;
  data: Cart;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  /** Distinct lines in the cart, for the header badge. Every call that
   *  returns a cart refreshes it, so the badge stays right without each
   *  page having to track it. */
  readonly itemCount = signal(0);

  private track<T extends CartResponse>(source: Observable<T>): Observable<T> {
    return source.pipe(tap((res) => this.itemCount.set(res.data?.items?.length ?? 0)));
  }

  getCart(): Observable<CartResponse> {
    return this.track(this.http.get<CartResponse>(`${this.apiUrl}/api/cart`));
  }

  addItem(productId: string, quantity: number): Observable<CartResponse> {
    return this.track(this.http.post<CartResponse>(`${this.apiUrl}/api/cart/items`, { productId, quantity }));
  }

  updateQuantity(productId: string, quantity: number): Observable<CartResponse> {
    return this.track(this.http.put<CartResponse>(`${this.apiUrl}/api/cart/items/${productId}`, { quantity }));
  }

  removeItem(productId: string): Observable<CartResponse> {
    return this.track(this.http.delete<CartResponse>(`${this.apiUrl}/api/cart/items/${productId}`));
  }

  /** image_urls come back as backend-relative paths (e.g. "/uploads/products/x.webp"). */
  imageUrl(item: CartItem): string | null {
    if (!item.image_urls?.length) return null;
    return `${this.apiUrl}${item.image_urls[0]}`;
  }
}
