import { Component, model, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-step-control',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="step-control">
      <span class="step-label">Step size:</span>
      <button mat-icon-button (click)="value.set(Math.max(1, value() - 1))">
        <mat-icon>remove</mat-icon>
      </button>
      <span class="step-value">{{ value() }}</span>
      <button mat-icon-button (click)="value.set(value() + 1)">
        <mat-icon>add</mat-icon>
      </button>
    </div>
  `,
  styles: [`
    .step-control { display: flex; align-items: center; gap: 8px; }
    .step-label   { color: #666; font-size: 14px; }
    .step-value   { font-weight: 700; min-width: 24px; text-align: center; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepControlComponent {
  // model() creates a two-way signal binding — parent passes value, child can update it
  readonly value = model<number>(1);
  protected readonly Math = Math;
}
