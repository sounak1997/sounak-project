import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  /**
   * The door screen. PUBLIC and unguarded on purpose — it is the URL printed on
   * every gym's poster, and a member scanning it is not signed in and never will
   * be. Putting a guard here would break the entire product.
   */
  {
    path: 'checkin',
    loadComponent: () => import('./checkin/checkin.page').then((m) => m.CheckinPage),
    title: 'Check in',
  },

  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
    title: 'Gym login',
  },

  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
    title: 'Gym console',
  },

  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];
