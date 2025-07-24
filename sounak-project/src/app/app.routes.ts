// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { DashboardComponent } from './components/dashboard/dashboard';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] }, // Protected route
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' }, // Redirect to dashboard if logged in
  { path: '**', redirectTo: '/dashboard' } // Wildcard for undefined routes
];