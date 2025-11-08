import { Component, OnInit } from '@angular/core';
import { Store, select } from '@ngrx/store';
import { Observable, take } from 'rxjs';
import { User } from '../../models/user.model';
import { loadUsers } from '../../store/user/user.actions';
import { selectUsers, selectUsersLoading, selectUsersError } from '../../store/user/user.selectors';
import { CommonModule } from '@angular/common';
// Import required Material Modules
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button'; // New
import { MatIconModule } from '@angular/material/icon';     // New
import { CapitalizeWordPipe } from '../../pipes/capitalize-word-pipe';

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.html',
  styleUrls: ['./user-list.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    MatCardModule, 
    MatListModule, 
    MatProgressSpinnerModule,
    MatButtonModule, // Added
    MatIconModule,   // Added
    CapitalizeWordPipe
  ],
})
export class UserListComponent implements OnInit {
  users$: Observable<User[]>;
  loading$: Observable<boolean>;
  error$: Observable<any>;

  constructor(private store: Store) {
    this.users$ = this.store.pipe(select(selectUsers));
    this.loading$ = this.store.pipe(select(selectUsersLoading));
    this.error$ = this.store.pipe(select(selectUsersError));
  }

  ngOnInit() {
    this.users$.pipe(take(1)).subscribe(users => {
      if (!users || users.length === 0) {
        this.store.dispatch(loadUsers());
      }
    });
  }

  // New method to handle the button click
  showProfile(user: User) {
    // This is where you will implement the logic to show the child component.
    // Common approaches:
    // 1. Open a MatDialog (Modal) with the child component.
    // 2. Use a service to update a state/subject that the child component listens to.
    // 3. Simple approach: Emit an event to the parent container to open a side drawer.

    console.log('Showing profile for user:', user.name);

    // TODO: Implement dialog or other detail view logic here
  }
  
  // Adjusted trackBy (assuming 'id' is a better unique identifier than 'name')
  trackById(index: number, user: User) {
    // CHANGE THIS: Return user.id if your User model has an 'id' field, as names may not be unique.
    return user.name; 
  }
}