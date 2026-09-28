import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { platformAdminGuard } from './core/platform-admin.guard';

export const routes: Routes = [
  /**
   * The door screen. PUBLIC and unguarded on purpose — it is the URL printed on
   * every gym's poster, and a member scanning it is not signed in and never will
   * be. Putting a guard here would break the entire product.
   */
  {
    path: 'checkin',
    loadComponent: () => import('./checkin/checkin.page').then((m) => m.CheckinPage),
    title: 'Check in',
  },

  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
    title: 'Gym login',
  },

  /**
   * Member sign-up. Public: the whole point is that someone who is not at the
   * gym, and has no session, can create a login.
   */
  {
    path: 'signup',
    loadComponent: () => import('./signup/signup.page').then((m) => m.SignupPage),
    title: 'Create your login',
  },

  /** Forgotten password. Public, for the obvious reason. */
  {
    path: 'reset-password',
    loadComponent: () => import('./reset/reset.page').then((m) => m.ResetPage),
    title: 'Reset password',
  },

  /**
   * The owner/staff console.
   *
   * Four routed children rather than one screen: finding a member at the desk
   * and pasting in a payment gateway's keys are different jobs, and on a phone
   * they were thousands of pixels apart on the same scroll. The shell holds the
   * top bar, the tab bar (a rail on a laptop) and every dialog.
   */
  {
    path: 'dashboard',
    loadComponent: () => import('./console/console.shell').then((m) => m.ConsoleShell),
    canActivate: [authGuard],
    children: [
      {
        path: 'today',
        loadComponent: () => import('./console/pages/today.page').then((m) => m.TodayPage),
        title: 'Today',
      },
      {
        path: 'members',
        loadComponent: () => import('./console/pages/members.page').then((m) => m.MembersPage),
        title: 'Members',
      },
      {
        path: 'money',
        loadComponent: () => import('./console/pages/money.page').then((m) => m.MoneyPage),
        title: 'Money',
      },
      {
        path: 'setup',
        loadComponent: () => import('./console/pages/setup.page').then((m) => m.SetupPage),
        title: 'Setup',
      },
      { path: '', redirectTo: 'today', pathMatch: 'full' },
    ],
  },

  /**
   * A signed-in member's own record. Guarded like the console, but a member is
   * not staff — the API scopes these reads by gym_members.account_id.
   */
  {
    path: 'me',
    loadComponent: () => import('./member/member.page').then((m) => m.MemberPage),
    canActivate: [authGuard],
    title: 'My membership',
  },

  /**
   * The platform operator's screen: every gym, and the switch that suspends one.
   * Its own guard, not authGuard — being signed in is not enough, and the server
   * enforces the same thing again on every /admin/* route.
   */
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.page').then((m) => m.AdminPage),
    canActivate: [platformAdminGuard],
    title: 'Platform administration',
  },

  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];
