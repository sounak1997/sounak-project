import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
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
import { Router } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { CapitalizeWordPipe } from '../../pipes/capitalize-word-pipe';

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
    MatTooltipModule,
    CapitalizeWordPipe,
  ],
})
export class UserListComponent implements OnInit {

  private api    = inject(ApiService);
  private router = inject(Router);

  // Paginator/sort setters — connect the moment Angular renders them
  @ViewChild(MatPaginator) set paginator(p: MatPaginator) {
    if (p) this.dataSource.paginator = p;
  }
  @ViewChild(MatSort) set sort(s: MatSort) {
    if (s) this.dataSource.sort = s;
  }

  readonly dataSource      = new MatTableDataSource<any>([]);
  readonly displayedColumns = ['avatar', 'name', 'email', 'actions'];
  readonly searchText      = signal('');
  readonly totalUsers      = signal(0);
  readonly loading         = signal(false);
  readonly errorMsg        = signal<string | null>(null);

  ngOnInit(): void {
    this.dataSource.filterPredicate = (user: any, filter: string) => {
      const t = filter.toLowerCase();
      return (user.name ?? '').toLowerCase().includes(t) ||
             (user.email ?? '').toLowerCase().includes(t);
    };
    this.fetchUsers();
  }

  fetchUsers(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.api.getUsers().subscribe({
      next: (data: any) => {
        // API returns a plain array [{_id, name, email}, ...]
        const users = Array.isArray(data) ? data : (data.users ?? data.data ?? []);
        this.dataSource.data = users;
        this.totalUsers.set(users.length);
        this.loading.set(false);
      },
      error: () => {
        this.errorMsg.set('Could not load users. Is the backend running?');
        this.loading.set(false);
      },
    });
  }

  applyFilter(value: string): void {
    this.searchText.set(value);
    this.dataSource.filter = value.trim().toLowerCase();
    if (this.dataSource.paginator) this.dataSource.paginator.firstPage();
  }

  clearSearch(): void { this.applyFilter(''); }

  getInitial(name: string): string { return (name ?? '?').charAt(0).toUpperCase(); }

  getAvatarColor(name: string): string {
    const colors = ['#667eea', '#11998e', '#f57c00', '#e91e63', '#1976d2', '#7c3aed', '#00897b'];
    return colors[(name?.charCodeAt(0) ?? 0) % colors.length];
  }

  goBack():  void { this.router.navigate(['/dashboard']); }
  reload():  void { this.fetchUsers(); }

  trackById(_: number, user: any): string { return user._id ?? user.id; }
}
