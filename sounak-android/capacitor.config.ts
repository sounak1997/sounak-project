import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sounak.android',
  appName: 'sounak-android',
  webDir: 'www',

  android: {
    // Capacitor defaults this to 'https', which makes the WebView origin
    // https://localhost. That origin calling an http:// backend is blocked as
    // MIXED CONTENT — a second, separate failure from the Android cleartext
    // policy, and it looks identical (generic network error).
    //
    // 'http' makes the origin http://localhost, so http:// API calls are
    // same-scheme and go through. localhost is still treated as a secure
    // context, so camera/geolocation keep working.
    //
    // Once the backend is HTTPS, set this back to 'https' and delete the
    // cleartext exception in res/xml/network_security_config.xml.
    androidScheme: 'http',
  },

  // NOTE: deliberately NOT enabling the CapacitorHttp plugin. It would bypass
  // CORS neatly, but it does not support streaming responses — it would break
  // the SSE chat at /api/ai/chat/stream.
};

export default config;
