import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface PlatformGym {
  id: string;
  name: string;
  gym_code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  status: 'active' | 'suspended';
  active_members: number;
  staff_count: number;
  created_at: string;
}

/**
 * The platform operator's API client — every gym on the platform, not one gym.
 *
 * Kept apart from GymService because the two answer to different guards on the
 * server (platformAdminOnly vs gymStaffOnly) and nothing here is scoped by a
 * gym id the caller is staff of.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);

  gyms(): Promise<PlatformGym[]> {
    return firstValueFrom(
      this.http.get<{ data: PlatformGym[] }>('/api/gym/admin/gyms'),
    ).then((r) => r.data);
  }

  /** Idempotent: sends the state the gym should be in, not a verb. */
  setStatus(gymId: string, status: 'active' | 'suspended'): Promise<PlatformGym> {
    return firstValueFrom(
      this.http.patch<{ data: PlatformGym }>(`/api/gym/admin/gyms/${gymId}/status`, { status }),
    ).then((r) => r.data);
  }
}
