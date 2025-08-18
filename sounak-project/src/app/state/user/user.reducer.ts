import { createReducer, on } from '@ngrx/store';
import { initialUserState } from './user.state';
import * as UserActions from './user.actions';

export const userReducer = createReducer(
  initialUserState,
  // User Profile
  on(UserActions.loadUserProfile, (state) => ({ ...state, loading: true, error: null })),
  on(UserActions.loadUserProfileSuccess, (state, { profile }) => ({ ...state, profile, loading: false })),
  on(UserActions.loadUserProfileFailure, (state, { error }) => ({ ...state, loading: false, error })),

  // Users List
  on(UserActions.loadUsersList, (state) => ({ ...state, loading: true, error: null })),
  on(UserActions.loadUsersListSuccess, (state, { users }) => ({ ...state, users, loading: false })),
  on(UserActions.loadUsersListFailure, (state, { error }) => ({ ...state, loading: false, error })),

  // New user added directly to the state
  on(UserActions.addUser, (state, { user }) => ({
    ...state,
    users: [...state.users, user], // Creates a new array with the added user
  }))
);