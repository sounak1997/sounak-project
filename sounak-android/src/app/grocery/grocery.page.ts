import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSearchbar, IonSpinner, IonChip, IonButton, IonIcon, ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cartOutline } from 'ionicons/icons';
import { ProductService, Product } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

@Component({
  selector: 'app-grocery',
  templateUrl: './grocery.page.html',
  styleUrls: ['./grocery.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSearchbar, IonSpinner, IonChip, IonButton, IonIcon,
    HelperContactComponent,
  ],
})
export class GroceryPage implements OnInit {
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private toastController = inject(ToastController);
  private router = inject(Router);

  constructor() {
    addIcons({ cartOutline });
  }

  products = signal<Product[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  searchTerm = '';

  // Quantity picked per product (defaults to 1) and in-flight add state,
  // keyed by product id — lets each card have its own independent stepper.
  private quantities = signal<Record<string, number>>({});
  private addingIds = signal<Record<string, boolean>>({});

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.productService.list({ search: this.searchTerm || undefined }).subscribe({
      next: (res) => {
        this.products.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load products.');
        this.loading.set(false);
      },
    });
  }

  onSearch(term: string | null | undefined): void {
    this.searchTerm = term || '';
    this.load();
  }

  imageFor(product: Product): string | null {
    return this.productService.imageUrl(product);
  }

  goToCart(): void {
    this.router.navigateByUrl('/cart');
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
