import {
  Component, OnInit, OnDestroy, inject,
  signal, computed, effect, viewChild, ElementRef,
  AfterViewChecked, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DatePipe } from '@angular/common';

import { WebSocketService, ChatMessage } from '../../services/websocket.service';
import { AuthService } from '../../services/auth.service';

type SidebarTab = 'channels' | 'people';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatBadgeModule,
    MatTooltipModule, MatDividerModule, MatProgressSpinnerModule,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  readonly ws = inject(WebSocketService);
  private authService = inject(AuthService);

  readonly feedEl = viewChild<ElementRef>('messageFeed');

  readonly messageText = signal('');
  readonly sidebarOpen = signal(true);
  readonly sidebarTab  = signal<SidebarTab>('channels');
  private shouldScroll = false;

  readonly currentUserId   = computed(() => this.authService.currentUserValue?._id ?? '');
  readonly currentUsername = computed(() => this.authService.currentUserValue?.name ?? 'You');

  readonly allMessages = computed(() => this.ws.messages());

  readonly inputPlaceholder = computed(() => {
    const room = this.ws.currentRoom();
    if (!room) return 'Join a channel first';
    if (this.ws.isDMRoom()) {
      return `Message ${this.ws.getRoomLabel(room)}`;
    }
    return `Message #${room}`;
  });

  readonly roomTitle = computed(() => {
    const room = this.ws.currentRoom();
    if (!room) return 'Select a channel';
    if (this.ws.isDMRoom()) return this.ws.getRoomLabel(room);
    return '# ' + room;
  });

  constructor() {
    effect(() => {
      this.allMessages();
      this.shouldScroll = true;
    });

    effect(() => {
      if (this.ws.connected() && !this.ws.currentRoom()) {
        this.ws.joinRoom('general');
      }
    });
  }

  ngOnInit(): void {
    this.ws.connect();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    this.ws.disconnect();
  }

  joinRoom(roomId: string): void {
    if (this.ws.currentRoom() === roomId) return;
    this.ws.joinRoom(roomId);
    if (window.innerWidth < 768) this.sidebarOpen.set(false);
  }

  startDM(userId: string, username: string): void {
    this.ws.startDM(userId, username);
    this.sidebarTab.set('channels');
    if (window.innerWidth < 768) this.sidebarOpen.set(false);
  }

  openDMRoom(roomId: string): void {
    if (this.ws.currentRoom() === roomId) return;
    const dm = this.ws.dmRooms().find(r => r.roomId === roomId);
    if (dm) this.ws.startDM(dm.partnerId, dm.partnerUsername);
  }

  sendMessage(): void {
    const text = this.messageText().trim();
    if (!text) return;
    this.ws.sendMessage(text);
    this.messageText.set('');
    this.ws.emitStopTyping();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    } else {
      this.ws.emitTyping();
    }
  }

  isMine(msg: ChatMessage): boolean {
    return msg.userId === this.currentUserId();
  }

  trackByMsgId(_: number, msg: ChatMessage): string {
    return msg.id;
  }

  private scrollToBottom(): void {
    const el = this.feedEl();
    if (el) el.nativeElement.scrollTop = el.nativeElement.scrollHeight;
  }
}
