import { ApplicationConfig, importProvidersFrom, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatNativeDateModule } from '@angular/material/core';

import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { JwtInterceptor } from './interceptors/jwt.interceptor';

import { provideStore } from '@ngrx/store';
import { EffectsModule, provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideRouterStore, routerReducer } from "@ngrx/router-store";

import { userReducer } from './store/user/user.reducer';
import { UserEffects } from './store/user/user.effects';

export const appConfig: ApplicationConfig = {
  providers: [
    // --- HttpClient & interceptors ---
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    { provide: HTTP_INTERCEPTORS, useClass: JwtInterceptor, multi: true },

    // --- Angular Router ---
    provideRouter(routes),

    // --- NgRx Store & Effects ---
    provideStore({ route: routerReducer, user: userReducer }),
    //provideEffects(UserEffects),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
    provideRouterStore(),
    importProvidersFrom(
      EffectsModule.forRoot([]),
      ),
    // --- Angular Material ---
    importProvidersFrom(
      MatNativeDateModule,
      MatToolbarModule,
      MatTabsModule,
      MatButtonModule,
      MatTooltipModule,
      MatSnackBarModule
    ),

    // --- Zone & Hydration ---
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideClientHydration(withEventReplay())
  ]
};
