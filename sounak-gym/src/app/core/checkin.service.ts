import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface CheckinSummary {
  attendedDays: number;
  openDays: number;
  percentage: number | null;
  periodStart: string;
  periodEnd: string;
}

export interface CheckinState {
  gymName: string;
  recognised: boolean;
  member?: { id: string; fullName: string; memberCode: string; joinedOn: string };
  subscription?: {
    planName: string;
    startDate: string;
    endDate: string;
    isExpired: boolean;
    daysRemaining: number;
  } | null;
  today?: { visitDate: string; checkInAt: string; checkOutAt: string | null; method: string } | null;
  nextAction?: 'check_in' | 'check_out' | 'none';
  summary?: CheckinSummary | null;
}

export interface Candidate {
  id: string;
  fullName: string;
  phoneHint: string | null;
  claimable: boolean;
}

export type ScanOutcome =
  | 'checked_in'
  | 'checked_out'
  | 'duplicate_ignored'
  | 'already_complete'
  | 'no_subscription'
  | 'subscription_expired';

export interface ScanResult {
  outcome: ScanOutcome;
  gymName: string;
  member: { fullName: string };
  visit?: { visitDate: string; checkInAt: string; checkOutAt: string | null } | null;
  subscription?: { planName: string; endDate: string; daysRemaining?: number } | null;
  summary?: CheckinSummary | null;
  gymPhone?: string | null;
}

/**
 * The public door flow. No login anywhere in here.
 *
 * The device token is stored per gym code, because a member who trains at two
 * gyms on the platform holds one token for each, and the backend refuses a
 * token presented against the wrong gym.
 */
@Injectable({ providedIn: 'root' })
export class CheckinService {
  private http = inject(HttpClient);

  private key(gymCode: string): string {
    return `gymDeviceToken:${gymCode}`;
  }

  /** Wrapped: localStorage throws in private windows and when site data is blocked. */
  deviceToken(gymCode: string): string | null {
    try {
      return localStorage.getItem(this.key(gymCode));
    } catch {
      return null;
    }
  }

  private rememberDevice(gymCode: string, token: string): void {
    try {
      localStorage.setItem(this.key(gymCode), token);
    } catch {
      /* The member will be asked for their number again next time. */
    }
  }

  forgetDevice(gymCode: string): void {
    try {
      localStorage.removeItem(this.key(gymCode));
    } catch {
      /* nothing to do */
    }
  }

  /**
   * Called the moment the check-in page loads, which also serves as the wake-up
   * call for the backend.
   *
   * Render's free tier sleeps after 15 minutes and the first request then takes
   * 30-60 seconds. The member is standing at the door, so that wait must not
   * start when they press the button — firing this on load means the service is
   * usually already awake by the time they have read the screen and tapped. No
   * separate ping is needed: this request is the ping.
   */
  state(gymCode: string): Promise<CheckinState> {
    const token = this.deviceToken(gymCode);
    const params: Record<string, string> = { g: gymCode };
    if (token) params['deviceToken'] = token;
    return firstValueFrom(
      this.http.get<{ data: CheckinState }>('/api/gym/checkin/state', { params }),
    ).then((r) => r.data);
  }

  search(gymCode: string, query: string): Promise<{ matchedBy: 'phone' | 'name'; candidates: Candidate[] }> {
    return firstValueFrom(
      this.http.post<{ data: { matchedBy: 'phone' | 'name'; candidates: Candidate[] } }>(
        '/api/gym/checkin/search',
        { gymCode, query },
      ),
    ).then((r) => r.data);
  }

  /** Binds this phone to a member. `verify` is the last 4 digits of their mobile. */
  async claim(gymCode: string, memberId: string, verify: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ data: { deviceToken: string } }>('/api/gym/checkin/claim', {
        gymCode,
        memberId,
        verify,
      }),
    );
    this.rememberDevice(gymCode, res.data.deviceToken);
  }

  /**
   * Marks the visit. The server decides whether this is an arrival or a
   * departure — the client never says, so a reload or a double tap cannot
   * corrupt anything.
   *
   * `clientTime` is sent so a tap made while the backend is waking still
   * records the moment the member actually tapped.
   */
  scan(gymCode: string): Promise<ScanResult> {
    return firstValueFrom(
      this.http.post<{ data: ScanResult }>('/api/gym/checkin', {
        gymCode,
        deviceToken: this.deviceToken(gymCode),
        clientTime: new Date().toISOString(),
      }),
    ).then((r) => r.data);
  }
}
