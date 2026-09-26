import {
  Component,
  ElementRef,
  OnDestroy,
  output,
  signal,
  viewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import jsQR from 'jsqr';

/**
 * A QR scanner that runs inside the app, for a member who already has it open.
 *
 * The phone's own camera app also reads the door QR and opens the link directly
 * — that path still works and needs nothing installed. This is the other way
 * round: a member already signed in taps "Scan to check in" here rather than
 * leaving the app, finding the camera, and coming back.
 *
 * Decoding uses the browser's native BarcodeDetector where it exists (Chrome on
 * Android, and it is noticeably faster since it runs off the main thread), and
 * falls back to jsQR everywhere else — notably iOS Safari, which has no
 * BarcodeDetector and is half the phones at any Indian gym.
 */
@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="scanner">
      @if (error()) {
        <div class="alert alert--error">{{ error() }}</div>
      }

      <div class="frame" [class.frame--live]="running()">
        <video #video playsinline muted></video>
        <div class="reticle"></div>
      </div>
      <canvas #canvas hidden></canvas>

      <p class="muted small center">
        {{ running() ? 'Point at the QR code by the gym entrance.' : 'Starting the camera…' }}
      </p>
    </div>
  `,
  styles: [`
    .frame {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      max-height: 60vh;
      border-radius: var(--radius);
      overflow: hidden;
      background: #000;
    }
    video { width: 100%; height: 100%; object-fit: cover; display: block; }
    /* A square guide, so people hold the phone at a sensible distance instead
       of filling the frame with the poster. */
    .reticle {
      position: absolute;
      inset: 18%;
      border: 3px solid rgba(255, 255, 255, 0.85);
      border-radius: 14px;
      box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
    }
    .center { text-align: center; margin-top: 12px; }
    .small { font-size: 13px; }
  `],
})
export class QrScannerComponent implements AfterViewInit, OnDestroy {
  /** Emits the decoded text once, then the scanner stops. */
  readonly scanned = output<string>();
  readonly failed = output<string>();

  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly running = signal(false);
  readonly error = signal('');

  private stream?: MediaStream;
  private frameHandle?: number;
  private detector?: { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
  private stopped = false;

  async ngAfterViewInit(): Promise<void> {
    try {
      // The rear camera by default: nobody scans a wall poster with the selfie
      // camera, and `ideal` rather than `exact` so a laptop with one camera
      // still works instead of throwing.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (err) {
      const message = (err as DOMException)?.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow it, or scan the QR with your phone camera instead.'
        : 'No camera available. You can scan the QR with your phone camera instead.';
      this.error.set(message);
      this.failed.emit(message);
      return;
    }

    const video = this.video().nativeElement;
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);

    const Detector = (globalThis as Record<string, unknown>)['BarcodeDetector'] as
      | (new (opts: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> })
      | undefined;
    if (Detector) {
      try {
        this.detector = new Detector({ formats: ['qr_code'] });
      } catch {
        // Present but without QR support — jsQR takes over.
      }
    }

    this.running.set(true);
    this.tick();
  }

  private tick = async (): Promise<void> => {
    if (this.stopped) return;
    const video = this.video().nativeElement;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = this.canvas().nativeElement;
      // Capped at 640px: a QR fills a good part of the frame, and decoding a
      // full 1080p frame every tick heats the phone for no extra accuracy.
      const scale = Math.min(1, 640 / (video.videoWidth || 640));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx && canvas.width && canvas.height) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        let value: string | null = null;

        if (this.detector) {
          try {
            const found = await this.detector.detect(canvas);
            value = found[0]?.rawValue ?? null;
          } catch {
            this.detector = undefined; // fall through to jsQR from now on
          }
        }
        if (!value) {
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          value = jsQR(image.data, image.width, image.height, {
            inversionAttempts: 'dontInvert',
          })?.data ?? null;
        }

        if (value) {
          this.stop();
          this.scanned.emit(value);
          return;
        }
      }
    }
    this.frameHandle = requestAnimationFrame(() => void this.tick());
  };

  /** Releases the camera. Without this the indicator light stays on. */
  stop(): void {
    this.stopped = true;
    this.running.set(false);
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
