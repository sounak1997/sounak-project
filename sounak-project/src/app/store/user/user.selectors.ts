import { createFeatureSelector, createSelector } from '@ngrx/store';
import { UserState } from './user.reducer';

// Feature selector for the user slice
export const selectUserFeature = createFeatureSelector<UserState>('user');

// Selector to get the list of users
export const selectUsers = createSelector(
  selectUserFeature,
  (state) => state.users
);

// Selector to get the loading status
export const selectUsersLoading = createSelector(
  selectUserFeature,
  (state) => state.loading
);

// Selector to get any error from user state
export const selectUsersError = createSelector(
  selectUserFeature,
  (state) => state.error
);
