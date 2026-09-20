import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../core/auth.service';

/**
 * Forgotten password.
 *
 * Proved with member code + mobile number — the same two things sign-up asks
 * for, so a member who could create their login can always recover it.
 *
 * Staff cannot use this: they hold no member code. Their route back in is the
 * platform admin, and a member who has also lost their code can be reset by
 * their gym owner from the console.
 */
@Component({
  selector: 'app-reset',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset.page.html',
  styleUrl: './reset.page.scss',
})
export class ResetPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly memberCode = signal('');
  readonly phone = signal('');
  readonly newPassword = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  readonly canSubmit = () =>
    this.memberCode().trim().length > 0 &&
    this.phone().replace(/\D/g, '').length >= 10 &&
    this.newPassword().length >= 8;

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.resetPassword({
        memberCode: this.memberCode().trim(),
        phone: this.phone().trim(),
        newPassword: this.newPassword(),
      });
      // Already signed in — they just proved who they are and set a password.
      await this.router.navigateByUrl(this.auth.homeRoute());
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.error?.message
          ? err.error.message
          : 'Could not reset your password. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
