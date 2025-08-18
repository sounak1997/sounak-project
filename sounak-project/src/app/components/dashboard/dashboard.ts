import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router'; // Add RouterLink for navigation
import { Observable } from 'rxjs'; // For NgRx state streams
import { Store } from '@ngrx/store'; // The NgRx Store

// New imports for NgRx
import { User } from '../../models/user.model';
import { UserState } from '../../state/user/user.state';
import * as UserActions from '../../state/user/user.actions';
import * as UserSelectors from '../../state/user/user.selectors';
import { AuthService } from '../../services/auth.service';

/*
// Old imports
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth.service';

interface UserProfile {
  _id: string;
  name: string;
  email: string;
}
*/

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    RouterLink // For navigation
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {

  // Old code for local component state
  /*
  userProfile: UserProfile | null = null;
  usersFromApi: any[] = [];
  */

  // New code: Properties to hold NgRx state as Observables
  userProfile$!: Observable<User | null>;
  usersFromApi$!: Observable<User[]>;
  loading$!: Observable<boolean>;
  public UserActions = UserActions; 

  constructor(
    // Old code: Injecting services for direct API calls
    /*
    private authService: AuthService,
    private apiService: ApiService,
    private snackBar: MatSnackBar,
    private router: Router
    */

    // New code: Injecting NgRx Store to manage state
    public store: Store<{ user: UserState }>,
    private authService: AuthService, // Keep this for logout logic
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Old code: Fetching data directly on component initialization
    /*
    if (this.authService.currentUserValue) {
      this.userProfile = {
        _id: this.authService.currentUserValue._id,
        name: this.authService.currentUserValue.name,
        email: this.authService.currentUserValue.email
      };
    }
    this.fetchUsersFromProtectedApi();
    */

    // New code: Subscribing to NgRx state streams and dispatching actions
    this.userProfile$ = this.store.select(UserSelectors.selectUserProfile);
    this.usersFromApi$ = this.store.select(UserSelectors.selectUsersList);
    this.loading$ = this.store.select(UserSelectors.selectUserLoading);

    // Dispatching actions to trigger the data loading via NgRx Effects
    this.store.dispatch(UserActions.loadUserProfile());
    this.store.dispatch(UserActions.loadUsersList());
  }

  // Old code: Method to fetch data directly
  /*
  fetchUsersFromProtectedApi(): void {
    this.apiService.getProfile().subscribe({
      next: (data: UserProfile) => {
        this.userProfile = data;
        this.snackBar.open('User profile fetched from protected API!', 'Dismiss', { duration: 3000 });
      },
      error: (err: any) => {
        console.error('Error fetching protected user profile:', err);
        this.snackBar.open('Failed to fetch protected profile. You might not be authenticated.', 'Dismiss', { duration: 5000 });
        if (err.status === 401) {
          this.authService.logout();
        }
      }
    });

    this.apiService.getUsers().subscribe({
      next: (data: any) => {
        this.usersFromApi = data;
        this.snackBar.open('General users list fetched!', 'Dismiss', { duration: 2000 });
      },
      error: (err: any) => {
        console.error('Error fetching general users:', err);
      }
    });
  }
  */

  // Old logout method (unchanged)
  logout(): void {
    this.authService.logout();
    this.snackBar.open('Logged out successfully!', 'Dismiss', { duration: 3000 });
  }
}