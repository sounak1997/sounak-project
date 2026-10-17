// src/app/admin/data/admin-images.service.ts
//
// Every photo in the admin panel goes up through POST /api/images, which
// stores it in Postgres and returns a path like "/images/<id>". The form then
// saves that path on the product / doctor / lab like any other field — so a
// photo can be added while creating something, before it has an id.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/** product: 1024px wide; photo: a face or a shopfront, 600px; qr: 800px. */
export type ImageKind = 'product' | 'photo' | 'qr';

@Injectable({ providedIn: 'root' })
export class AdminImagesService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  upload(file: File, kind: ImageKind): Observable<string> {
    const body = new FormData();
    body.append('image', file);
    return this.http
      .post<{ data: { url: string } }>(`${this.apiUrl}/api/images?kind=${kind}`, body)
      .pipe(map((res) => res.data.url));
  }

  /** Stored paths are backend-relative; this makes them loadable by an <img>. */
  src(path: string | null | undefined): string | null {
    return path ? `${this.apiUrl}${path}` : null;
  }
}
