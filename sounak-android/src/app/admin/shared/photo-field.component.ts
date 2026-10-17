// src/app/admin/shared/photo-field.component.ts
//
// One optional photo on a form (a doctor's face, a clinic or lab front). The
// file uploads as soon as it is picked, and the component's value becomes the
// stored path — the form just saves that string with everything else.
//
// A plain <input type="file" accept="image/*"> rather than a Capacitor camera
// plugin: inside the Android WebView it already offers "Camera" and "Files",
// and it works unchanged in the browser build.
import { Component, inject, input, model, signal } from '@angular/core';
import { IonButton, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, trashOutline } from 'ionicons/icons';
import { AdminImagesService, ImageKind } from '../data/admin-images.service';
import { AdminFeedbackService } from './admin-feedback.service';

@Component({
  selector: 'app-photo-field',
  imports: [IonButton, IonIcon, IonSpinner],
  template: `
    <div class="photo-field" [class.round]="shape() === 'round'">
      <button type="button" class="photo-well" (click)="picker.click()" [disabled]="uploading()">
        @if (uploading()) {
          <ion-spinner name="dots"></ion-spinner>
        } @else if (images.src(value()); as src) {
          <img [src]="src" alt="" />
        } @else {
          <ion-icon name="camera-outline"></ion-icon>
        }
      </button>
      <div class="photo-actions">
        <span class="photo-label">{{ label() }}</span>
        <div class="photo-buttons">
          <ion-button size="small" fill="outline" (click)="picker.click()" [disabled]="uploading()">
            {{ value() ? 'Change' : 'Add photo' }}
          </ion-button>
          @if (value()) {
            <ion-button size="small" fill="clear" color="medium" (click)="value.set(null)" [disabled]="uploading()" aria-label="Remove photo">
              <ion-icon slot="icon-only" name="trash-outline"></ion-icon>
            </ion-button>
          }
        </div>
      </div>
      <input #picker type="file" accept="image/*" hidden (change)="onPicked($event)" />
    </div>
  `,
  styles: `
    .photo-field { display: flex; align-items: center; gap: 14px; padding: 12px 16px; }
    .photo-well {
      width: 84px; height: 84px; flex-shrink: 0; padding: 0; overflow: hidden;
      border-radius: 14px; border: 1px dashed var(--ion-color-medium);
      background: var(--ion-color-light); color: var(--ion-color-medium);
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      ion-icon { font-size: 28px; }
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .round .photo-well { border-radius: 50%; }
    .photo-label { display: block; font-size: 13px; color: var(--ion-color-medium-shade); margin-bottom: 4px; }
    .photo-buttons { display: flex; align-items: center; gap: 4px; }
  `,
})
export class PhotoFieldComponent {
  images = inject(AdminImagesService);
  private feedback = inject(AdminFeedbackService);

  /** The stored image path, or null for no photo. */
  readonly value = model<string | null>(null);
  readonly label = input('Photo');
  readonly kind = input<ImageKind>('photo');
  readonly shape = input<'square' | 'round'>('square');

  readonly uploading = signal(false);

  constructor() {
    addIcons({ cameraOutline, trashOutline });
  }

  onPicked(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = ''; // so picking the same file again still fires (change)
    if (!file) return;

    this.uploading.set(true);
    this.images.upload(file, this.kind()).subscribe({
      next: (url) => {
        this.value.set(url);
        this.uploading.set(false);
      },
      error: (err) => {
        this.uploading.set(false);
        this.feedback.failed(err, 'Could not upload that photo.');
      },
    });
  }
}
