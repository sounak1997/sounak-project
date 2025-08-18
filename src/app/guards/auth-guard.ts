// my-angular-frontend/src/app/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar); // Inject MatSnackBar

  if (authService.isLoggedIn()) {
    return true; // User is logged in, allow access
  } else {
    // User is not logged in, redirect to login page
    snackBar.open('You need to log in to access this page.', 'Dismiss', { duration: 3000 });
    router.navigate(['/login']);
    return false; // Prevent access
  }
};