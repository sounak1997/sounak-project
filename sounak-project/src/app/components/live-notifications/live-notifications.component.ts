import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  effect,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, Subject, fromEvent, map, shareReplay, takeUntil } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { environment } from '../../../environment/environment';

export interface NotificationEvent {
  type: 'CONNECTED' | 'USER_REGISTERED' | 'NOTIFICATION';
  message: string;
  timestamp: string;
  clientId?: string;
}

@Component({
  selector: 'app-live-notifications',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatBadgeModule,
    MatDividerModule,
  ],
  templateUrl: './live-notifications.component.html',
  styleUrl: './live-notifications.component.scss',
})
export class LiveNotificationsComponent implements OnInit, OnDestroy {
  private eventSource: EventSource | null = null;
  private readonly destroy$ = new Subject<void>();

  // --- Connection state signals ---
  readonly connected = signal(false);
  readonly connectionError = signal<string | null>(null);

  // --- Notifications stored as a signal ---
  readonly notifications = signal<NotificationEvent[]>([]);
  readonly unreadCount = signal(0);
  readonly isPaused = signal(false);

  // --- Computed signals ---
  readonly hasNotifications = computed(() => this.notifications().length > 0);
  readonly connectionStatus = computed(() =>
    this.connected() ? '🟢 Connected' : this.connectionError() ? '🔴 Error' : '🟡 Connecting...'
  );
  readonly userRegistrationEvents = computed(() =>
    this.notifications().filter((n) => n.type === 'USER_REGISTERED')
  );
  readonly generalNotifications = computed(() =>
    this.notifications().filter((n) => n.type === 'NOTIFICATION')
  );
  readonly latestEvent = computed(() => this.notifications().at(-1) ?? null);

  // environment.apiUrl is '' in dev (proxied) or 'http://host:port/api' in prod
  private readonly SSE_URL = `${environment.apiUrl}/api/notifications/stream`;

  constructor() {
    // Effect: log every new notification to console
    effect(() => {
      const latest = this.latestEvent();
      if (latest && latest.type !== 'CONNECTED') {
        console.log('[SSE Notification]', latest);
      }
    });
  }

  ngOnInit(): void {
    this.connectToStream();
  }

  ngOnDestroy(): void {
    this.disconnectStream();
    this.destroy$.next();
    this.destroy$.complete();
  }

  connectToStream(): void {
    this.disconnectStream();
    this.connectionError.set(null);
    this.connected.set(false);

    try {
      this.eventSource = new EventSource(this.SSE_URL);

      this.eventSource.onopen = () => {
        this.connected.set(true);
        this.connectionError.set(null);
        console.log('[SSE] Stream opened');
      };

      this.eventSource.onmessage = (event) => {
        if (this.isPaused()) return;
        try {
          const data: NotificationEvent = JSON.parse(event.data);
          this.notifications.update((list) => [data, ...list].slice(0, 50)); // keep last 50
          if (data.type !== 'CONNECTED') {
            this.unreadCount.update((n) => n + 1);
          }
        } catch {
          console.warn('[SSE] Failed to parse event:', event.data);
        }
      };

      this.eventSource.onerror = () => {
        this.connected.set(false);
        this.connectionError.set('Connection lost — will reconnect automatically');
        console.warn('[SSE] Connection error');
      };
    } catch (err) {
      this.connectionError.set('Failed to open SSE stream');
    }
  }

  disconnectStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.connected.set(false);
    }
  }

  togglePause(): void {
    this.isPaused.update((p) => !p);
  }

  clearAll(): void {
    this.notifications.set([]);
    this.unreadCount.set(0);
  }

  markAllRead(): void {
    this.unreadCount.set(0);
  }

  reconnect(): void {
    this.connectToStream();
  }

  getIcon(type: string): string {
    const icons: Record<string, string> = {
      CONNECTED: 'wifi',
      USER_REGISTERED: 'person_add',
      NOTIFICATION: 'notifications',
    };
    return icons[type] ?? 'info';
  }

  getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      CONNECTED: '#059669',
      USER_REGISTERED: '#7c3aed',
      NOTIFICATION: '#0284c7',
    };
    return colors[type] ?? '#64748b';
  }

  trackByTimestamp(_: number, item: NotificationEvent): string {
    return item.timestamp;
  }
}
