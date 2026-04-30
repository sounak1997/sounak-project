import { Routes } from '@angular/router';
import { importProvidersFrom } from '@angular/core';
import { EffectsModule } from '@ngrx/effects';

import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { DashboardComponent } from './components/dashboard/dashboard';
import { AddUserComponent } from './components/add-user/add-user';
import { authGuard } from './guards/auth-guard';
import { ProductListComponent } from './components/product-list/product-list';
import { UserEffects } from './store/user/user.effects';

export const routes: Routes = [
  // --- Existing routes ---
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'add-user', component: AddUserComponent, canActivate: [authGuard] },

  // Lazy-loaded UserList with NgRx feature
  {
    path: 'user-list',
    loadComponent: () =>
      import('./components/user-list/user-list').then((m) => m.UserListComponent),
    providers: [importProvidersFrom(EffectsModule.forFeature([UserEffects]))],
  },

  {
    path: 'products',
    component: ProductListComponent,
    canActivate: [authGuard],
  },

  // --- New Signal-based routes ---
  {
    path: 'signal-products',
    loadComponent: () =>
      import('./components/signal-products/signal-products.component').then(
        (m) => m.SignalProductsComponent
      ),
    canActivate: [authGuard],
    title: 'Signal Products — NgRx Signal Store',
  },

  {
    path: 'signal-demo',
    loadComponent: () =>
      import('./components/signal-counter/signal-counter.component').then(
        (m) => m.SignalCounterComponent
      ),
    title: 'Angular Signals Demo',
  },

  {
    path: 'notifications',
    loadComponent: () =>
      import('./components/live-notifications/live-notifications.component').then(
        (m) => m.LiveNotificationsComponent
      ),
    canActivate: [authGuard],
    title: 'Live Notifications — SSE',
  },

  {
    path: 'chat',
    loadComponent: () =>
      import('./components/chat/chat.component').then(m => m.ChatComponent),
    canActivate: [authGuard],
    title: 'Live Chat — WebSocket',
  },

  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/dashboard' },
];
