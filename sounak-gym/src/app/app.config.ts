import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { apiUrlInterceptor } from './core/api-url.interceptor';
import { authInterceptor } from './core/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Order matters: apiUrlInterceptor rewrites the URL onto the backend origin,
    // and authInterceptor's decision about whether to attach the owner's token
    // is made by inspecting that URL.
    provideHttpClient(withInterceptors([apiUrlInterceptor, authInterceptor])),
  ],
};
