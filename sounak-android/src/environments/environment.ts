// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  // sounak-backend running locally. In production this becomes '' (same-origin),
  // same reasoning as sounak-project's environment.prod.ts.
  apiUrl: 'http://localhost:3000',
};
