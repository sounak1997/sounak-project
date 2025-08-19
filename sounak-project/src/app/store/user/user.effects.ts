import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import { loadUsers, loadUsersSuccess, loadUsersFailure, addUser, addUserSuccess, addUserFailure } from './user.actions';
import { map, exhaustMap, catchError, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { User } from '../../models/user.model';
import { ApiService } from '../../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

@Injectable()
export class UserEffects {
  loadUsers$;
  addUser$;
  addUserSuccess;

  constructor(private actions$: Actions,
    private apiService: ApiService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {
    this.loadUsers$ = createEffect(() =>
      this.actions$.pipe(
        ofType(loadUsers),
        exhaustMap(() =>
          this.apiService.getUsers().pipe(
            map((users) => loadUsersSuccess({ users })),
            catchError((error) => of(loadUsersFailure({ error })))
          )
        )
      )
    );

    this.addUser$ = createEffect(() =>
      this.actions$.pipe(
        ofType(addUser),
        exhaustMap(({ user }) =>
          this.apiService.addUser(user).pipe(
            map((res: any) => {
              console.log('[User Effects] API returned:', res);
              return addUserSuccess({ user: res.user as User }); // <-- extract the 'user' field
            }),
            catchError((error) => of(addUserFailure({ error })))
          )
        )
      )
    );

    // Side effect for success
    this.addUserSuccess = createEffect(
      () =>
        this.actions$.pipe(
          ofType(addUserSuccess),
          tap(() => {
            this.snackBar.open('User added successfully!', 'Dismiss', { duration: 3000 });
            //this.router.navigate(['/dashboard']);
          })
        ),
      { dispatch: false } // No new action dispatched
    );
  }
}

