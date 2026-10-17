// src/app/admin/admin.routes.ts — mounted at /admin behind adminGuard.
//
// Route params bind straight to each page's input() of the same name
// (withComponentInputBinding in main.ts). Within a section, literal paths
// come before parameterised ones so "new" is never read as an id.
import { Routes } from '@angular/router';

const productForm = () => import('./products/admin-product-form.page').then((m) => m.AdminProductFormPage);
const centerForm = () => import('./booking/admin-center-form.page').then((m) => m.AdminCenterFormPage);
const doctorForm = () => import('./booking/admin-doctor-form.page').then((m) => m.AdminDoctorFormPage);
const labForm = () => import('./booking/admin-lab-form.page').then((m) => m.AdminLabFormPage);
const testForm = () => import('./booking/admin-test-form.page').then((m) => m.AdminTestFormPage);
const couponForm = () => import('./store/admin-coupon-form.page').then((m) => m.AdminCouponFormPage);

export const ADMIN_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./admin-home.page').then((m) => m.AdminHomePage) },

  // Grocery items
  { path: 'products', loadComponent: () => import('./products/admin-products.page').then((m) => m.AdminProductsPage) },
  { path: 'products/new', loadComponent: productForm },
  { path: 'products/:id', loadComponent: productForm },

  // Doctors & clinics
  { path: 'doctors', loadComponent: () => import('./booking/admin-centers.page').then((m) => m.AdminCentersPage) },
  { path: 'doctors/clinic/new', loadComponent: centerForm },
  { path: 'doctors/clinic/:centerId', loadComponent: centerForm },
  { path: 'doctors/clinic/:centerId/add-doctor', loadComponent: doctorForm },
  { path: 'doctors/:doctorId', loadComponent: doctorForm },

  // Test centres
  { path: 'labs', loadComponent: () => import('./booking/admin-labs.page').then((m) => m.AdminLabsPage) },
  { path: 'labs/new', loadComponent: labForm },
  { path: 'labs/:labId', loadComponent: labForm },
  { path: 'labs/:labId/add-test', loadComponent: testForm },
  { path: 'tests/:testId', loadComponent: testForm },

  // Shop settings
  { path: 'coupons', loadComponent: () => import('./store/admin-coupons.page').then((m) => m.AdminCouponsPage) },
  { path: 'coupons/new', loadComponent: couponForm },
  { path: 'coupons/:couponId', loadComponent: couponForm },
  { path: 'payment-qr', loadComponent: () => import('./store/admin-payment-qr.page').then((m) => m.AdminPaymentQrPage) },
];
