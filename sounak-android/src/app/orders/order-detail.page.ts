// src/app/orders/order-detail.page.ts — one order, its items and status (FR-3.9)
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonChip,
} from '@ionic/angular';
import { OrderService, Order, OrderStatus } from '../core/order.service';
import { HelperContactComponent } from '../shared/helper-contact/helper-contact.component';

// The happy-path pipeline from FR-2.11; 'cancelled' is terminal and shown
// on its own rather than as a step.
const PIPELINE: OrderStatus[] = ['placed', 'packed', 'out_for_delivery', 'delivered'];

@Component({
  selector: 'app-order-detail',
  templateUrl: './order-detail.page.html',
  styleUrls: ['./order-detail.page.scss'],
  imports: [
    DatePipe,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonChip,
    HelperContactComponent,
  ],
})
export class OrderDetailPage implements OnInit {
  private orderService = inject(OrderService);
  private route = inject(ActivatedRoute);

  order = signal<Order | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  readonly steps = computed(() => {
    const order = this.order();
    if (!order) return [];
    const currentIndex = PIPELINE.indexOf(order.status);
    return PIPELINE.map((status, index) => ({
      status,
      label: this.orderService.statusLabel(status),
      done: currentIndex >= 0 && index <= currentIndex,
    }));
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('No order specified.');
      this.loading.set(false);
      return;
    }
    this.orderService.getById(id).subscribe({
      next: (res) => {
        this.order.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load this order.');
        this.loading.set(false);
      },
    });
  }

  statusLabel(status: OrderStatus): string {
    return this.orderService.statusLabel(status);
  }

  paymentLabel(): string {
    const order = this.order();
    return order ? this.orderService.paymentStatusLabel(order.payment_status) : '';
  }

  lineTotal(price: string, quantity: number): string {
    return (Number(price) * quantity).toFixed(2);
  }
}
