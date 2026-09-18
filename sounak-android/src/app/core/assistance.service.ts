// src/app/core/assistance.service.ts
//
// Callback-queue requests (FR-3.10 / FR-3.11). The wa.me/tel links in
// HelperContactComponent reach the assistant directly; this puts the request
// in the admin's queue instead, so it isn't lost if nobody picks up.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type AssistanceReason = 'place_order' | 'general_help' | 'delivery_issue' | 'custom';

export interface AssistanceRequest {
  id: string;
  phone: string;
  reason: AssistanceReason;
  note: string | null;
  status: 'pending' | 'contacted' | 'resolved';
  created_at: string;
}

interface AssistanceResponse {
  success: boolean;
  data: AssistanceRequest;
}

interface AssistanceListResponse {
  success: boolean;
  count: number;
  data: AssistanceRequest[];
}

@Injectable({ providedIn: 'root' })
export class AssistanceService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  create(reason: AssistanceReason, phone: string, note?: string): Observable<AssistanceResponse> {
    return this.http.post<AssistanceResponse>(`${this.apiUrl}/api/assistance`, { reason, phone, note });
  }

  listMine(): Observable<AssistanceListResponse> {
    return this.http.get<AssistanceListResponse>(`${this.apiUrl}/api/assistance/mine`);
  }
}
