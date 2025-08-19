// src/app/store/user/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { loadUsers, loadUsersSuccess, loadUsersFailure } from './user.actions';
import { User } from '../../models/user.model';

export interface UserState {
  users: User[];
  loading: boolean;
  error: any;
}

export const initialState: UserState = {
  users: [],
  loading: false,
  error: null
};

export const userReducer = createReducer(
  initialState,
  on(loadUsers, state => {
    console.log('Reducer: loadUsers -> set loading true');
    return { ...state, loading: true };
  }),
  on(loadUsersSuccess, (state, { users }) => {
    console.log('Reducer: loadUsersSuccess -> users received:', users);
    return { ...state, users, loading: false, error: null };
  }),
  on(loadUsersFailure, (state, { error }) => {
    console.error('Reducer: loadUsersFailure -> error:', error);
    return { ...state, loading: false, error };
  })
);
