import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonList, IonItem, IonLabel, IonInput, IonButton, IonText, IonSpinner,
} from '@ionic/angular';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  imports: [
    FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
    IonList, IonItem, IonLabel, IonInput, IonButton, IonText, IonSpinner,
  ],
})
export class RegisterPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  name = '';
  email = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  submit(): void {
    if (!this.name || !this.email || !this.password) {
      this.error.set('Fill in your name, email and password.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);

    // Self-registration always creates a customer account (FR-1.2 /
    // FR-1.3) — there is no role field in this form, deliberately.
    this.auth.register(this.name.trim(), this.email.trim(), this.password).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigateByUrl('/home');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Could not create your account.');
      },
    });
  }
}
