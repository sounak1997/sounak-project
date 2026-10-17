// src/app/core/product.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Product {
  id: string;
  name: string;
  price: string;
  /** Printed MRP; shown struck through when it is above `price`. */
  mrp: string | null;
  category: string;
  stock: number;
  in_stock: boolean;
  active: boolean;
  image_urls: string[];
  description?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface ProductListResponse {
  success: boolean;
  count: number;
  data: Product[];
  pagination: Pagination;
}

export interface Category {
  category: string;
  count: number;
}

interface CategoryListResponse {
  success: boolean;
  count: number;
  data: Category[];
}

interface ProductDetailResponse {
  success: boolean;
  data: Product;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  list(params: { category?: string; search?: string; page?: number; limit?: number } = {}): Observable<ProductListResponse> {
    const parts: string[] = [];
    if (params.category) parts.push(`category=${encodeURIComponent(params.category)}`);
    if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
    if (params.page) parts.push(`page=${params.page}`);
    if (params.limit) parts.push(`limit=${params.limit}`);
    const query = parts.length ? `?${parts.join('&')}` : '';

    return this.http.get<ProductListResponse>(`${this.apiUrl}/api/products/list${query}`);
  }

  /** Distinct categories for the filter chips (FR-3.1). */
  categories(): Observable<CategoryListResponse> {
    return this.http.get<CategoryListResponse>(`${this.apiUrl}/api/products/categories`);
  }

  /** Full product record for the detail page (FR-3.2). */
  getById(productId: string): Observable<ProductDetailResponse> {
    return this.http.get<ProductDetailResponse>(`${this.apiUrl}/api/products/${productId}`);
  }

  /** image_urls come back as backend-relative paths (e.g. "/uploads/products/x.webp"). */
  imageUrl(product: Product): string | null {
    if (!product.image_urls?.length) return null;
    return `${this.apiUrl}${product.image_urls[0]}`;
  }

  /** The MRP to show struck through, or null when there is none or it isn't above the price. */
  mrp(product: Product): number | null {
    const mrp = Number(product.mrp);
    return product.mrp && mrp > Number(product.price) ? mrp : null;
  }

  /** Whole-number "% off" against the MRP, or null when there is no MRP to compare. */
  percentOff(product: Product): number | null {
    const mrp = this.mrp(product);
    return mrp ? Math.round(((mrp - Number(product.price)) / mrp) * 100) : null;
  }

  /** All images, for the detail page gallery. */
  imageUrls(product: Product): string[] {
    return (product.image_urls ?? []).map((path) => `${this.apiUrl}${path}`);
  }
}
