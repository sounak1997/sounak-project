// src/app/services/ai.service.ts
//
// Talks to the backend's AI routes (/api/ai/...), which proxy to the Python
// FastAPI + Gemini microservice. Two request styles are used on purpose:
//
//   - chat() / ask() go through Angular's HttpClient, so the JwtInterceptor
//     attaches the Authorization header automatically (same as every other
//     service in this app).
//   - streamChat() opens the SSE endpoint with the native fetch() API instead.
//     HttpClient's older XHR-based streaming support is awkward for
//     line-by-line SSE parsing, and fetch() gives us a raw ReadableStream to
//     read as bytes arrive — the same approach the Node backend itself uses
//     when piping this same stream through. Because fetch() bypasses Angular's
//     interceptor, we attach the auth header manually here.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environment/environment';

export interface ChatResult {
  reply: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  stop_reason: string | null;
}

export interface AskSource {
  source: string;
  chunk_index: number;
  score: number;
  preview: string;
}

export interface AskResult {
  answer: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  sources: AskSource[];
}

export interface StreamUsage {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
}

export interface DocumentInfo {
  source: string;
  chunk_count: number;
}

export interface UploadResult {
  source: string;
  chunks_indexed: number;
}

export interface DeleteResult {
  source: string;
  chunks_removed: number;
}

// --- Agent (tool calling) ---

/** One past turn, replayed to the service so the model has conversation context. */
export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Something for the BROWSER to do — run by UiActionService, not by the server. */
export interface AgentAction {
  type: string;
  params: Record<string, any>;
}

/** A write the model proposed. Nothing happens until the user clicks Confirm. */
export interface PendingAction {
  tool: string;
  args: Record<string, any>;
  label: string;
  summary: string;
}

/** One tool invocation, shown in the collapsible trace so a run is inspectable. */
export interface ToolTrace {
  tool: string;
  kind: string;
  args: Record<string, any>;
  ok: boolean;
  detail: string;
}

export interface AgentResult {
  reply: string;
  actions: AgentAction[];
  pending: PendingAction[];
  trace: ToolTrace[];
  iterations: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
}

export interface ConfirmResult {
  reply: string;
  ok: boolean;
  actions: AgentAction[];
  trace: ToolTrace[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private backendUrl = '/api/ai';

  /** Plain, ungrounded chat — one request, one reply. */
  chat(message: string, system?: string): Observable<ApiEnvelope<ChatResult>> {
    return this.http.post<ApiEnvelope<ChatResult>>(`${this.backendUrl}/chat`, { message, system });
  }

  /** RAG — answers grounded in the documents ingested by the Python service. */
  ask(question: string, k?: number): Observable<ApiEnvelope<AskResult>> {
    return this.http.post<ApiEnvelope<AskResult>>(`${this.backendUrl}/ask`, { question, k });
  }

  /**
   * The in-app assistant: it can look up live data through the backend API and
   * ask the browser to navigate or highlight something.
   *
   * History is sent from the client every turn — the service keeps no session.
   * We cap it here as well as on the server, because replaying a long chat is
   * what makes token cost creep up unnoticed.
   */
  agent(message: string, history: AgentTurn[] = []): Observable<ApiEnvelope<AgentResult>> {
    return this.http.post<ApiEnvelope<AgentResult>>(`${this.backendUrl}/agent`, {
      message,
      history: history.slice(-20),
    });
  }

  /** Execute a write the user approved in the confirmation card. */
  confirmAction(tool: string, args: Record<string, any>): Observable<ApiEnvelope<ConfirmResult>> {
    return this.http.post<ApiEnvelope<ConfirmResult>>(`${this.backendUrl}/agent/confirm`, {
      tool,
      args,
    });
  }

  /** List the documents currently indexed for RAG. */
  listDocuments(): Observable<ApiEnvelope<{ documents: DocumentInfo[] }>> {
    return this.http.get<ApiEnvelope<{ documents: DocumentInfo[] }>>(
      `${this.backendUrl}/documents`
    );
  }

  /**
   * Upload a document so it can be searched in "Search my docs" mode.
   * Sent as multipart/form-data — we deliberately do NOT set a Content-Type
   * header, so the browser adds it along with the required multipart boundary.
   */
  uploadDocument(file: File): Observable<ApiEnvelope<UploadResult>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ApiEnvelope<UploadResult>>(`${this.backendUrl}/documents`, form);
  }

  /** Remove a document from the RAG index. */
  deleteDocument(source: string): Observable<ApiEnvelope<DeleteResult>> {
    return this.http.delete<ApiEnvelope<DeleteResult>>(
      `${this.backendUrl}/documents/${encodeURIComponent(source)}`
    );
  }

  /**
   * Streams a chat reply as Server-Sent Events, calling back as pieces arrive.
   * Resolves once the stream ends (either via onDone or onError having fired).
   */
  async streamChat(
    message: string,
    onDelta: (text: string) => void,
    onDone: (usage: StreamUsage) => void,
    onError: (message: string) => void,
    system?: string,
  ): Promise<void> {
    const token = this.authService.getToken();

    let response: Response;
    try {
      response = await fetch(`${environment.apiUrl}${this.backendUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, system }),
      });
    } catch (err: any) {
      onError(`Could not reach the server: ${err?.message ?? err}`);
      return;
    }

    if (!response.ok || !response.body) {
      // Passport replies to an expired/invalid JWT with plain text, not JSON,
      // so check the status before trying to read a message out of the body.
      // This request goes through fetch(), so it bypasses AuthErrorInterceptor —
      // we have to end the dead session here ourselves.
      if (response.status === 401) {
        onError('Your session expired. Redirecting you to log in again…');
        this.authService.logout();
        return;
      }
      const data = await response.json().catch(() => ({} as any));
      onError(data.detail || data.message || `Request failed (${response.status})`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line ("\n\n").
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;

        try {
          const event = JSON.parse(json);
          if (event.error) {
            onError(event.error);
          } else if (event.done) {
            onDone({
              input_tokens: event.input_tokens ?? 0,
              output_tokens: event.output_tokens ?? 0,
              thinking_tokens: event.thinking_tokens ?? 0,
            });
          } else if (event.delta) {
            onDelta(event.delta);
          }
        } catch {
          // Malformed frame — skip it rather than breaking the whole stream.
        }
      }
    }
  }
}
