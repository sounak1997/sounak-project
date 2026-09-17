// src/app/core/medical-center.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DoctorScheduleSlot {
  day_of_week: number; // 0=Sunday .. 6=Saturday
  start_time: string;
  end_time: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialization: string | null;
  schedule: DoctorScheduleSlot[];
}

export interface MedicalCenter {
  id: string;
  name: string;
  address: string | null;
  phone: string;
  doctors: Doctor[];
}

interface CenterListResponse {
  success: boolean;
  count: number;
  data: MedicalCenter[];
}

@Injectable({ providedIn: 'root' })
export class MedicalCenterService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  list(): Observable<CenterListResponse> {
    return this.http.get<CenterListResponse>(`${this.apiUrl}/api/medical-centers`);
  }
}
