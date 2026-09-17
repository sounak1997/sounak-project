// src/app/cart/cart.page.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonButton, IonIcon, IonInput, IonTextarea, IonList, IonItem, IonLabel,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { logoWhatsapp } from 'ionicons/icons';
import { CartService, Cart, CartItem } from '../core/cart.service';
import { OrderService } from '../core/order.service';
import { AuthService } from '../core/auth.service';
import { whatsappHrefWithMessage } from '../core/assistant-contact';

@Component({
  selector: 'app-cart',
  templateUrl: './cart.page.html',
  styleUrls: ['./cart.page.scss'],
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonButton, IonIcon, IonInput, IonTextarea, IonList, IonItem, IonLabel,
  ],
})
export class CartPage implements OnInit {
  private cartService = inject(CartService);
  private orderService = inject(OrderService);
  private auth = inject(AuthService);
  private toastController = inject(ToastController);
  private router = inject(Router);

  cart = signal<Cart | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  busyIds = signal<Record<string, boolean>>({});

  // Minimal inline checkout — deliveryAddress is a free-form JSON object
  // backend-side, so this plain {name, phone, address} shape is enough.
  name = this.auth.user()?.name ?? '';
  phone = '';
  address = '';
  placingOrder = signal(false);
  placedOrder = signal<{ id: string; total: string } | null>(null);
  // Kept so the success screen can offer the WhatsApp handoff as a real link —
  // the automatic window.open runs after an async response, so browsers can
  // treat it as a non-user-gesture popup and block it.
  whatsappOrderHref = signal<string | null>(null);

  constructor() {
    addIcons({ logoWhatsapp });
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.cartService.getCart().subscribe({
      next: (res) => {
        this.cart.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load your cart.');
        this.loading.set(false);
      },
    });
  }

  imageFor(item: CartItem): string | null {
    return this.cartService.imageUrl(item);
  }

  isBusy(productId: string): boolean {
    return this.busyIds()[productId] ?? false;
  }

  private setBusy(productId: string, value: boolean): void {
    this.busyIds.update((b) => ({ ...b, [productId]: value }));
  }

  incrementQty(item: CartItem): void {
    const next = Math.min(item.stock, item.quantity + 1);
    if (next !== item.quantity) this.updateQuantity(item, next);
  }

  decrementQty(item: CartItem): void {
    const next = item.quantity - 1;
    if (next <= 0) this.removeItem(item);
    else this.updateQuantity(item, next);
  }

  private updateQuantity(item: CartItem, quantity: number): void {
    this.setBusy(item.product_id, true);
    this.cartService.updateQuantity(item.product_id, quantity).subscribe({
      next: (res) => {
        this.cart.set(res.data);
        this.setBusy(item.product_id, false);
      },
      error: async (err) => {
        this.setBusy(item.product_id, false);
        await this.showToast(err?.error?.message || 'Could not update quantity.', 'danger');
      },
    });
  }

  removeItem(item: CartItem): void {
    this.setBusy(item.product_id, true);
    this.cartService.removeItem(item.product_id).subscribe({
      next: async (res) => {
        this.cart.set(res.data);
        this.setBusy(item.product_id, false);
        await this.showToast(`Removed ${item.name} from cart`, 'medium');
      },
      error: async (err) => {
        this.setBusy(item.product_id, false);
        await this.showToast(err?.error?.message || 'Could not remove item.', 'danger');
      },
    });
  }

  placeOrder(): void {
    const cart = this.cart();
    if (!cart || cart.items.length === 0) return;
    if (!this.name.trim() || !this.phone.trim() || !this.address.trim()) {
      this.showToast('Please fill in your name, phone, and address.', 'danger');
      return;
    }

    this.placingOrder.set(true);
    const deliveryAddress = { name: this.name.trim(), phone: this.phone.trim(), address: this.address.trim() };

    this.orderService.placeOrder(deliveryAddress, 'cod').subscribe({
      next: (res) => {
        const order = res.data;
        this.placingOrder.set(false);
        this.placedOrder.set({ id: order.id, total: order.total });
        this.sendOrderToWhatsapp(order, deliveryAddress);
        this.load(); // cart is now empty server-side
      },
      error: async (err) => {
        this.placingOrder.set(false);
        await this.showToast(err?.error?.message || 'Could not place order.', 'danger');
      },
    });
  }

  private sendOrderToWhatsapp(
    order: { id: string; total: string; subtotal: string; items: { product_name: string; quantity: number; price_at_purchase: string }[] },
    deliveryAddress: { name: string; phone: string; address: string }
  ): void {
    const lines = [
      `New order ${order.id}`,
      `Customer: ${deliveryAddress.name} (${deliveryAddress.phone})`,
      `Address: ${deliveryAddress.address}`,
      '',
      'Items:',
      ...order.items.map(
        (item) => `- ${item.product_name} x${item.quantity} — ₹${(Number(item.price_at_purchase) * item.quantity).toFixed(2)}`
      ),
      '',
      `Total: ₹${order.total}`,
      'Payment: Cash on delivery',
    ];
    const href = whatsappHrefWithMessage(lines.join('\n'));
    this.whatsappOrderHref.set(href);
    window.open(href, '_blank');
  }

  goToGrocery(): void {
    this.router.navigateByUrl('/grocery');
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2000, color, position: 'bottom' });
    await toast.present();
  }
}
