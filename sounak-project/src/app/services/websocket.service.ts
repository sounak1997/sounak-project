import { Injectable, OnDestroy, inject, signal, computed } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  timestamp: string;
  type: 'message' | 'system';
}

export interface ChatRoom {
  id: string;
  name: string;
  description: string;
}

export interface OnlineUser {
  userId: string;
  username: string;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private socket: Socket | null = null;
  private authService = inject(AuthService);
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Signals (all reactive state lives here) ──────────────────────────────
  readonly connected       = signal(false);
  readonly connecting      = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly currentRoom     = signal<string | null>(null);
  readonly messages        = signal<ChatMessage[]>([]);
  readonly onlineUsers     = signal<OnlineUser[]>([]);
  readonly rooms           = signal<ChatRoom[]>([]);
  readonly typingUsers     = signal<string[]>([]);

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly onlineCount  = computed(() => this.onlineUsers().length);
  readonly isTyping     = computed(() => this.typingUsers().length > 0);
  readonly typingLabel  = computed(() => {
    const users = this.typingUsers();
    if (users.length === 0) return '';
    if (users.length === 1) return `${users[0]} is typing…`;
    if (users.length === 2) return `${users[0]} and ${users[1]} are typing…`;
    return 'Several people are typing…';
  });

  // ── Connect ───────────────────────────────────────────────────────────────
  connect(): void {
    if (this.socket?.connected) return;
    this.connecting.set(true);

    this.socket = io('http://localhost:3000', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      this.connected.set(true);
      this.connecting.set(false);
      this.connectionError.set(null);
    });

    this.socket.on('disconnect', () => {
      this.connected.set(false);
    });

    this.socket.on('connect_error', (err) => {
      this.connecting.set(false);
      this.connectionError.set(`Cannot reach server: ${err.message}`);
    });

    this.socket.on('room-list', (rooms: ChatRoom[]) => {
      this.rooms.set(rooms);
    });

    // Full history arrives when joining a room
    this.socket.on('message-history', (history: ChatMessage[]) => {
      this.messages.set(history);
    });

    // Individual real-time message
    this.socket.on('message', (msg: ChatMessage) => {
      this.messages.update(prev => [...prev, msg]);
    });

    this.socket.on('online-users', (users: OnlineUser[]) => {
      this.onlineUsers.set(users);
    });

    this.socket.on('typing', ({ username }: { username: string }) => {
      this.typingUsers.update(list =>
        list.includes(username) ? list : [...list, username]
      );
    });

    this.socket.on('stop-typing', ({ username }: { username: string }) => {
      this.typingUsers.update(list => list.filter(u => u !== username));
    });
  }

  // ── Join room ─────────────────────────────────────────────────────────────
  joinRoom(roomId: string): void {
    const user = this.authService.currentUserValue;
    if (!user || !this.socket) return;

    this.currentRoom.set(roomId);
    this.messages.set([]);        // clear old messages before history arrives
    this.typingUsers.set([]);
    this.onlineUsers.set([]);

    this.socket.emit('join-room', {
      roomId,
      userId: user._id,
      username: user.name,
    });
  }

  // ── Send message ──────────────────────────────────────────────────────────
  sendMessage(content: string): void {
    const user = this.authService.currentUserValue;
    const roomId = this.currentRoom();
    if (!user || !roomId || !content.trim() || !this.socket) return;

    this.socket.emit('send-message', {
      roomId,
      content: content.trim(),
      userId: user._id,
      username: user.name,
    });
  }

  // ── Typing with auto-stop after 2s of inactivity ──────────────────────────
  emitTyping(): void {
    const user = this.authService.currentUserValue;
    const roomId = this.currentRoom();
    if (!user || !roomId || !this.socket) return;

    this.socket.emit('typing', { roomId, username: user.name });

    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.emitStopTyping(), 2000);
  }

  emitStopTyping(): void {
    const user = this.authService.currentUserValue;
    const roomId = this.currentRoom();
    if (!user || !roomId || !this.socket) return;
    this.socket.emit('stop-typing', { roomId, username: user.name });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  disconnect(): void {
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
    this.messages.set([]);
    this.onlineUsers.set([]);
    this.typingUsers.set([]);
    this.currentRoom.set(null);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
