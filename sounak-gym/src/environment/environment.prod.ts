// Production build. angular.json's `fileReplacements` swaps environment.ts for
// this file — without that wiring this file is dead code and the dev config
// ships to production.
//
// The frontend is a static site on Cloudflare Workers, on its own origin, so
// relative URLs never reach the API. This must be the backend's absolute URL.
export const environment = {
  production: true,
  apiUrl: 'https://sounak-backend.onrender.com',
};
