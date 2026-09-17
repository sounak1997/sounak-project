// ⚠️  A Capacitor app is NOT served from your backend's origin.
// On Android the WebView runs at http://localhost, so a relative URL ('')
// would resolve to the *phone itself*, not your server — every API call
// would fail. A native build therefore needs an ABSOLUTE backend URL.
// (This differs from sounak-project's web build, where '' is correct because
// Express serves that bundle same-origin.)
//
// TODO: replace with your Oracle VM address after Phase 4 of docs/DEPLOYMENT.md
//   http://<ip>    works only with the cleartext exception in
//                  android/app/src/main/res/xml/network_security_config.xml
//   https://<domain>  preferred — then you can delete that exception entirely.
export const environment = {
  production: true,
  apiUrl: 'http://REPLACE_WITH_ORACLE_IP',
};
