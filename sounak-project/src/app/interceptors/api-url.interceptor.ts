import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environment/environment';

/**
 * Rewrites relative API URLs onto the configured backend origin.
 *
 * Most services were written against a same-origin deployment — Express served
 * the Angular bundle, so `/api/auth/login` resolved to the backend for free.
 * Now the frontend is on Cloudflare and the API is on Render, so those relative
 * paths hit the static host instead, which answers 405.
 *
 * Doing it here rather than editing every service means a service can keep
 * using a plain '/api/...' path and still work under both layouts: when
 * apiUrl is '' (local dev, proxied by proxy.conf.json, or a single-host
 * deploy) this is a no-op.
 */
@Injectable()
export class ApiUrlInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const base = environment.apiUrl;
    // No base configured, or the caller already passed an absolute URL.
    if (!base || /^https?:\/\//i.test(req.url)) {
      return next.handle(req);
    }
    if (!req.url.startsWith('/api')) {
      return next.handle(req);
    }
    return next.handle(req.clone({ url: `${base}${req.url}` }));
  }
}
