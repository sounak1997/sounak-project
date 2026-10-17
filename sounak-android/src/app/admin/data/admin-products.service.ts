// src/app/admin/data/admin-products.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Category, Product, ProductListResponse } from '../../core/product.service';

/** What the product form sends. Numbers may be strings; the API parses them. */
export interface ProductInput {
  name: string;
  description: string;
  category: string;
  price: string | number;
  mrp: string | number;
  stock: string | number;
  inStock: boolean;
  active: boolean;
  imageUrls: string[];
}

interface One<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminProductsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/products`;

  /** Includes hidden products — the admin needs to find them to bring them back. */
  list(params: { search?: string; category?: string; page?: number; limit?: number }): Observable<ProductListResponse> {
    const query = new URLSearchParams({ includeInactive: 'true' });
    if (params.search) query.set('search', params.search);
    if (params.category) query.set('category', params.category);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    return this.http.get<ProductListResponse>(`${this.base}/list?${query}`);
  }

  categories(): Observable<{ data: Category[] }> {
    return this.http.get<{ data: Category[] }>(`${this.base}/categories`);
  }

  get(id: string): Observable<One<Product>> {
    return this.http.get<One<Product>>(`${this.base}/${encodeURIComponent(id)}`);
  }

  create(input: ProductInput): Observable<One<Product>> {
    return this.http.post<One<Product>>(this.base, input);
  }

  update(id: string, input: Partial<ProductInput>): Observable<One<Product>> {
    return this.http.put<One<Product>>(`${this.base}/${encodeURIComponent(id)}`, input);
  }

  setActive(id: string, active: boolean): Observable<One<Product>> {
    return this.http.patch<One<Product>>(`${this.base}/${encodeURIComponent(id)}/active`, { active });
  }

  setInStock(id: string, inStock: boolean): Observable<One<Product>> {
    return this.http.patch<One<Product>>(`${this.base}/${encodeURIComponent(id)}/stock`, { inStock });
  }
}
