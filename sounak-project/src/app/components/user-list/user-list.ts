import { Component, OnInit, ViewChild, AfterViewInit, signal } from '@angular/core';
import { Store, select } from '@ngrx/store';
import { Observable, take } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';

import { User } from '../../models/user.model';
import { loadUsers } from '../../store/user/user.actions';
import { selectUsers, selectUsersLoading, selectUsersError } from '../../store/user/user.selectors';
import { CapitalizeWordPipe } from '../../pipes/capitalize-word-pipe';
import { Router } from '@angular/router';

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.html',
  styleUrls: ['./user-list.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatProgressSpinnerModule,
    MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule,
    MatTooltipModule, MatChipsModule,
    CapitalizeWordPipe,
  ],
})
export class UserListComponent implements OnInit, AfterViewInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  loading$: Observable<boolean>;
  error$: Observable<any>;

  readonly dataSource = new MatTableDataSource<User>([]);
  readonly displayedColumns = ['avatar', 'name', 'email', 'actions'];
  readonly searchText = signal('');
  readonly totalUsers = signal(0);

  constructor(private store: Store, private router: Router) {
    this.loading$ = this.store.pipe(select(selectUsersLoading));
    this.error$   = this.store.pipe(select(selectUsersError));
  }

  ngOnInit(): void {
    this.store.pipe(select(selectUsers), take(1)).subscribe(users => {
      if (!users || users.length === 0) {
        this.store.dispatch(loadUsers());
      }
    });

    // Keep dataSource in sync with the store
    this.store.pipe(select(selectUsers)).subscribe(users => {
      this.dataSource.data = users;
      this.totalUsers.set(users.length);
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort      = this.sort;
    // Custom filter predicate: search across name and email
    this.dataSource.filterPredicate = (user: User, filter: string) => {
      const term = filter.toLowerCase();
      return user.name.toLowerCase().includes(term) ||
             user.email.toLowerCase().includes(term);
    };
  }

  applyFilter(value: string): void {
    this.searchText.set(value);
    this.dataSource.filter = value.trim().toLowerCase();
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  clearSearch(): void {
    this.applyFilter('');
  }

  getInitial(name: string): string {
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  getAvatarColor(name: string): string {
    const colors = ['#667eea', '#11998e', '#f57c00', '#e91e63', '#1976d2', '#7c3aed', '#00897b'];
    const idx = name.charCodeAt(0) % colors.length;
    return colors[idx];
  }

  showProfile(user: User): void {
    console.log('Profile:', user);
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  reload(): void {
    this.store.dispatch(loadUsers());
  }

  trackById(_: number, user: User): number {
    return user.id;
  }
}
