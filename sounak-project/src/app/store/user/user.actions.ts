// src/app/store/user/user.actions.ts
import { createAction, props } from '@ngrx/store';
import { User } from '../../models/user.model';

export const loadUsers = createAction('[User] Load Users');

export const loadUsersSuccess = createAction(
  '[User] Load Users Success',
  props<{ users: User[] }>()
);

export const loadUsersFailure = createAction(
  '[User] Load Users Failure',
  props<{ error: any }>()
);

export const addUser = createAction(
  '[User] Add User',
  props<{ user: Partial<User> }>()  // Partial because password may be included
);

export const addUserSuccess = createAction(
  '[User] Add User Success',
  props<{ user: User }>()
);

export const addUserFailure = createAction(
  '[User] Add User Failure',
  props<{ error: any }>()
);
