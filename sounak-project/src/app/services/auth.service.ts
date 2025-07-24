// my-angular-frontend/src/app/services/auth.service.ts
import { Injectable } from '@angular/core';
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

  constructor(private http: HttpClient, private router: Router) {
    // Initialize from localStorage if token exists
    const storedUser = localStorage.getItem('user');
    this.userSubject = new BehaviorSubject<User | null>(storedUser ? JSON.parse(storedUser) : null);
    this.user$ = this.userSubject.asObservable();
  }

  // Get current user value (synchronous access)
  public get currentUserValue(): User | null {
    return this.userSubject.value;
  }

  register(name: string, email: string, password: string): Observable<User> {
    return this.http.post<User>(`${this.backendUrl}/register`, { name, email, password }).pipe(
      tap(user => {
        localStorage.setItem('user', JSON.stringify(user));
        this.userSubject.next(user); // Update BehaviorSubject
      })
    );
  }

  login(email: string, password: string): Observable<User> {
    return this.http.post<User>(`${this.backendUrl}/login`, { email, password }).pipe(
      tap(user => {
        localStorage.setItem('user', JSON.stringify(user));
        this.userSubject.next(user); // Update BehaviorSubject
      })
    );
  }

  logout(): void {
    localStorage.removeItem('user');
    this.userSubject.next(null); // Clear BehaviorSubject
    this.router.navigate(['/login']); // Redirect to login page
  }

  // Check if user is logged in (based on presence of token)
  isLoggedIn(): boolean {
    return !!this.currentUserValue?.token;
  }

  // Get token (for interceptor)
  getToken(): string | null {
    return this.currentUserValue ? this.currentUserValue.token : null;
  }
}