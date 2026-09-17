// src/app/core/auth.interceptor.ts
//
// Two jobs: attach the access token to every API call, and — this is the
// important one — actually handle a 401 instead of letting the app do
// nothing. sounak-backend issues 1-hour access tokens; the pre-existing
// Angular app (sounak-project) has no 401 handling at all, so a stale
// session there just looks like a random broken feature instead of
// "please log in again." This interceptor tries a silent refresh once
// (POST /api/auth/refresh) before giving up and sending the user to /login,
// so that gotcha doesn't repeat here.
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const http = inject(HttpClient);
  const router = inject(Router);

  const isAuthEndpoint = req.url.includes('/api/auth/');
  const token = auth.token();
  const authedReq = token && !isAuthEndpoint
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authedReq).pipe(
    catchError((err: HttpErrorResponse) => {
      const refreshToken = auth.getRefreshToken();
      if (err.status !== 401 || isAuthEndpoint || !refreshToken) {
        if (err.status === 401) auth.logout();
        return throwError(() => err);
      }

      // One silent refresh attempt, then retry the original request.
      return http.post<{ token: string }>(`${environment.apiUrl}/api/auth/refresh`, { refreshToken }).pipe(
        switchMap(({ token: newToken }) => {
          auth.setAccessToken(newToken);
          const retried = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
          return next(retried);
        }),
        catchError((refreshErr) => {
          auth.logout();
          router.navigateByUrl('/login');
          return throwError(() => refreshErr);
        })
      );
    })
  );
};
