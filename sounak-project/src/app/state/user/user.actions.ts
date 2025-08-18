import { createAction, props } from '@ngrx/store';
import { User } from '../../models/user.model';

export const loadUserProfile = createAction('[User] Load User Profile');
export const loadUserProfileSuccess = createAction(
  '[User] Load User Profile Success',
  props<{ profile: User }>()
);
export const loadUserProfileFailure = createAction(
  '[User] Load User Profile Failure',
  props<{ error: any }>()
);

export const loadUsersList = createAction('[User] Load Users List');
export const loadUsersListSuccess = createAction(
  '[User] Load Users List Success',
  props<{ users: User[] }>()
);
export const loadUsersListFailure = createAction(
  '[User] Load Users List Failure',
  props<{ error: any }>()
);

export const addUser = createAction('[User] Add User', props<{ user: User }>());