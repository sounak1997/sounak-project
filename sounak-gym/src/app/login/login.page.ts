import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../core/auth.service';

/**
 * Gym owner / staff sign-in.
 *
 * Members never see this screen — they are recognised at the door by their
 * device. This is only for the people who run a gym.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly identifier = signal('');
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  async submit(): Promise<void> {
    if (!this.identifier().trim() || !this.password()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.identifier().trim(), this.password());
      // Owners land on the console, members on their own record. One account
      // can be both, in which case homeRoute() picks the console.
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? this.auth.homeRoute();
      await this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.error?.message
          ? err.error.message
          : 'Could not sign in. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
