import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../core/auth.service';

/**
 * Member sign-up from anywhere — the path for someone who is not at the gym.
 *
 * Identity is proven with the member code the gym issued plus the mobile number
 * on their record. Phone alone would prove nothing (typing a number and then
 * confirming digits of that same number is circular), and an OTP would need an
 * SMS provider and a per-message cost.
 *
 * A member standing at the gym does not need this at all: scanning the door QR
 * recognises them and offers "Set up online access" with nothing to type.
 */
@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './signup.page.html',
  styleUrl: './signup.page.scss',
})
export class SignupPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly memberCode = signal('');
  readonly phone = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  // Email is not required: the mobile number entered above becomes the login
  // identifier, so there is nothing else we need.
  readonly canSubmit = () =>
    this.memberCode().trim().length > 0 &&
    this.phone().replace(/\D/g, '').length >= 10 &&
    this.password().length >= 8;

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signUp({
        memberCode: this.memberCode().trim(),
        phone: this.phone().trim(),
        email: this.email().trim() || undefined,
        password: this.password(),
      });
      // Signed in already — go straight to their record.
      await this.router.navigateByUrl(this.auth.homeRoute());
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.error?.message
          ? err.error.message
          : 'Could not create your account. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
