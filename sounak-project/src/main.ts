import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app';
import { appConfig } from './app/app.config';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideHttpClient } from '@angular/common/http';
import { provideEffects } from '@ngrx/effects';
import { userReducer } from './app/store/user/user.reducer';
import { UserEffects } from './app/store/user/user.effects';

bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [
    ...(appConfig.providers || []),
    provideHttpClient(),
    provideStore({ user: userReducer }), // Must come first
    //provideEffects([UserEffects]),       // Effects after store
    provideStoreDevtools({ maxAge: 25 })
  ]
}).catch(err => console.error(err));
