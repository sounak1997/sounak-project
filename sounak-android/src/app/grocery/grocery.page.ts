import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSearchbar, IonSpinner, IonChip, IonButton, IonIcon, IonBadge,
  IonInfiniteScroll, IonInfiniteScrollContent, InfiniteScrollCustomEvent,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cartOutline } from 'ionicons/icons';
import { ProductService, Product, Category } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

const PAGE_SIZE = 40;

@Component({
  selector: 'app-grocery',
  templateUrl: './grocery.page.html',
  styleUrls: ['./grocery.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSearchbar, IonSpinner, IonChip, IonButton, IonIcon, IonBadge,
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
  searchTerm = '';

  // Paged browsing (NFR-5) — the catalog is far larger than one page.
  private page = signal(1);
  hasMore = signal(false);

  cartCount = this.cartService.itemCount;

  // Quantity picked per product (defaults to 1) and in-flight add state,
  // keyed by product id — lets each card have its own independent stepper.
  private quantities = signal<Record<string, number>>({});
  private addingIds = signal<Record<string, boolean>>({});

  constructor() {
    addIcons({ cartOutline });
  }

  ngOnInit(): void {
    // Home's category chips deep-link into the filtered grid, so honour the
    // param before the first load rather than fetching everything and refiltering.
    const category = this.route.snapshot.queryParamMap.get('category');
    if (category) this.activeCategory.set(category);

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
        search: this.searchTerm || undefined,
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
        search: this.searchTerm || undefined,
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

  onSearch(term: string | null | undefined): void {
    this.searchTerm = term || '';
    this.load();
  }

  selectCategory(category: string | null): void {
    this.activeCategory.set(category);
    this.load();
  }

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
