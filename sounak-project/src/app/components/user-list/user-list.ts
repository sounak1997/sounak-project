import { Component, OnInit } from '@angular/core';
import { Store, select } from '@ngrx/store';
import { Observable, take } from 'rxjs';
import { User } from '../../models/user.model';
import { loadUsers } from '../../store/user/user.actions';
import { selectUsers, selectUsersLoading, selectUsersError } from '../../store/user/user.selectors';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.html',
  styleUrls: ['./user-list.scss'],
  standalone: true,
  imports: [CommonModule, MatCardModule, MatListModule, MatProgressSpinnerModule],
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
    // Dispatch only if users array is empty
    console.log(this.users$)
    this.users$.pipe(take(1)).subscribe(users => {
      if (!users || users.length === 0) {
        this.store.dispatch(loadUsers());
      }
    });
  }

  trackById(index: number, user: User) {
  return user.name; // assumes each user has a unique 'id' field
}
}
