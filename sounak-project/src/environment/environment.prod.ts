// Production build. angular.json's `fileReplacements` swaps environment.ts for
// this file — without that wiring this file is dead code and the dev config
// ships to production, which is what used to happen here.
//
// The frontend is a Cloudflare Pages static site on its own origin, so
// relative URLs no longer reach the API. This must be the backend's absolute
// URL. Both ends are HTTPS, so there is no mixed-content problem.
//
// TODO: replace with the real Zeabur domain once the backend service is up.
export const environment = {
  production: true,
  apiUrl: 'https://REPLACE-WITH-ZEABUR-BACKEND.zeabur.app',
};
