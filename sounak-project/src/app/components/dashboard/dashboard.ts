import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { loadUsers } from '../../store/user/user.actions';
import { selectUsers, selectUsersLoading } from '../../store/user/user.selectors';
import { UserState } from '../../store/user/user.reducer';
import { User } from '../../models/user.model';

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
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  // Profile comes from the already-authenticated user in AuthService — no extra API call needed
  userProfile: UserProfile | null = null;

  // Users come from the NgRx store — no direct API call
  users$: Observable<User[]>;
  usersLoading$: Observable<boolean>;

  constructor(
    private authService: AuthService,
    private store: Store<UserState>,
    private snackBar: MatSnackBar,
    public router: Router
  ) {
    this.users$ = this.store.select(selectUsers);
    this.usersLoading$ = this.store.select(selectUsersLoading);
  }

  ngOnInit(): void {
    // Profile is already stored in AuthService from login — read it directly
    const current = this.authService.currentUserValue;
    if (current) {
      this.userProfile = { _id: current._id, name: current.name, email: current.email };
    }

    // Only dispatch loadUsers if the store is empty (avoids redundant API calls)
    // If user-list was visited before, data is already in the store — no API call fires
    this.users$.subscribe(users => {
      if (users.length === 0) {
        this.store.dispatch(loadUsers());
      }
    }).unsubscribe(); // one-shot check
  }

  goToProductList():    void { this.router.navigate(['/products']);         }
  goToSignalProducts(): void { this.router.navigate(['/signal-products']);  }
  goToSignalDemo():     void { this.router.navigate(['/signal-demo']);       }
  goToNotifications():  void { this.router.navigate(['/notifications']);     }
  goToAddUser():        void { this.router.navigate(['/add-user']);          }
  goToChat():           void { this.router.navigate(['/chat']);              }

  logout(): void {
    this.authService.logout();
    this.snackBar.open('Logged out successfully!', 'Dismiss', { duration: 3000 });
  }
}
