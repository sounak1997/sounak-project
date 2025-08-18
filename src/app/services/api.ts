// my-angular-frontend/src/app/services/api.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private backendUrl = '/api';

  constructor(private http: HttpClient) { }

  getUsers(): Observable<any[]> {
    return this.http.get<any[]>(`${this.backendUrl}/users`);
  }

  createUser(user: any): Observable<any> {
    return this.http.post<any>(`${this.backendUrl}/users`, user);
  }

  // --- NEW SPECIFIC GET PROFILE METHOD ---
  getProfile(): Observable<any> { // You can define a UserProfile interface if you have one
    return this.http.get<any>(`${this.backendUrl}/auth/profile`);
  }
  // --- END NEW SPECIFIC GET PROFILE METHOD ---
}