// my-angular-frontend/src/app/components/dashboard/dashboard.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { ApiService } from '../../services/api';// For fetching users
import { AuthService } from '../../services/auth.service'; // For logout and user infoo


interface UserProfile {
  _id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  userProfile: UserProfile | null = null;
  usersFromApi: any[] = []; // To demonstrate fetching protected data

  constructor(
    private authService: AuthService,
    private apiService: ApiService, // Assuming ApiService for general API calls
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Get user profile data (from token on frontend)
    if (this.authService.currentUserValue) {
      this.userProfile = {
        _id: this.authService.currentUserValue._id,
        name: this.authService.currentUserValue.name,
        email: this.authService.currentUserValue.email
      };
    }

    // Example of fetching protected data (requires JWT Interceptor)
    this.fetchUsersFromProtectedApi();
  }

  fetchUsersFromProtectedApi(): void {
    // This assumes your /api/users route is protected by JWT.
    // If not, it will still work, but won't demonstrate protection.
    // For demonstration, let's call the /api/auth/profile directly
    // to show protection is working for that specific route.
    this.apiService.getProfile().subscribe({ // Assuming ApiService has a generic .get method
      next: (data: UserProfile) => {
        this.userProfile = data; // Update with data from protected API
        this.snackBar.open('User profile fetched from protected API!', 'Dismiss', { duration: 3000 });
      },
      error: (err: any) => {
        console.error('Error fetching protected user profile:', err);
        this.snackBar.open('Failed to fetch protected profile. You might not be authenticated.', 'Dismiss', { duration: 5000 });
        if (err.status === 401) {
          this.authService.logout(); // Log out if token is invalid/expired
        }
      }
    });

    // Also fetch general users list (if you want to test the previous /api/users route)
    this.apiService.getUsers().subscribe({ // Using the original getUsers
      next: (data: any) => {
        this.usersFromApi = data;
        this.snackBar.open('General users list fetched!', 'Dismiss', { duration: 2000 });
      },
      error: (err: any) => {
        console.error('Error fetching general users:', err);
        // This might fail if /api/users is also protected and no token is sent
      }
    });
  }


  logout(): void {
    this.authService.logout();
    this.snackBar.open('Logged out successfully!', 'Dismiss', { duration: 3000 });
  }
}