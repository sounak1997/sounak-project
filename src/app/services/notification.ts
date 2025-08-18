import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {

  constructor(private _snackBar: MatSnackBar) { }

  public displayNotification(message: string, action: string = 'Dismiss', duration: number = 3000): void {
    this._snackBar.open(message, action, {
      duration: duration,
      horizontalPosition: 'center', // Can be 'start' | 'center' | 'end' | 'left' | 'right'
      verticalPosition: 'bottom',  // Can be 'top' | 'bottom'
    });
  }
}
