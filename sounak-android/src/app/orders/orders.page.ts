// src/app/orders/orders.page.ts — order history (FR-3.9)
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSpinner, IonChip, IonButton,
} from '@ionic/angular';
import { OrderService, Order, OrderStatus, PaymentStatus } from '../core/order.service';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  imports: [
    DatePipe,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
    IonSpinner, IonChip, IonButton,
  ],
})
export class OrdersPage implements OnInit {
  private orderService = inject(OrderService);
  private router = inject(Router);

  orders = signal<Order[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orderService.list().subscribe({
      next: (res) => {
        this.orders.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load your orders.');
        this.loading.set(false);
      },
    });
  }

  statusLabel(status: OrderStatus): string {
    return this.orderService.statusLabel(status);
  }

  paymentLabel(status: PaymentStatus): string {
    return this.orderService.paymentStatusLabel(status);
  }

  statusColor(status: OrderStatus): string {
    if (status === 'delivered') return 'success';
    if (status === 'cancelled') return 'danger';
    if (status === 'out_for_delivery') return 'tertiary';
    return 'primary';
  }

  openOrder(order: Order): void {
    this.router.navigateByUrl(`/orders/${order.id}`);
  }

  goToGrocery(): void {
    this.router.navigateByUrl('/grocery');
  }
}
