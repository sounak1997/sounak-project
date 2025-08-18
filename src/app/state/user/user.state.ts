import { User } from '../../models/user.model';

export interface UserState {
  profile: User | null;
  users: User[];
  loading: boolean;
  error: any;
}

export const initialUserState: UserState = {
  profile: null,
  users: [],
  loading: false,
  error: null,
};