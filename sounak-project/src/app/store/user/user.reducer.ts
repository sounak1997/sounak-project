import { createReducer, on } from '@ngrx/store';
import { loadUsers, loadUsersSuccess, loadUsersFailure, addUserSuccess, addUserFailure, addUser } from './user.actions';
import { User } from '../../models/user.model';

export interface UserState {
  users: User[];
  loading: boolean;
  error: any;
}

export const initialState: UserState = {
  users: [],
  loading: false,
  error: null,
};

export const userReducer = createReducer(
  initialState,
  
  // Trigger loading state
  on(loadUsers, (state) => {
    console.log('[User Reducer] loadUsers -> setting loading true');
    return { ...state, loading: true, error: null }; // clear previous errors
  }),

  // On successful API response
  on(loadUsersSuccess, (state, { users }) => {
    console.log('[User Reducer] loadUsersSuccess -> users received:', users);
    return { ...state, users, loading: false, error: null };
  }),

  // On API failure
  on(loadUsersFailure, (state, { error }) => {
    console.error('[User Reducer] loadUsersFailure -> error:', error);
    return { ...state, loading: false, error };
  }),


  //ADD USER
  on(addUserSuccess, (state, { user }) => {
  const newUsers = [...state.users, user];
  console.log('[User Reducer] addUserSuccess -> new users array:', newUsers);
  return {
    ...state,
    users: newUsers,
    loading: false,
    error: null
  };
}),
on(addUserFailure, (state, { error }) => ({
  ...state,
  loading: false,
  error
})),
on(addUser, (state) => ({ ...state, loading: true })),
);
