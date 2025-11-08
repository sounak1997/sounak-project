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

  getUsers(): Observable<any> {
    return this.http.get<any>(`${this.backendUrl}/users`);
  }

  createUser(user: any): Observable<any> {
    return this.http.post<any>(`${this.backendUrl}/users`, user);
  }

  addUser(userData: any) {
    return this.http.post(`${this.backendUrl}/users`, userData);
  }

  // --- NEW SPECIFIC GET PROFILE METHOD ---
  getProfile(): Observable<any> { // You can define a UserProfile interface if you have one
    return this.http.get<any>(`${this.backendUrl}/auth/profile`);
  }

  getProfileDesc():Observable<any>{
    return this.http.get<any>(`${this.backendUrl}/users/get`)
  }
  // --- END NEW SPECIFIC GET PROFILE METHOD ---
  //Products Related
  getProductsList(): Observable<any> {
    // Calls the backend endpoint: GET /api/products
    return this.http.get<any>(`${this.backendUrl}/products/list`);
  }

  getProductDetails(id: any): Observable<any> {
    // Calls the backend endpoint: GET /api/products
    return this.http.get<any>(`${this.backendUrl}/products/` + id);
  }
  getProductInfo(id: any): Observable<any> {
    // Calls the backend endpoint: GET /api/products
    return this.http.get<any>(`${this.backendUrl}/products/` + id + `/info`);
  }
}