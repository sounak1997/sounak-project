import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guards the owner console. Restores the session from the stored token first,
 * so a page reload does not bounce a signed-in owner back to the login screen.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isSignedIn() || (await auth.restore())) return true;

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
