import { Routes } from '@angular/router';
import { importProvidersFrom } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';

import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { DashboardComponent } from './components/dashboard/dashboard';
import { AddUserComponent } from './components/add-user/add-user';
import { authGuard } from './guards/auth-guard';

import { userReducer } from './store/user/user.reducer';
import { UserEffects } from './store/user/user.effects';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'add-user', component: AddUserComponent, canActivate: [authGuard] },

  // Lazy-loaded UserList with NgRx feature
  {
    path: 'user-list',
    //canActivate: [authGuard],
    loadComponent: () =>
      import('./components/user-list/user-list').then(m => m.UserListComponent),
    providers: [
      importProvidersFrom(
        //StoreModule.forFeature('user', userReducer),
        EffectsModule.forFeature([UserEffects])
      )
    ]
  },

  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/dashboard' }
];
