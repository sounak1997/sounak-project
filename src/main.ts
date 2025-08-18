// my-angular-frontend/src/main.ts

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config'; // Assuming you have app.config.ts
import { AppComponent } from './app/app'; // Correctly import your root component
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptors, withInterceptorsFromDi } from '@angular/common/http';
import { JwtInterceptor } from './app/interceptors/jwt.interceptor';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    // Provide HttpClient features
    // Use withInterceptorsFromDi for class-based interceptors
    provideHttpClient(withInterceptorsFromDi()), // <-- Changed!

    // Provide the JwtInterceptor as a class in the providers array
    // Angular's DI will now be able to resolve it because of withInterceptorsFromDi()
    { provide: HTTP_INTERCEPTORS, useClass: JwtInterceptor, multi: true }, // <-- Added!

    // If your AuthService is NOT `providedIn: 'root'`, you'd also provide it here:
    // AuthService, // Only if not providedIn: 'root'

    // If you're using Angular Router, include this:
    provideRouter(routes), // Make sure 'routes' is imported from your routing file

    // Other global services/providers go here if needed
  ]
}).catch(err => console.error(err));