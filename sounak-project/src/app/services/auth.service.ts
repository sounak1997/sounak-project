// my-angular-frontend/src/app/services/auth.service.ts

import { Injectable, PLATFORM_ID, Inject } from '@angular/core'; // <-- Add PLATFORM_ID, Inject
import { isPlatformBrowser } from '@angular/common'; // <-- Add isPlatformBrowser
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, tap } from 'rxjs';
import { Router } from '@angular/router'; // For redirection on logout

interface User {
  _id: string;
  name: string;
  email: string;
  token: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private backendUrl = '/api/auth'; // Specific to auth endpoints
  private userSubject: BehaviorSubject<User | null>; // To hold current user state
  public user$: Observable<User | null>; // Public observable for components to subscribe

  constructor(
    private http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object // <-- Inject PLATFORM_ID
  ) {
    let storedUser: User | null = null;
    // Conditionally access localStorage in the constructor
    if (isPlatformBrowser(this.platformId)) {
      const userJson = localStorage.getItem('user');
      if (userJson) {
        storedUser = JSON.parse(userJson);
      }
    }
    this.userSubject = new BehaviorSubject<User | null>(storedUser);
    this.user$ = this.userSubject.asObservable();
  }

  // Get current user value (synchronous access)
  public get currentUserValue(): User | null {
    return this.userSubject.value;
  }

  register(name: string, email: string, password: string): Observable<User> {
    return this.http.post<User>(`${this.backendUrl}/register`, { name, email, password }).pipe(
      tap(user => {
        // Conditionally set localStorage
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('user', JSON.stringify(user));
        }
        this.userSubject.next(user); // Update BehaviorSubject regardless of platform
      })
    );
  }

  login(email: string, password: string): Observable<User> {
    return this.http.post<User>(`${this.backendUrl}/login`, { email, password }).pipe(
      tap(user => {
        // Conditionally set localStorage
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('user', JSON.stringify(user));
        }
        this.userSubject.next(user); // Update BehaviorSubject regardless of platform
      })
    );
  }

  logout(): void {
    // Conditionally remove from localStorage
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('user');
    }
    this.userSubject.next(null); // Clear BehaviorSubject
    this.router.navigate(['/login']); // Redirect to login page
  }

  /**
   * True only if a token exists AND has not expired.
   *
   * Tokens are signed with `expiresIn: '1h'` (see backend generateToken.js).
   * Checking only for the token's *presence* left the app in a "zombie" state:
   * the guard let you into protected pages with a long-dead token, and every
   * API call then failed with a 401 that looked like a feature bug.
   */
  isLoggedIn(): boolean {
    const token = this.currentUserValue?.token;
    return !!token && !this.isTokenExpired(token);
  }

  /** Decode the JWT payload and compare its `exp` claim against now. */
  private isTokenExpired(token: string): boolean {
    try {
      // JWTs are base64url-encoded; convert to standard base64 before decoding.
      const payloadSegment = token.split('.')[1];
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64));

      if (!payload.exp) return false; // no expiry claim — treat as valid
      return Date.now() >= payload.exp * 1000;
    } catch {
      // Malformed token — safest to treat it as unusable.
      return true;
    }
  }

  // Get token (for interceptor)
  getToken(): string | null {
    // Accessing currentUserValue is fine as it's updated by BehaviorSubject
    return this.currentUserValue ? this.currentUserValue.token : null;
  }
}