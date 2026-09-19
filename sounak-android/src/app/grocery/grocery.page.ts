import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonButton, IonIcon, IonBadge,
  IonInfiniteScroll, IonInfiniteScrollContent, InfiniteScrollCustomEvent,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cartOutline, searchOutline, closeOutline } from 'ionicons/icons';
import { ProductService, Product, Category } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

const PAGE_SIZE = 40;

/**
 * Hue per category, so the page's wash and each card's image well take their
 * colour from what is actually being browsed. Values are HSL hues; saturation
 * and lightness are fixed in SCSS, which keeps every tint in the same family
 * however many categories the catalogue grows.
 */
const CATEGORY_HUES: Record<string, number> = {
  Fruits: 350,
  Vegetables: 120,
  Dairy: 205,
  Bakery: 32,
  'Meat & Fish': 355,
  Beverages: 190,
  Snacks: 25,
  Spices: 38,
  Frozen: 198,
  'Baby Care': 330,
  'Personal Care': 275,
  Household: 215,
  Staples: 45,
  Breakfast: 40,
  'Sauces & Spreads': 10,
  'Bags & Luggage': 20,
  Electronics: 250,
};

/** The brand amber, used for "All" and anything uncategorised. */
const DEFAULT_HUE = 38;

@Component({
  selector: 'app-grocery',
  templateUrl: './grocery.page.html',
  styleUrls: ['./grocery.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonButton, IonIcon, IonBadge,
    IonInfiniteScroll, IonInfiniteScrollContent,
    HelperContactComponent,
  ],
})
export class GroceryPage implements OnInit {
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private toastController = inject(ToastController);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  products = signal<Product[]>([]);
  categories = signal<Category[]>([]);
  activeCategory = signal<string | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  readonly searchTerm = signal('');

  // Paged browsing (NFR-5) — the catalog is far larger than one page.
  private page = signal(1);
  hasMore = signal(false);

  cartCount = this.cartService.itemCount;

  // Quantity picked per product (defaults to 1) and in-flight add state,
  // keyed by product id — lets each card have its own independent stepper.
  private quantities = signal<Record<string, number>>({});
  private addingIds = signal<Record<string, boolean>>({});

  constructor() {
    addIcons({ cartOutline, searchOutline, closeOutline });
  }

  ngOnInit(): void {
    // Home's category chips deep-link into the filtered grid, so honour the
    // param before the first load rather than fetching everything and refiltering.
    const params = this.route.snapshot.queryParamMap;
    const category = params.get('category');
    if (category) this.activeCategory.set(category);

    const search = params.get('search');
    if (search) this.searchTerm.set(search);

    this.load();
    this.loadCategories();
    // Seeds the header badge; every later cart call keeps it current.
    this.cartService.getCart().subscribe({ error: () => {} });
  }

  private loadCategories(): void {
    this.productService.categories().subscribe({
      next: (res) => this.categories.set(res.data),
      error: () => {}, // filter chips are an enhancement; the grid still works
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.page.set(1);
    this.productService
      .list({
        search: this.searchTerm() || undefined,
        category: this.activeCategory() || undefined,
        page: 1,
        limit: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.products.set(res.data);
          this.hasMore.set(res.pagination.page < res.pagination.totalPages);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Could not load products.');
          this.loading.set(false);
        },
      });
  }

  loadMore(event: InfiniteScrollCustomEvent): void {
    const nextPage = this.page() + 1;
    this.productService
      .list({
        search: this.searchTerm() || undefined,
        category: this.activeCategory() || undefined,
        page: nextPage,
        limit: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.page.set(nextPage);
          this.products.update((current) => [...current, ...res.data]);
          this.hasMore.set(res.pagination.page < res.pagination.totalPages);
          event.target.complete();
        },
        error: () => {
          this.hasMore.set(false);
          event.target.complete();
        },
      });
  }

  /** Placeholders that hold the grid's shape while a filter change loads. */
  readonly skeletons = Array.from({ length: 8 });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Typing reloads on a trailing delay; the native input has no debounce of
      its own now that ion-searchbar is gone. */
  onSearchDebounced(term: string): void {
    this.searchTerm.set(term);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 400);
  }

  onSearch(term: string | null | undefined): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTerm.set(term || '');
    this.load();
  }

  clearSearch(input: HTMLInputElement): void {
    input.value = '';
    this.onSearch('');
  }

  resetFilters(input: HTMLInputElement): void {
    input.value = '';
    this.activeCategory.set(null);
    this.onSearch('');
  }

  selectCategory(category: string | null): void {
    this.activeCategory.set(category);
    this.load();
  }

  /**
   * Unknown categories fall back to a hash of the name rather than the default,
   * so a category added to the catalogue later still gets its own stable colour
   * without anyone editing this map.
   */
  hueFor(category: string | null | undefined): number {
    if (!category) return DEFAULT_HUE;
    const known = CATEGORY_HUES[category];
    if (known !== undefined) return known;

    let hash = 0;
    for (let i = 0; i < category.length; i += 1) {
      hash = (hash * 31 + category.charCodeAt(i)) % 360;
    }
    return hash;
  }

  readonly activeHue = computed(() => this.hueFor(this.activeCategory()));

  /** Context line under the filter bar — what the grid is currently showing. */
  readonly resultLabel = computed(() => {
    const count = this.products().length;
    const shown = this.hasMore() ? `${count}+` : `${count}`;
    const term = this.searchTerm();
    if (term) return `${shown} ${count === 1 ? 'result' : 'results'} for "${term}"`;
    const category = this.activeCategory();
    return category ? `${shown} in ${category}` : `${shown} ${count === 1 ? 'item' : 'items'}`;
  });

  imageFor(product: Product): string | null {
    return this.productService.imageUrl(product);
  }

  goToCart(): void {
    this.router.navigateByUrl('/cart');
  }

  openProduct(product: Product): void {
    this.router.navigateByUrl(`/product/${product.id}`);
  }

  qtyFor(productId: string): number {
    return this.quantities()[productId] ?? 1;
  }

  isAdding(productId: string): boolean {
    return this.addingIds()[productId] ?? false;
  }

  incrementQty(product: Product): void {
    const next = Math.min(product.stock, this.qtyFor(product.id) + 1);
    this.quantities.update((q) => ({ ...q, [product.id]: next }));
  }

  decrementQty(product: Product): void {
    const next = Math.max(1, this.qtyFor(product.id) - 1);
    this.quantities.update((q) => ({ ...q, [product.id]: next }));
  }

  async addToCart(product: Product): Promise<void> {
    const quantity = this.qtyFor(product.id);
    this.addingIds.update((a) => ({ ...a, [product.id]: true }));

    this.cartService.addItem(product.id, quantity).subscribe({
      next: async () => {
        this.addingIds.update((a) => ({ ...a, [product.id]: false }));
        const toast = await this.toastController.create({
          message: `Added ${quantity} × ${product.name} to cart`,
          duration: 1500,
          color: 'success',
          position: 'bottom',
        });
        await toast.present();
      },
      error: async (err) => {
        this.addingIds.update((a) => ({ ...a, [product.id]: false }));
        const toast = await this.toastController.create({
          message: err?.error?.message || 'Could not add to cart.',
          duration: 2000,
          color: 'danger',
          position: 'bottom',
        });
        await toast.present();
      },
    });
  }
}
