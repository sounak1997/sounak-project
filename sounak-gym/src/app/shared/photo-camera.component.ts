import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Takes a member's photo with the device camera, without leaving the app.
 *
 * A file input with `capture` opens the camera only on a phone. On the laptop
 * most front desks run, it opened a file picker instead — "Take photo" meant
 * hunting for a picture that did not exist yet. getUserMedia works on both, so
 * the desk gets a live preview whichever device is on the counter. A file is
 * still on offer beside this, for a picture that already exists.
 *
 * The frame is square with a round guide because that is the photo's real
 * shape: the server crops to a 400px square and every screen shows it as a
 * circle, so what is inside the circle here is exactly what gets kept.
 */
@Component({
  selector: 'app-photo-camera',
  standalone: true,
  template: `
    <div class="modal-backdrop cam-layer" (click)="closed.emit()">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cam-title"
        (click)="$event.stopPropagation()">
        <h2 id="cam-title">Take a photo</h2>
        <div class="accent-bar accent-bar--left"></div>

        @if (error()) {
          <div class="alert alert--error">{{ error() }}</div>
          <div class="modal__actions">
            <button type="button" class="btn btn--ghost" (click)="closed.emit()">Cancel</button>
            <label class="btn file-btn">
              Choose a file instead
              <input type="file" accept="image/*" (change)="picked($event)" hidden />
            </label>
          </div>
        } @else {
          <div class="frame">
            <video #video playsinline muted [class.mirrored]="mirrored()"></video>
            @if (snapshot()) {
              <img [src]="snapshot()" alt="The photo just taken" />
            }
            <div class="guide"></div>
          </div>

          <p class="muted small center">
            @if (snapshot()) {
              Happy with it? Use it, or take another.
            } @else if (running()) {
              Fit their face inside the circle.
            } @else {
              Starting the camera…
            }
          </p>

          @if (canSwitch() && !snapshot()) {
            <button type="button" class="btn btn--ghost btn--sm switch" (click)="switchCamera()">
              Switch camera
            </button>
          }

          <div class="modal__actions">
            @if (snapshot()) {
              <button type="button" class="btn btn--ghost" (click)="retake()">Retake</button>
              <button type="button" class="btn" (click)="use()">Use photo</button>
            } @else {
              <button type="button" class="btn btn--ghost" (click)="closed.emit()">Cancel</button>
              <button type="button" class="btn" [disabled]="!running()" (click)="capture()">
                Capture
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    /* Above the add / edit dialog that opened it, which shares .modal-backdrop. */
    .cam-layer { z-index: 90; }
    .frame {
      position: relative;
      width: min(100%, 52vh);
      aspect-ratio: 1;
      margin: 0 auto;
      border-radius: var(--radius);
      overflow: hidden;
      background: #000;
    }
    video, img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    /* A selfie camera shown un-mirrored moves the wrong way when you lean, and
       people cannot frame themselves. capture() mirrors the still to match. */
    video.mirrored { transform: scaleX(-1); }
    /* The avatar is a circle inscribed in the square, so the corners this
       darkens are the part that is never seen. */
    .guide {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px dashed rgba(255, 255, 255, 0.8);
      box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }
    .center { text-align: center; margin: 12px 0 0; }
    .small { font-size: 13px; }
    .switch { display: flex; margin: 10px auto 0; }
  `],
})
export class PhotoCameraComponent implements AfterViewInit, OnDestroy {
  /** The photo, as a square JPEG ready to upload. Emitted once, on "Use photo". */
  readonly captured = output<File>();
  readonly closed = output<void>();

  // Optional: the error state removes the <video>.
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly running = signal(false);
  readonly error = signal('');
  /** Object URL of the still just taken; empty while the camera is live. */
  readonly snapshot = signal('');
  readonly mirrored = signal(false);
  /** Only offered once there is more than one camera to switch between. */
  readonly canSwitch = signal(false);

  /**
   * Rear by default: on a phone, the desk photographs the member standing at
   * the counter. `ideal`, not `exact`, so a laptop's single webcam still opens.
   */
  private facing: 'environment' | 'user' = 'environment';
  private stream?: MediaStream;
  private file?: File;
  /**
   * Bumped on every start and on destroy. getUserMedia waits on a permission
   * prompt, so a stream can arrive after the dialog closed or the camera was
   * switched — it is then released at once, or the camera light stays on with
   * nothing on screen to explain it.
   */
  private generation = 0;

  ngAfterViewInit(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    const gen = ++this.generation;
    this.stopStream();
    this.running.set(false);
    this.error.set('');

    if (!navigator.mediaDevices?.getUserMedia) {
      // Also what an http:// page gets: browsers only expose the camera on
      // https and localhost.
      this.error.set('This browser cannot open the camera here. Choose a file instead.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.facing },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
    } catch (err) {
      if (gen !== this.generation) return;
      const name = (err as DOMException)?.name;
      this.error.set(
        name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow it in the browser settings, or choose a file instead.'
          : name === 'NotReadableError'
            ? 'The camera is in use by another app. Close it and try again, or choose a file instead.'
            : 'No camera was found on this device. Choose a file instead.',
      );
      return;
    }

    if (gen !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

    // A laptop webcam usually reports no facingMode at all, and faces the
    // person using it — so only a camera that says it faces away is unmirrored.
    this.mirrored.set(stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment');

    const video = this.video()?.nativeElement;
    if (!video) return;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    this.running.set(true);

    // Device lists are only complete once permission has been granted.
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    this.canSwitch.set(devices.filter((d) => d.kind === 'videoinput').length > 1);
  }

  async capture(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video?.videoWidth || !video.videoHeight) return;

    // The centre square — what object-fit: cover was showing in the frame.
    const w = video.videoWidth;
    const h = video.videoHeight;
    const side = Math.min(w, h);
    // 800px leaves the server's 400px crop room to resize down, never up.
    const size = Math.min(side, 800);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (this.mirrored()) {
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) {
      this.error.set('Could not take the picture. Please try again, or choose a file instead.');
      return;
    }
    this.file = new File([blob], 'member-photo.jpg', { type: 'image/jpeg' });
    this.snapshot.set(URL.createObjectURL(blob));
    // The still is on screen, so the camera can go off while they decide.
    this.stopStream();
  }

  retake(): void {
    this.clearSnapshot();
    void this.start();
  }

  use(): void {
    if (this.file) this.captured.emit(this.file);
  }

  switchCamera(): void {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    void this.start();
  }

  /** The fallback when there is no camera, or it was refused. */
  picked(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.captured.emit(file);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  ngOnDestroy(): void {
    this.generation++;
    this.stopStream();
    this.clearSnapshot();
  }

  /** Releases the camera. Without this the indicator light stays on. */
  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.running.set(false);
  }

  private clearSnapshot(): void {
    if (this.snapshot()) URL.revokeObjectURL(this.snapshot());
    this.snapshot.set('');
    this.file = undefined;
  }
}
