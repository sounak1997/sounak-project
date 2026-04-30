import {
  Component,
  signal,
  computed,
  effect,
  input,
  output,
  model,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { StepControlComponent } from './step-control/step-control.component';

// --- Main Signal Counter Demo Component ---
@Component({
  selector: 'app-signal-counter',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule,
    MatIconModule,
    MatDividerModule,
    StepControlComponent,
  ],
  templateUrl: './signal-counter.component.html',
  styleUrl: './signal-counter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignalCounterComponent {
  // --- Signal Input: configurable max (replaces @Input) ---
  readonly maxValue = input<number>(100);
  readonly minValue = input<number>(-100);

  // --- Signal Output: emits whenever count changes (replaces @Output EventEmitter) ---
  readonly countChanged = output<number>();

  // --- Writable signals: local mutable state ---
  readonly count = signal(0);
  readonly step = model(1);        // two-way bound to StepControlComponent
  readonly history = signal<number[]>([0]);

  // --- Computed signals: pure derived values, cached and lazy ---
  readonly doubled = computed(() => this.count() * 2);
  readonly squared = computed(() => this.count() ** 2);
  readonly isEven = computed(() => this.count() % 2 === 0);
  readonly isAtMax = computed(() => this.count() >= this.maxValue());
  readonly isAtMin = computed(() => this.count() <= this.minValue());
  readonly percentage = computed(() => {
    const range = this.maxValue() - this.minValue();
    return Math.round(((this.count() - this.minValue()) / range) * 100);
  });
  readonly progressStyle = computed(() => ({
    width: `${this.percentage()}%`,
    background: this.count() >= 0 ? '#7c3aed' : '#ef4444',
  }));
  readonly statusLabel = computed(() => {
    const c = this.count();
    if (c > 50) return '🚀 High';
    if (c > 0) return '✅ Positive';
    if (c === 0) return '⚡ Zero';
    if (c > -50) return '⬇️ Negative';
    return '🔻 Very Low';
  });

  // --- Effect: reacts to count changes as a side effect ---
  constructor() {
    effect(() => {
      const current = this.count();
      console.log(`[Signal Effect] count = ${current}`);
      this.countChanged.emit(current);
    });
  }

  increment(): void {
    if (this.isAtMax()) return;
    this.count.update((n) => Math.min(n + this.step(), this.maxValue()));
    this.history.update((h) => [...h.slice(-9), this.count()]);
  }

  decrement(): void {
    if (this.isAtMin()) return;
    this.count.update((n) => Math.max(n - this.step(), this.minValue()));
    this.history.update((h) => [...h.slice(-9), this.count()]);
  }

  reset(): void {
    this.count.set(0);
    this.history.set([0]);
  }

  setCount(value: number): void {
    const clamped = Math.max(this.minValue(), Math.min(this.maxValue(), value));
    this.count.set(clamped);
    this.history.update((h) => [...h.slice(-9), clamped]);
  }
}
