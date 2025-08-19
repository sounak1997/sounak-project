// src/app/store/user/user.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { UserState } from './user.reducer';

export const selectUserFeature = createFeatureSelector<UserState>('user');

export const selectUsers = createSelector(
  selectUserFeature,
  state => state.users
);

export const selectUsersLoading = createSelector(
  selectUserFeature,
  state => state.loading
);

export const selectUsersError = createSelector(
  selectUserFeature,
  state => state.error
);
