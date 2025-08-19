// src/app/pages/add-user/add-user.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

// Import your API service
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-add-user',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
  templateUrl: './add-user.html',
  styleUrls: ['./add-user.scss'],
})
export class AddUserComponent implements OnInit {
  userForm!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private apiService: ApiService, // Inject the API service
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.userForm = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  onSubmit(): void {
    if (this.userForm.valid) {
      // Make the API call directly
      this.apiService.addUser(this.userForm.value).subscribe({
        next: (response) => {
          this.snackBar.open('User added successfully!', 'Dismiss', { duration: 3000 });
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          console.error('Failed to add user:', err);
          this.snackBar.open('Failed to add user. Please try again.', 'Dismiss', { duration: 5000 });
        }
      });
    }
  }

  cancel(): void {
    this.router.navigate(['/dashboard']);
  }
}