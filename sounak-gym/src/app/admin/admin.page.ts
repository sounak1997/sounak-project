import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { AdminService, PlatformGym } from '../core/admin.service';

/**
 * The platform operator's screen: every gym on the platform, and the switch
 * that stops one.
 *
 * Suspending is the whole reason this page exists — a gym that stops doing
 * business with us has to stop working, and there was previously no way to do
 * that short of editing the database by hand.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin.page.html',
  styleUrl: './admin.page.scss',
})
export class AdminPage {
  private api = inject(AdminService);
  readonly auth = inject(AuthService);

  readonly gyms = signal<PlatformGym[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');

  /** The gym awaiting confirmation. Suspending is disruptive, so it is never one tap. */
  readonly confirming = signal<PlatformGym | null>(null);
  /** Id of the gym whose status call is in flight, so only its own button spins. */
  readonly saving = signal<string | null>(null);

  readonly activeCount = computed(() => this.gyms().filter((g) => g.status === 'active').length);
  readonly suspendedCount = computed(() => this.gyms().length - this.activeCount());

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.gyms.set(await this.api.gyms());
    } catch (err) {
      this.error.set(this.message(err, 'Could not load the gym list.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Reactivating is harmless, so it applies straight away; suspending asks first. */
  toggle(gym: PlatformGym): void {
    this.notice.set('');
    if (gym.status === 'active') this.confirming.set(gym);
    else void this.apply(gym, 'active');
  }

  async confirmSuspend(): Promise<void> {
    const gym = this.confirming();
    if (gym) await this.apply(gym, 'suspended');
  }

  private async apply(gym: PlatformGym, status: 'active' | 'suspended'): Promise<void> {
    this.saving.set(gym.id);
    this.error.set('');
    try {
      const updated = await this.api.setStatus(gym.id, status);
      // Patch the one row rather than refetching: the list is the admin's place
      // in the page, and a reload would lose their scroll position.
      this.gyms.update((list) => list.map((g) => (g.id === gym.id ? { ...g, ...updated } : g)));
      this.notice.set(
        status === 'suspended'
          ? `${gym.name} is suspended. Its door QR and console are now closed.`
          : `${gym.name} is active again.`,
      );
      this.confirming.set(null);
    } catch (err) {
      this.error.set(this.message(err, `Could not update ${gym.name}.`));
    } finally {
      this.saving.set(null);
    }
  }

  private message(err: unknown, fallback: string): string {
    return err instanceof HttpErrorResponse && err.error?.message ? err.error.message : fallback;
  }
}
