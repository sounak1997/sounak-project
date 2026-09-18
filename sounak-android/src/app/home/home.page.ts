import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  logOutOutline,
  basketOutline,
  receiptOutline,
  medkitOutline,
  handLeftOutline,
  arrowForwardOutline,
} from 'ionicons/icons';
import { AuthService } from '../core/auth.service';
import { Category, Product, ProductService } from '../core/product.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

interface Shortcut {
  id: 'grocery' | 'orders' | 'booking' | 'helper';
  title: string;
  sub: string;
  icon: string;
  tone: string;
}

/**
 * Produce silhouettes that drift behind the page. Single-path so each one is a
 * plain <path> — no <svg><use href="#id">, which Angular's `<base href="/">`
 * has historically broken in some browsers.
 */
const GLYPH_PATHS: Record<string, string> = {
  apple:
    'M12 8c3 0 5 2.3 5 5.5S14.5 21 12 21s-5-4.3-5-7.5S9 8 12 8z M12 8c0-2.2 1.6-4 3.8-4C15.8 6.2 14.2 8 12 8z',
  carrot:
    'M12 21 8 11c2.4-1.4 5.6-1.4 8 0z M11.4 9.6C10 8.4 9.6 6.4 10.4 4.8c1.6.6 2.6 2.4 2.4 4.2z M12.6 9.6c1-1.6 2.8-2.4 4.4-2-.4 1.8-2 3-3.8 3z',
  leaf: 'M4.5 19.5C4 12 9.5 5.5 19.5 4.5c1 10-5.5 15.5-13 15z',
  bottle:
    'M10 3h4v2.8l1.8 2.6c.4.6.7 1.3.7 2V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-8.6c0-.7.2-1.4.7-2L10 5.8z',
  egg: 'M12 3c3.3 0 6 4.3 6 8.6S15.3 20 12 20s-6-3.9-6-8.4S8.7 3 12 3z',
  grapes:
    'M12 4.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z M8.6 9.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z M15.4 9.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z M12 14.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z',
  bread: 'M4 13a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z',
  basket: 'M3.2 9h17.6l-2.1 10.2a1.5 1.5 0 0 1-1.5 1.2H6.8a1.5 1.5 0 0 1-1.5-1.2z',
  tomato:
    'M12 8.4c3.4 0 6 2.6 6 5.8s-2.6 5.8-6 5.8-6-2.6-6-5.8 2.6-5.8 6-5.8z M12 8.4 9 5.6l3 .8 3-.8z',
};

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, HelperContactComponent],
})
export class HomePage {
  auth = inject(AuthService);
  private router = inject(Router);
  private productService = inject(ProductService);

  readonly picks = signal<Product[]>([]);
  readonly picksLoading = signal(true);
  readonly picksFailed = signal(false);
  readonly categories = signal<Category[]>([]);

  /** Placement, size and timing for each drifting glyph live in SCSS :nth-child. */
  readonly glyphs = [
    'apple', 'carrot', 'leaf', 'bottle', 'grapes', 'tomato', 'bread',
    'basket', 'egg', 'leaf', 'apple', 'carrot', 'grapes', 'bottle',
  ].map((name) => GLYPH_PATHS[name]);

  /** Placeholders that keep the shelf occupied during Render's cold start. */
  readonly skeletons = Array.from({ length: 6 });

  readonly shortcuts: Shortcut[] = [
    { id: 'grocery', title: 'Grocery', sub: 'Order daily essentials', icon: 'basket-outline', tone: 'grocery' },
    { id: 'orders', title: 'My Orders', sub: 'Track and review past orders', icon: 'receipt-outline', tone: 'orders' },
    { id: 'booking', title: 'Doctors & Tests', sub: 'Book a doctor or a test', icon: 'medkit-outline', tone: 'booking' },
    { id: 'helper', title: 'Helper', sub: 'Call someone to help', icon: 'hand-left-outline', tone: 'helper' },
  ];

  readonly firstName = computed(
    () => (this.auth.user()?.name ?? '').trim().split(/\s+/)[0] || 'there'
  );

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  });

  /** The shelf scrolls by translating exactly half its width, so the list is doubled. */
  readonly shelf = computed(() => {
    const picks = this.picks();
    return picks.length ? [...picks, ...picks] : [];
  });

  constructor() {
    addIcons({
      logOutOutline,
      basketOutline,
      receiptOutline,
      medkitOutline,
      handLeftOutline,
      arrowForwardOutline,
    });
    this.loadPicks();
    this.loadCategories();
  }

  private loadPicks(): void {
    // Only in-stock items with a picture — the shelf is decorative as much as
    // functional, and a row of "no image" boxes defeats that.
    this.productService.list({ limit: 24 }).subscribe({
      next: (res) => {
        const usable = (res.data ?? []).filter((p) => p.in_stock && this.imageFor(p));
        this.picks.set(usable.slice(0, 12));
        this.picksFailed.set(usable.length === 0);
        this.picksLoading.set(false);
      },
      error: () => {
        this.picksFailed.set(true);
        this.picksLoading.set(false);
      },
    });
  }

  private loadCategories(): void {
    this.productService.categories().subscribe({
      next: (res) => this.categories.set((res.data ?? []).slice(0, 10)),
      error: () => {}, // decorative shortcut; the shelf and cards still stand
    });
  }

  openCategory(category: Category): void {
    this.router.navigate(['/grocery'], { queryParams: { category: category.category } });
  }

  imageFor(product: Product): string | null {
    return this.productService.imageUrl(product);
  }

  openProduct(product: Product): void {
    this.router.navigateByUrl(`/product/${product.id}`);
  }

  goTo(section: Shortcut['id'] | 'grocery'): void {
    this.router.navigateByUrl(`/${section}`);
  }

  logout(): void {
    this.auth.logout();
  }
}
