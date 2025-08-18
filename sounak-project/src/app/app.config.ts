import { ApplicationConfig, importProvidersFrom, isDevMode, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { JwtInterceptor } from './interceptors/jwt.interceptor';
import { provideStore, provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { userReducer } from './state/user/user.reducer';
import { UserEffects } from './state/user/user.effects';


export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    //provideHttpClient(),
    provideHttpClient(withFetch()),
    JwtInterceptor,
    provideClientHydration(withEventReplay()),
    importProvidersFrom(MatToolbarModule,
      MatTabsModule,
      MatButtonModule,
      MatTooltipModule,
      MatSnackBarModule),
    provideStore(),
    provideState({ name: 'user', reducer: userReducer }),
    provideEffects([UserEffects]),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ]
};
