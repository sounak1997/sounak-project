import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';

import { User } from '../../models/user.model';
import * as UserActions from '../../state/user/user.actions';
import { UserState } from '../../state/user/user.state';

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
    private store: Store<{ user: UserState }>,
    private router: Router
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
      const newUser: User = {
        _id: Math.random().toString(), // Simple mock ID
        name: this.userForm.value.name,
        email: this.userForm.value.email,
        // Password is not stored in state
      };
      
      this.store.dispatch(UserActions.addUser({ user: newUser }));
      this.router.navigate(['/dashboard']);
    }
  }

  cancel(): void {
    this.router.navigate(['/dashboard']);
  }
}