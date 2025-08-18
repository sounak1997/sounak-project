import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth.service';
import * as UserActions from './user.actions';

@Injectable()
export class UserEffects {
  constructor(
    private actions$: Actions,
    private apiService: ApiService,
    private authService: AuthService
  ) {}

  loadUserProfile$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.loadUserProfile),
      mergeMap(() =>
        this.apiService.getProfile().pipe(
          map(profile => UserActions.loadUserProfileSuccess({ profile })),
          catchError(error => {
            if (error.status === 401) {
              this.authService.logout();
            }
            return of(UserActions.loadUserProfileFailure({ error }));
          })
        )
      )
    )
  );

  loadUsersList$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.loadUsersList),
      mergeMap(() =>
        this.apiService.getUsers().pipe(
          map(users => UserActions.loadUsersListSuccess({ users })),
          catchError(error => of(UserActions.loadUsersListFailure({ error })))
        )
      )
    )
  );
}