import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Attaches the owner's token, and ends a dead session cleanly on a 401.
 *
 * The public check-in endpoints are skipped deliberately: they take no
 * Authorization header, and a 401 there would mean something else entirely.
 * Sending an owner's token to them would also be wrong — a member standing at
 * the door must never be making an authenticated owner request.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isPublicCheckin = req.url.includes('/api/gym/checkin');
  const token = auth.token;

  const request = token && !isPublicCheckin
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const isLoginAttempt = req.url.includes('/api/gym/auth/login');
      if (error.status === 401 && !isLoginAttempt && !isPublicCheckin) {
        // Without this, an expired token surfaced as whatever error text each
        // screen happened to show, so "sign in again" looked like a bug in
        // that feature. Same lesson as sounak-project's auth-error interceptor.
        auth.signOut();
      }
      return throwError(() => error);
    }),
  );
};
