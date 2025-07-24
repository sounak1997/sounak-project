// my-angular-frontend/src/app/app.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';

// Import the new components
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { DashboardComponent } from './components/dashboard/dashboard';

// Import AuthService and the 'map' operator from RxJS
import { AuthService } from './services/auth.service';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators'; // <--- IMPORTANT: Import the map operator here!


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatTabsModule,
    LoginComponent,
    RegisterComponent,
    
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class AppComponent implements OnInit {
  title = 'Angular Fullstack App';
  isLoggedIn$: Observable<boolean>; // This is correctly typed as Observable<boolean>

  constructor(
    private authService: AuthService,
    private snackBar: MatSnackBar // If you're using it
  ) {
    // Correctly use the 'map' operator to transform the emitted user object
    this.isLoggedIn$ = this.authService.user$.pipe(
      map(user => !!user && !!user.token) // <--- Fix is here!
    );
  }

  ngOnInit(): void {
    // Your existing ngOnInit logic for fetching users might go in Dashboard now
    // Or fetch general public users if the route is not protected
  }

  logout(): void {
    this.authService.logout();
    this.snackBar.open('Logged out successfully!', 'Dismiss', { duration: 3000 });
  }
}