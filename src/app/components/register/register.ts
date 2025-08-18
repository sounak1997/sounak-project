// my-angular-frontend/src/app/components/register/register.component.ts
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
  ],
  templateUrl: './register.html',
  styleUrls: ['./register.scss']
})
export class RegisterComponent implements OnInit {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  loading = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }
  }

  onSubmit(): void {
    if (this.password !== this.confirmPassword) {
      this.snackBar.open('Passwords do not match!', 'Dismiss', { duration: 3000 });
      return;
    }
    this.loading = true;
    this.authService.register(this.name, this.email, this.password).subscribe({
      next: (user) => {
        this.snackBar.open('Registration successful!', 'Dismiss', { duration: 3000 });
        this.router.navigate(['/dashboard']); // Redirect to a protected route
      },
      error: (err) => {
        this.loading = false;
        const errorMessage = err.error?.message || 'Registration failed. Please try again.';
        this.snackBar.open(errorMessage, 'Dismiss', { duration: 5000 });
      }
    });
  }
}