// src/app/product/product.page.ts — product detail (FR-3.2)
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonChip, IonButton, IonIcon, IonBadge, ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cartOutline } from 'ionicons/icons';
import { ProductService, Product } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

@Component({
  selector: 'app-product',
  templateUrl: './product.page.html',
  styleUrls: ['./product.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonChip, IonButton, IonIcon, IonBadge,
    HelperContactComponent,
  ],
})
export class ProductPage implements OnInit {
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private toastController = inject(ToastController);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  product = signal<Product | null>(null);
  images = signal<string[]>([]);
  activeImage = signal<string | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  quantity = signal(1);
  adding = signal(false);

  cartCount = this.cartService.itemCount;

  constructor() {
    addIcons({ cartOutline });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('No product specified.');
      this.loading.set(false);
      return;
    }
    this.load(id);
  }

  private load(id: string): void {
    this.productService.getById(id).subscribe({
      next: (res) => {
        this.product.set(res.data);
        const urls = this.productService.imageUrls(res.data);
        this.images.set(urls);
        this.activeImage.set(urls[0] ?? null);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load this product.');
        this.loading.set(false);
      },
    });
  }

  selectImage(url: string): void {
    this.activeImage.set(url);
  }

  increment(): void {
    const product = this.product();
    if (!product) return;
    this.quantity.update((q) => Math.min(product.stock, q + 1));
  }

  decrement(): void {
    this.quantity.update((q) => Math.max(1, q - 1));
  }

  goToCart(): void {
    this.router.navigateByUrl('/cart');
  }

  addToCart(): void {
    const product = this.product();
    if (!product) return;
    const quantity = this.quantity();
    this.adding.set(true);

    this.cartService.addItem(product.id, quantity).subscribe({
      next: async () => {
        this.adding.set(false);
        const toast = await this.toastController.create({
          message: `Added ${quantity} × ${product.name} to cart`,
          duration: 1500,
          color: 'success',
          position: 'bottom',
        });
        await toast.present();
      },
      error: async (err) => {
        this.adding.set(false);
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
