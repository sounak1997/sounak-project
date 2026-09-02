// src/app/services/ui-action.service.ts
//
// The browser half of tool calling.
//
// The Python agent never executes a "client" tool. It validates the arguments,
// tells the model "done", and ships the request back in the response as an
// action. This service is what actually performs it — navigating, scrolling to
// an element, drawing attention to it. From the model's point of view it
// clicked the button; from the app's point of view Angular did.
//
// Actions run in SEQUENCE, not in parallel: `navigate_to` then
// `highlight_element` only makes sense if the highlight waits for the new
// screen to finish rendering.
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { ReplaySubject } from 'rxjs';

export interface UiAction {
  type: string;
  params: Record<string, any>;
}

export interface PanelRequest {
  panel: string;
  /** Epoch ms, so a late subscriber can tell a fresh request from a replayed one. */
  at: number;
}

/** A replayed panel request older than this is ignored by subscribers. */
export const PANEL_REQUEST_TTL_MS = 5000;

/**
 * How long a highlight stays on screen before clearing itself.
 *
 * Generous on purpose: a four-step walkthrough is something the user has to
 * read and then act on, and a tour that vanishes while they're still on step
 * one is worse than no tour at all.
 */
const HIGHLIGHT_MS = 15000;

@Injectable({ providedIn: 'root' })
export class UiActionService {
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  /**
   * Panels aren't routes, so they can't be opened by navigating. Components
   * that own one (e.g. the document library on /ai) subscribe here and open
   * themselves when their name comes through.
   *
   * ReplaySubject(1) rather than Subject because of an ordering race: an
   * `open_panel` usually follows a `navigate_to`, so the component that should
   * receive it is being lazy-loaded at the very moment we emit. Replaying the
   * last request means a late subscriber still gets it — and the timestamp lets
   * it ignore a stale one from five minutes ago when it remounts.
   */
  private readonly panelRequests = new ReplaySubject<PanelRequest>(1);
  readonly panelRequests$ = this.panelRequests.asObservable();

  private stylesInjected = false;

  // A walkthrough highlights SEVERAL elements at once ("1. name, 2. email,
  // 3. save"), so this is a list, not a single cleanup. They're torn down
  // together when the next batch starts or the timer expires.
  private activeCleanups: Array<() => void> = [];
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private batchIndex = 0;
  private batchTotal = 0;

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  /** Run a batch of actions in order, returning a short log of what happened. */
  async run(actions: UiAction[]): Promise<string[]> {
    const log: string[] = [];
    if (!this.isBrowser) return log;

    // A new answer replaces the previous tour rather than stacking on top of it.
    this.clearHighlight();
    this.batchIndex = 0;
    this.batchTotal = (actions ?? []).filter((a) => a.type === 'highlight_element').length;

    for (const action of actions ?? []) {
      try {
        log.push(await this.runOne(action));
      } catch (err: any) {
        log.push(`Could not ${action.type}: ${err?.message ?? err}`);
      }
    }
    return log;
  }

  private async runOne(action: UiAction): Promise<string> {
    switch (action.type) {
      case 'navigate_to': {
        const route = String(action.params?.['route'] ?? '');
        if (this.router.url.split('?')[0] === route) {
          return `Already on ${route}`;
        }
        const ok = await this.router.navigateByUrl(route);
        // Give the newly-routed component a frame to render before anything
        // tries to query its DOM.
        await this.nextFrame();
        return ok ? `Opened ${route}` : `Could not open ${route}`;
      }

      case 'highlight_element': {
        const aiId = String(action.params?.['ai_id'] ?? '');
        const note = action.params?.['note'] ? String(action.params['note']) : '';
        const found = await this.highlight(aiId, note);
        return found ? `Highlighted ${aiId}` : `Could not find ${aiId} on this screen`;
      }

      case 'open_panel': {
        const panel = String(action.params?.['panel'] ?? '');
        this.panelRequests.next({ panel, at: Date.now() });
        return `Opened the ${panel} panel`;
      }

      default:
        return `Unknown action ${action.type}`;
    }
  }

  /**
   * Find the element tagged `data-ai-id="..."`, scroll it into view, ring it,
   * and pin a note beside it.
   *
   * Retries briefly: after a route change the target may still be waiting on an
   * HTTP call, so a single immediate querySelector would miss it.
   */
  private async highlight(aiId: string, note: string): Promise<boolean> {
    if (!aiId) return false;
    this.injectStyles();

    const target = await this.waitForElement(`[data-ai-id="${CSS.escape(aiId)}"]`);
    if (!target) return false;

    this.batchIndex++;
    const step = this.batchIndex;

    target.classList.add('ai-highlight');
    // Only the first step scrolls. Scrolling to each in turn would yank the
    // page around and land the user on the last field of a form they haven't
    // read yet.
    if (step === 1) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    let bubble: HTMLElement | null = null;
    if (note) {
      bubble = document.createElement('div');
      bubble.className = 'ai-highlight-note';
      // Number the steps, but only when there's actually a sequence to follow.
      bubble.textContent = this.batchTotal > 1 ? `${step}. ${note}` : note;
      document.body.appendChild(bubble);
      this.positionNote(bubble, target);
    }

    const reposition = () => bubble && this.positionNote(bubble, target);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    const cleanup = () => {
      target.classList.remove('ai-highlight');
      bubble?.remove();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };

    this.activeCleanups.push(cleanup);

    // One timer for the whole tour, restarted by each new step, so a four-step
    // walkthrough stays on screen for HIGHLIGHT_MS after the LAST step lands
    // rather than expiring step by step.
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clearHighlight(), HIGHLIGHT_MS);

    return true;
  }

  /** Tear down every highlight currently on screen. */
  clearHighlight(): void {
    this.activeCleanups.forEach((fn) => fn());
    this.activeCleanups = [];
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }

  private positionNote(bubble: HTMLElement, target: Element): void {
    const rect = target.getBoundingClientRect();
    const top = rect.bottom + 10;
    // Keep the bubble on screen even when the target sits near the right edge.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 260));
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
  }

  /** Poll briefly for a selector — the screen may still be loading its data. */
  private waitForElement(selector: string, timeoutMs = 2500): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) return resolve(el);
        if (Date.now() > deadline) return resolve(null);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /**
   * Styles live here rather than in a component's stylesheet on purpose: the
   * highlight lands on arbitrary elements anywhere in the app, so it has to
   * escape every component's view encapsulation.
   */
  private injectStyles(): void {
    if (this.stylesInjected || document.getElementById('ai-highlight-styles')) {
      this.stylesInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'ai-highlight-styles';
    style.textContent = `
      .ai-highlight {
        outline: 3px solid #7c4dff !important;
        outline-offset: 3px;
        border-radius: 6px;
        animation: ai-highlight-pulse 1.4s ease-in-out 3;
        scroll-margin: 120px;
      }
      @keyframes ai-highlight-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(124, 77, 255, 0.45); }
        50%      { box-shadow: 0 0 0 10px rgba(124, 77, 255, 0); }
      }
      .ai-highlight-note {
        position: fixed;
        z-index: 10000;
        max-width: 240px;
        padding: 8px 12px;
        border-radius: 8px;
        background: #311b92;
        color: #fff;
        font: 500 12.5px/1.45 Roboto, system-ui, sans-serif;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .ai-highlight { animation: none; }
      }
    `;
    document.head.appendChild(style);
    this.stylesInjected = true;
  }
}
