import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface GymSummary {
  id: string;
  name: string;
  gym_code: string;
  timezone: string;
  status: string;
  staff_role: string;
}

export interface GymAccount {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  platformAdmin: boolean;
}

const TOKEN_KEY = 'gymStaffToken';
const GYM_KEY = 'gymStaffActiveGym';

/**
 * Owner/staff session for the gym console.
 *
 * Note this is NOT what the door check-in uses: members never sign in, and the
 * check-in screen holds a device token instead (see CheckinService). Two
 * separate credentials on purpose — the device token must never be able to
 * reach an owner's screens.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly account = signal<GymAccount | null>(null);
  readonly gyms = signal<GymSummary[]>([]);
  readonly activeGymId = signal<string | null>(this.read(GYM_KEY));
  readonly isSignedIn = computed(() => !!this.account());

  readonly activeGym = computed(
    () => this.gyms().find((g) => g.id === this.activeGymId()) ?? this.gyms()[0] ?? null,
  );

  /** Every read is wrapped: storage throws in a private window or when site data is blocked. */
  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* session simply will not persist across reloads */
    }
  }

  get token(): string | null {
    return this.read(TOKEN_KEY);
  }

  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ data: { token: string; account: GymAccount; gyms: GymSummary[] } }>(
        '/api/gym/auth/login',
        { email, password },
      ),
    );
    this.write(TOKEN_KEY, res.data.token);
    this.account.set(res.data.account);
    this.gyms.set(res.data.gyms);
    this.selectGym(res.data.gyms[0]?.id ?? null);
  }

  /**
   * Restores a session from the stored token on app start. Returns false when
   * there is no usable session, which is what the guard acts on.
   */
  async restore(): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { account: GymAccount; gyms: GymSummary[] } }>('/api/gym/auth/me'),
      );
      this.account.set(res.data.account);
      this.gyms.set(res.data.gyms);
      if (!this.activeGymId() && res.data.gyms.length) this.selectGym(res.data.gyms[0].id);
      return true;
    } catch {
      this.signOut(false);
      return false;
    }
  }

  /** An owner of two gyms switches between them; everything else keys off this. */
  selectGym(gymId: string | null): void {
    this.activeGymId.set(gymId);
    this.write(GYM_KEY, gymId);
  }

  signOut(redirect = true): void {
    this.write(TOKEN_KEY, null);
    this.write(GYM_KEY, null);
    this.account.set(null);
    this.gyms.set([]);
    this.activeGymId.set(null);
    if (redirect) this.router.navigate(['/login']);
  }
}
