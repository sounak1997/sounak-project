import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
    canActivate: [authGuard],
  },
  {
    path: 'grocery',
    loadComponent: () => import('./grocery/grocery.page').then((m) => m.GroceryPage),
    canActivate: [authGuard],
  },
  {
    path: 'product/:id',
    loadComponent: () => import('./product/product.page').then((m) => m.ProductPage),
    canActivate: [authGuard],
  },
  {
    path: 'cart',
    loadComponent: () => import('./cart/cart.page').then((m) => m.CartPage),
    canActivate: [authGuard],
  },
  {
    path: 'orders',
    loadComponent: () => import('./orders/orders.page').then((m) => m.OrdersPage),
    canActivate: [authGuard],
  },
  {
    path: 'orders/:id',
    loadComponent: () => import('./orders/order-detail.page').then((m) => m.OrderDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'booking',
    loadComponent: () => import('./booking/booking.page').then((m) => m.BookingPage),
    canActivate: [authGuard],
  },
  {
    path: 'helper',
    loadComponent: () => import('./helper/helper.page').then((m) => m.HelperPage),
    canActivate: [authGuard],
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
];
