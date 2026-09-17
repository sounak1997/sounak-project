// src/app/core/product.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Product {
  id: string;
  name: string;
  price: string;
  category: string;
  stock: number;
  in_stock: boolean;
  active: boolean;
  image_urls: string[];
}

interface ProductListResponse {
  success: boolean;
  count: number;
  data: Product[];
  pagination: { page: number; limit: number; totalCount: number; totalPages: number };
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  list(params: { category?: string; search?: string } = {}): Observable<ProductListResponse> {
    let query = '';
    const parts: string[] = [];
    if (params.category) parts.push(`category=${encodeURIComponent(params.category)}`);
    if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
    if (parts.length) query = `?${parts.join('&')}`;

    return this.http.get<ProductListResponse>(`${this.apiUrl}/api/products/list${query}`);
  }

  /** image_urls come back as backend-relative paths (e.g. "/uploads/products/x.webp"). */
  imageUrl(product: Product): string | null {
    if (!product.image_urls?.length) return null;
    return `${this.apiUrl}${product.image_urls[0]}`;
  }
}
