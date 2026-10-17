// src/app/core/admin.guard.ts
//
// Keeps customers out of /admin. This is about not showing a screen full of
// 403s — the backend's requireRole('admin') is what actually protects the data,
// so a customer who edits localStorage to claim "admin" still cannot change
// anything.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) return router.parseUrl('/login');
  if (auth.user()?.role !== 'admin') return router.parseUrl('/home');
  return true;
};
