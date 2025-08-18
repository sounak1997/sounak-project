// my-angular-frontend/src/app/components/login/login.component.ts
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms'; // Import FormsModule for ngModel
import { CommonModule } from '@angular/common'; // For ngIf, ngClass etc.
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
  ],
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class LoginComponent implements OnInit {
  email = '';
  password = '';
  loading = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // If already logged in, redirect to home/dashboard
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']); // Or wherever your protected route is
    }
  }

  onSubmit(): void {
    this.loading = true;
    this.authService.login(this.email, this.password).subscribe({
      next: (user) => {
        this.snackBar.open('Login successful!', 'Dismiss', { duration: 3000 });
        this.router.navigate(['/dashboard']); // Redirect to a protected route
      },
      error: (err) => {
        this.loading = false;
        const errorMessage = err.error?.message || 'Login failed. Please check credentials.';
        this.snackBar.open(errorMessage, 'Dismiss', { duration: 5000 });
      }
    });
  }
}