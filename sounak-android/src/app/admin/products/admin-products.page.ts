import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
  IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
  IonInfiniteScroll, IonInfiniteScrollContent, InfiniteScrollCustomEvent,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, searchOutline, imageOutline } from 'ionicons/icons';
import { Category, Product } from '../../core/product.service';
import { AdminProductsService } from '../data/admin-products.service';
import { AdminImagesService } from '../data/admin-images.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';
import { plural } from '../shared/plural';

const PAGE_SIZE = 50;

@Component({
  selector: 'app-admin-products',
  templateUrl: './admin-products.page.html',
  styleUrls: ['../shared/admin.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
    IonSpinner, IonButton, IonToggle, IonFab, IonFabButton,
    IonInfiniteScroll, IonInfiniteScrollContent,
  ],
})
export class AdminProductsPage {
  private api = inject(AdminProductsService);
  private feedback = inject(AdminFeedbackService);
  private router = inject(Router);
  images = inject(AdminImagesService);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly category = signal<string | null>(null);
  readonly totalCount = signal(0);
  readonly hasMore = signal(false);
  private page = 1;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly resultLabel = computed(() => {
    const total = this.totalCount();
    return `${plural(total, 'item')}${this.category() ? ` in ${this.category()}` : ''}`;
  });

  constructor() {
    addIcons({ addOutline, searchOutline, imageOutline });
  }

  /** Every time the page shows, including coming back from the edit form. */
  ionViewWillEnter(): void {
    this.load();
    this.api.categories().subscribe({ next: (res) => this.categories.set(res.data), error: () => {} });
  }

  load(): void {
    // Keep the current rows on screen while refreshing; only the first load
    // shows the spinner.
    if (this.products().length === 0) this.loading.set(true);
    this.error.set(null);
    this.page = 1;
    this.api
      .list({ search: this.search() || undefined, category: this.category() || undefined, page: 1, limit: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.products.set(res.data);
          this.totalCount.set(res.pagination.totalCount);
          this.hasMore.set(res.pagination.page < res.pagination.totalPages);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(errorMessage(err, 'Could not load the items.'));
          this.loading.set(false);
        },
      });
  }

  loadMore(event: InfiniteScrollCustomEvent): void {
    const next = this.page + 1;
    this.api
      .list({ search: this.search() || undefined, category: this.category() || undefined, page: next, limit: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.page = next;
          this.products.update((rows) => [...rows, ...res.data]);
          this.hasMore.set(res.pagination.page < res.pagination.totalPages);
          event.target.complete();
        },
        error: () => {
          this.hasMore.set(false);
          event.target.complete();
        },
      });
  }

  onSearch(term: string): void {
    this.search.set(term.trim());
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.products.set([]);
      this.load();
    }, 350);
  }

  selectCategory(category: string | null): void {
    this.category.set(category);
    this.products.set([]);
    this.load();
  }

  open(product: Product): void {
    this.router.navigate(['/admin/products', product.id]);
  }

  add(): void {
    this.router.navigateByUrl('/admin/products/new');
  }

  thumb(product: Product): string | null {
    return this.images.src(product.image_urls?.[0]);
  }

  /** Flip a flag on screen at once, put it back if the server refuses. */
  private toggle(product: Product, key: 'in_stock' | 'active', value: boolean): void {
    const patch = (v: boolean) =>
      this.products.update((rows) => rows.map((p) => (p.id === product.id ? { ...p, [key]: v } : p)));
    patch(value);

    const request = key === 'active' ? this.api.setActive(product.id, value) : this.api.setInStock(product.id, value);
    request.subscribe({
      error: (err) => {
        patch(!value);
        this.feedback.failed(err, 'Could not update that item.');
      },
    });
  }

  setInStock(product: Product, value: boolean): void {
    this.toggle(product, 'in_stock', value);
  }

  setVisible(product: Product, value: boolean): void {
    this.toggle(product, 'active', value);
  }
}
