import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Platform operator only. Restores the session first, like authGuard, so a
 * reload of /admin does not bounce to the login screen.
 *
 * This only hides the screen — the server is what actually enforces it
 * (platformAdminOnly in gymRoutes). A gym owner who types /admin is sent to
 * their own console rather than to the login form: they ARE signed in, and a
 * login prompt would read as a broken session.
 */
export const platformAdminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isSignedIn() && !(await auth.restore())) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  return auth.account()?.platformAdmin ? true : router.createUrlTree([auth.homeRoute()]);
};
