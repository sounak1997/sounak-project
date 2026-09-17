// src/app/core/lab.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LabTest {
  id: string;
  name: string;
  price: string | null;
  description: string | null;
}

export interface Lab {
  id: string;
  name: string;
  address: string | null;
  phone: string;
  tests: LabTest[];
}

interface LabListResponse {
  success: boolean;
  count: number;
  data: Lab[];
}

@Injectable({ providedIn: 'root' })
export class LabService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  list(): Observable<LabListResponse> {
    return this.http.get<LabListResponse>(`${this.apiUrl}/api/labs`);
  }
}
