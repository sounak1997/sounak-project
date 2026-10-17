// src/app/core/lab.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LabTest {
  id: string;
  lab_id: string;
  name: string;
  price: string | null;
  description: string | null;
  sample_type: string | null;
  preparation: string | null;
  report_time: string | null;
  active: boolean;
}

export interface Lab {
  id: string;
  name: string;
  address: string | null;
  phone: string;
  opening_hours: string | null;
  accreditation: string | null;
  map_url: string | null;
  photo_url: string | null;
  active: boolean;
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
