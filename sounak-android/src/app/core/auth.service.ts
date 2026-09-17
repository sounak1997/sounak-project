// src/app/core/auth.service.ts
//
// Signals-based auth state, shared across the app. Token + user persist to
// localStorage so a page reload (or reopening the Capacitor app) doesn't
// drop the session — the whole point of FR-3.4-style "tied to the account"
// persistence starts here with the session itself.
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'customer';
}

interface AuthResponse {
  _id: string;
  name: string;
  email: string;
  role: 'admin' | 'customer';
  token: string;
  refreshToken: string;
}

const STORAGE_KEY = 'sohay.auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private apiUrl = environment.apiUrl;

  private stored = this.loadStored();

  readonly user = signal<AuthUser | null>(this.stored?.user ?? null);
  readonly token = signal<string | null>(this.stored?.token ?? null);
  private readonly refreshToken = signal<string | null>(this.stored?.refreshToken ?? null);

  readonly isLoggedIn = computed(() => !!this.token());

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/api/auth/login`, { email, password }).pipe(
      tap((res) => this.setSession(res))
    );
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/api/auth/register`, { name, email, password }).pipe(
      tap((res) => this.setSession(res))
    );
  }

  logout(): void {
    this.user.set(null);
    this.token.set(null);
    this.refreshToken.set(null);
    localStorage.removeItem(STORAGE_KEY);
    this.router.navigateByUrl('/login');
  }

  getRefreshToken(): string | null {
    return this.refreshToken();
  }

  /** Called by the auth interceptor once a silent refresh succeeds. */
  setAccessToken(token: string): void {
    this.token.set(token);
    this.persist();
  }

  private setSession(res: AuthResponse): void {
    this.user.set({ id: res._id, name: res.name, email: res.email, role: res.role });
    this.token.set(res.token);
    this.refreshToken.set(res.refreshToken);
    this.persist();
  }

  private persist(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user: this.user(), token: this.token(), refreshToken: this.refreshToken() })
    );
  }

  private loadStored(): { user: AuthUser; token: string; refreshToken: string } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
