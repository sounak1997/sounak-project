import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { logOutOutline } from 'ionicons/icons';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon],
})
export class HomePage {
  auth = inject(AuthService);
  private router = inject(Router);

  constructor() {
    addIcons({ logOutOutline });
  }

  goTo(section: 'grocery' | 'orders' | 'booking' | 'helper'): void {
    this.router.navigateByUrl(`/${section}`);
  }

  logout(): void {
    this.auth.logout();
  }
}
