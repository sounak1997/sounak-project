import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap } from 'rxjs';
import { HttpClient } from '@angular/common/http';

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
}

interface ProductSignalState {
  products: Product[];
  selectedProduct: Product | null;
  searchQuery: string;
  loading: boolean;
  error: string | null;
}

const initialState: ProductSignalState = {
  products: [],
  selectedProduct: null,
  searchQuery: '',
  loading: false,
  error: null,
};

export const ProductSignalStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  // --- Computed signals (derived state — recalculates only when dependencies change) ---
  withComputed((store) => ({
    filteredProducts: computed(() => {
      const query = store.searchQuery().toLowerCase().trim();
      if (!query) return store.products();
      return store.products().filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query)
      );
    }),

    totalCount: computed(() => store.products().length),

    filteredCount: computed(() => {
      const query = store.searchQuery().toLowerCase().trim();
      if (!query) return store.products().length;
      return store.products().filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query)
      ).length;
    }),

    categories: computed(() => {
      const all = store.products().map((p) => p.category);
      return [...new Set(all)].sort();
    }),

    hasProducts: computed(() => store.products().length > 0),
    isFiltered: computed(() => store.searchQuery().trim().length > 0),
  })),

  // --- Methods ---
  withMethods((store, http = inject(HttpClient)) => ({
    // RxMethod: handles async load + loading/error state automatically
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() =>
          http.get<any>('/api/products/list').pipe(
            tapResponse({
              next: (res: any) =>
                patchState(store, {
                  products: Array.isArray(res) ? res : (res.data ?? res.products ?? []),
                  loading: false,
                }),
              error: (err: Error) =>
                patchState(store, {
                  error: err.message || 'Failed to load products',
                  loading: false,
                }),
            })
          )
        )
      )
    ),

    setSearchQuery(query: string) {
      patchState(store, { searchQuery: query });
    },

    selectProduct(product: Product | null) {
      patchState(store, { selectedProduct: product });
    },

    clearError() {
      patchState(store, { error: null });
    },
  }))
);
