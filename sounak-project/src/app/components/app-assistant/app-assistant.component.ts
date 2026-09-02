// src/app/components/app-assistant/app-assistant.component.ts
//
// The assistant that can actually DO things.
//
// The existing /ai screen talks to the model and shows you what it said. This
// one closes the loop: the model picks tools, the server runs the read-only
// ones against the live API, and the browser runs the UI ones through
// UiActionService. So "how many members are there?" returns a real number, and
// "how do I add one?" walks you to the screen and points at the button.
//
// Two things are deliberately visible in this UI rather than hidden:
//   - the TOOL TRACE, so when an answer looks wrong you can see which tool ran
//     with which arguments instead of guessing at the prompt;
//   - the CONFIRM CARD, because nothing that writes data should ever happen
//     just because a language model thought it was a good idea.
import {
  Component, signal, computed, inject,
  ChangeDetectionStrategy, viewChild, ElementRef, AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';

import {
  AiService, AgentTurn, PendingAction, ToolTrace,
} from '../../services/ai.service';
import { UiActionService } from '../../services/ui-action.service';

interface Bubble {
  role: 'user' | 'assistant';
  text: string;
  working?: boolean;
  error?: boolean;
  actionLog?: string[];
  trace?: ToolTrace[];
  showTrace?: boolean;
  pending?: PendingAction[];
  pendingDone?: string | null;   // set once confirmed/dismissed
  confirming?: boolean;
  usage?: { input: number; output: number; thinking: number; iterations: number };
}

@Component({
  selector: 'app-app-assistant',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatTooltipModule, MatChipsModule,
  ],
  templateUrl: './app-assistant.component.html',
  styleUrl: './app-assistant.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppAssistantComponent implements AfterViewChecked {
  private ai = inject(AiService);
  private uiActions = inject(UiActionService);

  readonly feedEl = viewChild<ElementRef>('feed');

  readonly bubbles = signal<Bubble[]>([]);
  readonly inputText = signal('');
  readonly loading = signal(false);
  private shouldScroll = false;

  readonly hasMessages = computed(() => this.bubbles().length > 0);

  /** Each one exercises a different tool kind — data, UI, guidance, write. */
  readonly suggestions = [
    'How many members are there?',
    'Show me the products',
    'How do I add a new member?',
    'Take me to live notifications',
  ];

  // ---------------------------------------------------------------- sending

  useSuggestion(text: string): void {
    this.inputText.set(text);
    this.send();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  clear(): void {
    this.bubbles.set([]);
    this.uiActions.clearHighlight();
  }

  send(): void {
    const text = this.inputText().trim();
    if (!text || this.loading()) return;
    this.inputText.set('');

    // Snapshot the history BEFORE adding this turn — the message is sent
    // separately, and including it twice makes the model answer itself.
    const history = this.buildHistory();

    this.bubbles.update((b) => [...b, { role: 'user', text }]);
    const index = this.bubbles().length;
    this.bubbles.update((b) => [...b, { role: 'assistant', text: '', working: true }]);
    this.loading.set(true);
    this.shouldScroll = true;

    this.ai.agent(text, history).subscribe({
      next: (res) => {
        const data = res.data;
        this.patch(index, {
          text: data.reply,
          working: false,
          trace: data.trace,
          pending: data.pending,
          pendingDone: null,
          usage: {
            input: data.input_tokens,
            output: data.output_tokens,
            thinking: data.thinking_tokens,
            iterations: data.iterations,
          },
        });
        this.loading.set(false);
        this.shouldScroll = true;

        // Now let the browser carry out whatever the model asked for.
        this.uiActions.run(data.actions).then((log) => {
          if (log.length) this.patch(index, { actionLog: log });
          this.shouldScroll = true;
        });
      },
      error: (err) => {
        this.patch(index, {
          text: this.errorMessage(err, 'The assistant could not answer that.'),
          working: false,
          error: true,
        });
        this.loading.set(false);
        this.shouldScroll = true;
      },
    });
  }

  /**
   * Replay only clean turns. Errors and placeholders would teach the model that
   * "Cannot reach the server" is something it once said, which it then imitates.
   */
  private buildHistory(): AgentTurn[] {
    return this.bubbles()
      .filter((b) => !b.error && !b.working && b.text.trim())
      .map((b) => ({ role: b.role, text: b.text }));
  }

  // ------------------------------------------------------------ confirming

  confirm(index: number, action: PendingAction): void {
    const bubble = this.bubbles()[index];
    if (!bubble || bubble.confirming || bubble.pendingDone) return;

    this.patch(index, { confirming: true });

    this.ai.confirmAction(action.tool, action.args).subscribe({
      next: (res) => {
        const data = res.data;
        this.patch(index, {
          confirming: false,
          pendingDone: data.ok ? 'done' : 'failed',
        });
        this.bubbles.update((b) => [
          ...b,
          {
            role: 'assistant',
            text: data.reply,
            error: !data.ok,
            trace: data.trace,
          },
        ]);
        this.shouldScroll = true;
        if (data.ok) this.uiActions.run(data.actions);
      },
      error: (err) => {
        this.patch(index, { confirming: false, pendingDone: 'failed' });
        this.bubbles.update((b) => [
          ...b,
          {
            role: 'assistant',
            text: this.errorMessage(err, 'That action failed.'),
            error: true,
          },
        ]);
        this.shouldScroll = true;
      },
    });
  }

  dismiss(index: number): void {
    this.patch(index, { pendingDone: 'dismissed' });
    this.bubbles.update((b) => [
      ...b,
      { role: 'assistant', text: 'Okay — I left everything as it was.' },
    ]);
    this.shouldScroll = true;
  }

  toggleTrace(index: number): void {
    const bubble = this.bubbles()[index];
    if (bubble) this.patch(index, { showTrace: !bubble.showTrace });
  }

  /** Hide the password the user typed — it has no business in a debug panel. */
  traceArgs(trace: ToolTrace): string {
    const safe: Record<string, any> = {};
    for (const [key, value] of Object.entries(trace.args ?? {})) {
      safe[key] = key.toLowerCase().includes('password') ? '••••••' : value;
    }
    return Object.keys(safe).length ? JSON.stringify(safe) : '{}';
  }

  toolIcon(kind: string): string {
    if (kind === 'client') return 'ads_click';
    if (kind === 'confirm') return 'gpp_maybe';
    return 'cloud_download';
  }

  // ---------------------------------------------------------------- helpers

  private patch(index: number, changes: Partial<Bubble>): void {
    this.bubbles.update((b) => b.map((bub, i) => (i === index ? { ...bub, ...changes } : bub)));
  }

  private errorMessage(err: any, fallback: string): string {
    if (err?.status === 401) return 'Your session expired. Please log in again.';
    if (err?.status === 0) return 'Cannot reach the server. Is the backend running?';
    if (err?.status === 502) return 'The AI service is unreachable. Is it running on port 8000?';
    if (err?.status === 503) return 'The AI service has no Gemini API key configured.';
    if (err?.status === 504) return 'The assistant took too long and timed out.';
    // The service already rewrites Google's quota boilerplate into one
    // actionable sentence; prefer it, but never fall back to the raw text.
    if (err?.status === 429) {
      return err?.error?.detail
        ?? 'Rate limit reached on the free tier — give it a minute and try again.';
    }
    return err?.error?.detail || err?.error?.message || fallback;
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      const el = this.feedEl();
      if (el) el.nativeElement.scrollTop = el.nativeElement.scrollHeight;
      this.shouldScroll = false;
    }
  }
}
