import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
  input,
  output,
  linkedSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { ProductSignalStore, Product } from '../../store/product-signal/product-signal.store';

@Component({
  selector: 'app-signal-products',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatBadgeModule,
  ],
  templateUrl: './signal-products.component.html',
  styleUrl: './signal-products.component.scss',
})
export class SignalProductsComponent implements OnInit {
  readonly store = inject(ProductSignalStore);

  // --- Signal Input (Angular 17+) — replaces @Input() ---
  readonly title = input<string>('Signal-Powered Product List');
  readonly showCategories = input<boolean>(true);

  // --- Signal Output (Angular 17+) — replaces @Output() EventEmitter ---
  readonly productSelected = output<Product>();

  // --- Local component signals ---
  readonly viewMode = signal<'grid' | 'list'>('grid');
  readonly selectedCategory = signal<string>('All');

  // --- linkedSignal: derived from store's searchQuery but overridable locally ---
  readonly localSearch = linkedSignal(() => this.store.searchQuery());

  // --- Computed signals (pure derivations — no subscriptions needed) ---
  readonly displayedProducts = computed(() => {
    const cat = this.selectedCategory();
    const filtered = this.store.filteredProducts();
    if (cat === 'All') return filtered;
    return filtered.filter((p) => p.category === cat);
  });

  readonly categoryList = computed(() => ['All', ...this.store.categories()]);

  readonly statsText = computed(() => {
    const total = this.store.totalCount();
    const shown = this.displayedProducts().length;
    return total === shown
      ? `${total} products`
      : `${shown} of ${total} products`;
  });

  readonly isGridMode = computed(() => this.viewMode() === 'grid');

  constructor() {
    // --- effect(): runs whenever its signal dependencies change ---
    effect(() => {
      const count = this.displayedProducts().length;
      const query = this.store.searchQuery();
      if (query) {
        console.log(`[Signal Effect] Search "${query}" → ${count} results`);
      }
    });

    // Track selected category changes
    effect(() => {
      console.log('[Signal Effect] Category changed to:', this.selectedCategory());
    });
  }

  ngOnInit(): void {
    this.store.loadProducts();
  }

  onSearchChange(query: string): void {
    this.localSearch.set(query);
    this.store.setSearchQuery(query);
  }

  onCategorySelect(category: string): void {
    this.selectedCategory.set(category);
  }

  onProductClick(product: Product): void {
    this.store.selectProduct(product);
    this.productSelected.emit(product);
  }

  toggleViewMode(): void {
    this.viewMode.update((current) => (current === 'grid' ? 'list' : 'grid'));
  }

  clearFilters(): void {
    this.store.setSearchQuery('');
    this.selectedCategory.set('All');
  }

  trackByProductId(_: number, product: Product): string {
    return product.id;
  }
}
