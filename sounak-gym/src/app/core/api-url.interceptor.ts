import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environment/environment';

/**
 * Rewrites relative /api URLs onto the configured backend origin.
 *
 * Adapted from sounak-project's interceptor of the same name. Letting every
 * service keep a plain '/api/...' path means the same code works both locally
 * (apiUrl empty, proxied by proxy.conf.json) and deployed (frontend on
 * Cloudflare, API on Render), with no per-service branching.
 */
export const apiUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const base = environment.apiUrl;
  if (!base || /^https?:\/\//i.test(req.url) || !req.url.startsWith('/api')) {
    return next(req);
  }
  return next(req.clone({ url: `${base}${req.url}` }));
};
