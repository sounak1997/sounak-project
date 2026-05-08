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

// All registered users with live online status
export interface AllUser {
  userId: string;
  username: string;
  email: string;
  online: boolean;
}

// An active DM conversation
export interface DmRoom {
  roomId: string;
  partnerId: string;
  partnerUsername: string;
  hasUnread: boolean;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private socket: Socket | null = null;
  private authService = inject(AuthService);
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Signals ───────────────────────────────────────────────────────────────
  readonly connected       = signal(false);
  readonly connecting      = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly currentRoom     = signal<string | null>(null);
  readonly messages        = signal<ChatMessage[]>([]);
  readonly onlineUsers     = signal<OnlineUser[]>([]);   // users in current room
  readonly rooms           = signal<ChatRoom[]>([]);
  readonly typingUsers     = signal<string[]>([]);
  readonly allUsers        = signal<AllUser[]>([]);       // all registered users
  readonly dmRooms         = signal<DmRoom[]>([]);        // active DM conversations

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly onlineCount = computed(() => this.onlineUsers().length);
  readonly isTyping    = computed(() => this.typingUsers().length > 0);
  readonly typingLabel = computed(() => {
    const u = this.typingUsers();
    if (u.length === 0) return '';
    if (u.length === 1) return `${u[0]} is typing…`;
    if (u.length === 2) return `${u[0]} and ${u[1]} are typing…`;
    return 'Several people are typing…';
  });

  // Other users only (exclude self from People list)
  readonly otherUsers = computed(() => {
    const myId = this.authService.currentUserValue?._id;
    return this.allUsers().filter(u => u.userId !== myId);
  });

  readonly onlinePeopleCount = computed(() =>
    this.allUsers().filter(u => u.online).length
  );

  readonly isDMRoom = computed(() =>
    this.currentRoom()?.startsWith('dm_') ?? false
  );

  // ── Connect ───────────────────────────────────────────────────────────────
  connect(): void {
    if (this.socket?.connected) return;
    this.connecting.set(true);

    const serverUrl = typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000';

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      this.connected.set(true);
      this.connecting.set(false);
      this.connectionError.set(null);
      // Request full user list so People tab populates immediately
      this.socket!.emit('get-all-users');
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

    this.socket.on('message-history', (history: ChatMessage[]) => {
      this.messages.set(history);
    });

    this.socket.on('message', (msg: ChatMessage) => {
      this.messages.update(prev => [...prev, msg]);
    });

    this.socket.on('online-users', (users: OnlineUser[]) => {
      this.onlineUsers.set(users);
    });

    // Full user list on first load
    this.socket.on('all-users', (users: AllUser[]) => {
      this.allUsers.set(users);
    });

    // Incremental update when any user connects/disconnects
    this.socket.on('all-users-update', (users: AllUser[]) => {
      this.allUsers.set(users);
    });

    // Confirmation after joining a DM room
    this.socket.on('dm-joined', ({ roomId, targetUserId, targetUsername }: {
      roomId: string; targetUserId: string; targetUsername: string;
    }) => {
      this.dmRooms.update(rooms => {
        const exists = rooms.some(r => r.roomId === roomId);
        if (exists) return rooms;
        return [...rooms, { roomId, partnerId: targetUserId, partnerUsername: targetUsername, hasUnread: false }];
      });
    });

    // Someone else opened a DM with the current user
    this.socket.on('dm-invite', ({ roomId, fromUserId, fromUsername }: {
      roomId: string; fromUserId: string; fromUsername: string;
    }) => {
      this.dmRooms.update(rooms => {
        const exists = rooms.some(r => r.roomId === roomId);
        if (exists) return rooms;
        return [...rooms, { roomId, partnerId: fromUserId, partnerUsername: fromUsername, hasUnread: true }];
      });
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

  // ── Join channel room ─────────────────────────────────────────────────────
  joinRoom(roomId: string): void {
    const user = this.authService.currentUserValue;
    if (!user || !this.socket) return;

    this.currentRoom.set(roomId);
    this.messages.set([]);
    this.typingUsers.set([]);
    this.onlineUsers.set([]);

    this.socket.emit('join-room', { roomId, userId: user._id, username: user.name });
  }

  // ── Start / join a Direct Message conversation ────────────────────────────
  startDM(targetUserId: string, targetUsername: string): void {
    const user = this.authService.currentUserValue;
    if (!user || !this.socket) return;

    // Optimistically add DM room so sidebar updates immediately
    const roomId = this.getDMRoomId(user._id, targetUserId);
    this.currentRoom.set(roomId);
    this.messages.set([]);
    this.typingUsers.set([]);
    this.onlineUsers.set([]);

    this.socket.emit('join-dm', {
      targetUserId,
      targetUsername,
      myUserId: user._id,
      myUsername: user.name,
    });
  }

  // ── Send message ──────────────────────────────────────────────────────────
  sendMessage(content: string): void {
    const user = this.authService.currentUserValue;
    const roomId = this.currentRoom();
    if (!user || !roomId || !content.trim() || !this.socket) return;

    this.socket.emit('send-message', {
      roomId, content: content.trim(),
      userId: user._id, username: user.name,
    });
  }

  // ── Typing ────────────────────────────────────────────────────────────────
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

  // ── Get label for a room (channel name or DM partner name) ───────────────
  getRoomLabel(roomId: string): string {
    if (!roomId.startsWith('dm_')) {
      return roomId;
    }
    const dm = this.dmRooms().find(r => r.roomId === roomId);
    return dm ? dm.partnerUsername : 'Direct Message';
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
    this.allUsers.set([]);
    this.dmRooms.set([]);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private getDMRoomId(uid1: string, uid2: string): string {
    return `dm_${[uid1, uid2].sort().join('_')}`;
  }
}
