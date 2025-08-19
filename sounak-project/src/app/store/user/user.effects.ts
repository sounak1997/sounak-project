import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { HttpClient } from '@angular/common/http';
import { loadUsers, loadUsersSuccess, loadUsersFailure } from './user.actions';
import { mergeMap, map, catchError, delay, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { User } from '../../models/user.model';

@Injectable()
export class UserEffects {
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      tap(() => console.log('loadUsers action triggered')),
      delay(500), // simulate API delay
      map(() => {
        const dummyUsers: User[] = [
          { id: 1, name: 'John Doe', email: 'john@example.com' },
          { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
        ];
        console.log('Dispatching loadUsersSuccess with dummyUsers:', dummyUsers);
        return loadUsersSuccess({ users: dummyUsers });
      }),
      catchError(error => {
        console.error('Error in loadUsers$', error);
        return of(loadUsersFailure({ error }));
      })
    )
  );

  constructor(private actions$: Actions, private http: HttpClient) {}
}
