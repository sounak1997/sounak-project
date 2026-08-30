// src/app/interceptors/auth-error.interceptor.ts
//
// Catches 401 responses app-wide and ends the dead session cleanly.
//
// Without this, an expired JWT (they last 1h) surfaced as whatever generic
// error text each component happened to show — the failure looked like a bug
// in that feature rather than "you need to log in again".
import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthErrorInterceptor implements HttpInterceptor {
  constructor(
    private authService: AuthService,
    private snackBar: MatSnackBar,
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        // A 401 from the login/register endpoints means "wrong credentials",
        // not "session expired" — leave those for the form to report.
        const isAuthAttempt =
          request.url.includes('/api/auth/login') ||
          request.url.includes('/api/auth/register');

        if (error.status === 401 && !isAuthAttempt) {
          this.snackBar.open('Your session expired. Please log in again.', 'Dismiss', {
            duration: 5000,
          });
          // Clears storage and redirects to /login.
          this.authService.logout();
        }

        return throwError(() => error);
      }),
    );
  }
}
