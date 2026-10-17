// src/app/admin/data/admin-booking.service.ts
//
// Clinics with their doctors and weekly hours, and test centres with their
// tests — everything the customer's "Doctors & Tests" screen shows.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Doctor, MedicalCenter } from '../../core/medical-center.service';
import { Lab, LabTest } from '../../core/lab.service';

export interface ScheduleSlotInput {
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  startTime: string; // 'HH:MM'
  endTime: string;
}

export interface CenterInput {
  name: string;
  phone: string;
  address: string;
  mapUrl: string;
  photoUrl: string | null;
}

export interface DoctorInput {
  name: string;
  specialization: string;
  qualification: string;
  experienceYears: string | number;
  consultationFee: string | number;
  registrationNo: string;
  languages: string;
  about: string;
  photoUrl: string | null;
  slots: ScheduleSlotInput[];
}

export interface LabInput {
  name: string;
  phone: string;
  address: string;
  openingHours: string;
  accreditation: string;
  mapUrl: string;
  photoUrl: string | null;
}

export interface TestInput {
  name: string;
  price: string | number;
  description: string;
  sampleType: string;
  preparation: string;
  reportTime: string;
}

/** A doctor as GET /api/doctors/:id returns it: with the clinic's name. */
export type DoctorDetail = Doctor & { center_name: string };
export type TestDetail = LabTest & { lab_name: string };

interface One<T> {
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminBookingService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/api`;

  // --- Clinics & doctors ---------------------------------------------------

  /** Every clinic and doctor, hidden ones included, with schedules nested. */
  listCenters(): Observable<{ data: MedicalCenter[] }> {
    return this.http.get<{ data: MedicalCenter[] }>(`${this.api}/medical-centers?includeInactive=true`);
  }

  getCenter(id: string): Observable<One<MedicalCenter>> {
    return this.http.get<One<MedicalCenter>>(`${this.api}/medical-centers/${encodeURIComponent(id)}`);
  }

  createCenter(input: CenterInput): Observable<One<MedicalCenter>> {
    return this.http.post<One<MedicalCenter>>(`${this.api}/medical-centers`, input);
  }

  updateCenter(id: string, input: CenterInput): Observable<One<MedicalCenter>> {
    return this.http.put<One<MedicalCenter>>(`${this.api}/medical-centers/${encodeURIComponent(id)}`, input);
  }

  setCenterActive(id: string, active: boolean): Observable<One<MedicalCenter>> {
    return this.http.patch<One<MedicalCenter>>(`${this.api}/medical-centers/${encodeURIComponent(id)}/active`, { active });
  }

  getDoctor(id: string): Observable<One<DoctorDetail>> {
    return this.http.get<One<DoctorDetail>>(`${this.api}/doctors/${encodeURIComponent(id)}`);
  }

  /** Creates the doctor and their weekly hours in one transaction. */
  createDoctor(centerId: string, input: DoctorInput): Observable<One<Doctor>> {
    return this.http.post<One<Doctor>>(`${this.api}/medical-centers/${encodeURIComponent(centerId)}/doctors`, input);
  }

  /** Saves details and replaces the weekly hours, both or neither. */
  updateDoctor(id: string, input: DoctorInput): Observable<One<DoctorDetail>> {
    return this.http.put<One<DoctorDetail>>(`${this.api}/doctors/${encodeURIComponent(id)}`, input);
  }

  setDoctorActive(id: string, active: boolean): Observable<One<Doctor>> {
    return this.http.patch<One<Doctor>>(`${this.api}/doctors/${encodeURIComponent(id)}/active`, { active });
  }

  // --- Test centres & tests -------------------------------------------------

  listLabs(): Observable<{ data: Lab[] }> {
    return this.http.get<{ data: Lab[] }>(`${this.api}/labs?includeInactive=true`);
  }

  getLab(id: string): Observable<One<Lab>> {
    return this.http.get<One<Lab>>(`${this.api}/labs/${encodeURIComponent(id)}`);
  }

  createLab(input: LabInput): Observable<One<Lab>> {
    return this.http.post<One<Lab>>(`${this.api}/labs`, input);
  }

  updateLab(id: string, input: LabInput): Observable<One<Lab>> {
    return this.http.put<One<Lab>>(`${this.api}/labs/${encodeURIComponent(id)}`, input);
  }

  setLabActive(id: string, active: boolean): Observable<One<Lab>> {
    return this.http.patch<One<Lab>>(`${this.api}/labs/${encodeURIComponent(id)}/active`, { active });
  }

  getTest(id: string): Observable<One<TestDetail>> {
    return this.http.get<One<TestDetail>>(`${this.api}/tests/${encodeURIComponent(id)}`);
  }

  createTest(labId: string, input: TestInput): Observable<One<LabTest>> {
    return this.http.post<One<LabTest>>(`${this.api}/labs/${encodeURIComponent(labId)}/tests`, input);
  }

  updateTest(id: string, input: TestInput): Observable<One<LabTest>> {
    return this.http.put<One<LabTest>>(`${this.api}/tests/${encodeURIComponent(id)}`, input);
  }

  setTestActive(id: string, active: boolean): Observable<One<LabTest>> {
    return this.http.patch<One<LabTest>>(`${this.api}/tests/${encodeURIComponent(id)}/active`, { active });
  }
}
