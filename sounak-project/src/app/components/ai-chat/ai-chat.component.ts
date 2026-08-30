import {
  Component, signal, computed, inject, OnInit,
  ChangeDetectionStrategy, viewChild, ElementRef, AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';

import { AiService, AskSource, DocumentInfo } from '../../services/ai.service';

type Mode = 'chat' | 'ask';

interface Bubble {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  error?: boolean;
  mode?: Mode;
  usage?: { input: number; output: number; thinking: number };
  sources?: AskSource[];
}

@Component({
  selector: 'app-ai-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatButtonToggleModule,
    MatProgressSpinnerModule, MatTooltipModule, MatDividerModule, MatBadgeModule,
  ],
  templateUrl: './ai-chat.component.html',
  styleUrl: './ai-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiChatComponent implements OnInit, AfterViewChecked {
  private ai = inject(AiService);

  readonly feedEl = viewChild<ElementRef>('feed');

  readonly mode = signal<Mode>('chat');
  readonly inputText = signal('');
  readonly loading = signal(false);
  readonly bubbles = signal<Bubble[]>([]);
  private shouldScroll = false;

  // --- Document library (RAG sources) ---
  readonly documents = signal<DocumentInfo[]>([]);
  readonly docsLoading = signal(false);
  readonly uploading = signal(false);
  readonly docError = signal<string | null>(null);
  readonly showDocs = signal(false);

  readonly hasMessages = computed(() => this.bubbles().length > 0);
  readonly totalChunks = computed(() =>
    this.documents().reduce((sum, d) => sum + d.chunk_count, 0)
  );

  readonly placeholder = computed(() =>
    this.mode() === 'chat'
      ? 'Ask anything… (general knowledge, streamed live)'
      : 'Ask a question about your ingested documents…'
  );

  ngOnInit(): void {
    this.loadDocuments();
  }

  /**
   * Turns an HTTP failure into something a person can act on. A 401 means the
   * JWT expired (they last 1h), which otherwise surfaces as an opaque generic
   * message, so it gets called out explicitly.
   */
  private errorMessage(err: any, fallback: string): string {
    if (err?.status === 401) return 'Your session expired. Please log out and log in again.';
    if (err?.status === 413) return 'That file is too large (max 10MB).';
    if (err?.status === 0) return 'Cannot reach the server. Is the backend running?';
    return err?.error?.detail || err?.error?.message || fallback;
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
  }

  toggleDocs(): void {
    this.showDocs.update((v) => !v);
    if (this.showDocs()) this.loadDocuments();
  }

  loadDocuments(): void {
    this.docsLoading.set(true);
    this.docError.set(null);
    this.ai.listDocuments().subscribe({
      next: (res) => {
        this.documents.set(res.data.documents);
        this.docsLoading.set(false);
      },
      error: (err) => {
        this.docError.set(this.errorMessage(err, 'Could not load your documents.'));
        this.docsLoading.set(false);
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading.set(true);
    this.docError.set(null);

    this.ai.uploadDocument(file).subscribe({
      next: (res) => {
        this.uploading.set(false);
        input.value = ''; // let the same file be re-selected later
        this.loadDocuments();
        this.bubbles.update((b) => [
          ...b,
          {
            role: 'assistant',
            text: `Added "${res.data.source}" (${res.data.chunks_indexed} chunk${res.data.chunks_indexed === 1 ? '' : 's'}). Switch to "Search my docs" to ask about it.`,
            mode: 'ask',
          },
        ]);
        this.shouldScroll = true;
      },
      error: (err) => {
        this.uploading.set(false);
        input.value = '';
        this.docError.set(this.errorMessage(err, 'Upload failed.'));
      },
    });
  }

  removeDocument(source: string): void {
    this.docError.set(null);
    this.ai.deleteDocument(source).subscribe({
      next: () => this.loadDocuments(),
      error: (err) => this.docError.set(this.errorMessage(err, 'Could not remove that document.')),
    });
  }

  send(): void {
    const text = this.inputText().trim();
    if (!text || this.loading()) return;
    this.inputText.set('');

    this.bubbles.update((b) => [...b, { role: 'user', text }]);
    this.shouldScroll = true;

    if (this.mode() === 'chat') {
      this.sendChat(text);
    } else {
      this.sendAsk(text);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  clear(): void {
    this.bubbles.set([]);
  }

  private sendChat(message: string): void {
    this.loading.set(true);
    const index = this.bubbles().length;
    this.bubbles.update((b) => [...b, { role: 'assistant', text: '', streaming: true, mode: 'chat' }]);

    this.ai.streamChat(
      message,
      (delta) => {
        this.bubbles.update((b) =>
          b.map((bub, i) => (i === index ? { ...bub, text: bub.text + delta } : bub))
        );
        this.shouldScroll = true;
      },
      (usage) => {
        this.bubbles.update((b) =>
          b.map((bub, i) =>
            i === index
              ? {
                  ...bub,
                  streaming: false,
                  usage: { input: usage.input_tokens, output: usage.output_tokens, thinking: usage.thinking_tokens },
                }
              : bub
          )
        );
        this.loading.set(false);
        this.shouldScroll = true;
      },
      (err) => {
        this.bubbles.update((b) =>
          b.map((bub, i) => (i === index ? { ...bub, streaming: false, error: true, text: err } : bub))
        );
        this.loading.set(false);
      }
    );
  }

  private sendAsk(question: string): void {
    this.loading.set(true);
    const index = this.bubbles().length;
    this.bubbles.update((b) => [...b, { role: 'assistant', text: '', streaming: true, mode: 'ask' }]);

    this.ai.ask(question).subscribe({
      next: (res) => {
        const data = res.data;
        this.bubbles.update((b) =>
          b.map((bub, i) =>
            i === index
              ? {
                  ...bub,
                  text: data.answer,
                  streaming: false,
                  usage: { input: data.input_tokens, output: data.output_tokens, thinking: data.thinking_tokens },
                  sources: data.sources,
                }
              : bub
          )
        );
        this.loading.set(false);
        this.shouldScroll = true;
      },
      error: (err) => {
        const message = this.errorMessage(err, 'Something went wrong.');
        this.bubbles.update((b) =>
          b.map((bub, i) => (i === index ? { ...bub, streaming: false, error: true, text: message } : bub))
        );
        this.loading.set(false);
      },
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      const el = this.feedEl();
      if (el) el.nativeElement.scrollTop = el.nativeElement.scrollHeight;
      this.shouldScroll = false;
    }
  }
}
