// A Capacitor app is NOT served from the backend's origin — on Android the
// WebView runs at localhost — so a relative URL ('') would resolve to the
// phone itself. A native build needs an ABSOLUTE backend URL.
export const environment = {
  production: true,
  apiUrl: 'https://sounak-backend.onrender.com',
};
