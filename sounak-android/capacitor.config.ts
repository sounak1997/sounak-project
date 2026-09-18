import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sounak.android',
  appName: 'sounak-android',
  webDir: 'www',

  // androidScheme stays at Capacitor's default 'https', giving the WebView an
  // https://localhost origin. That matched the backend being HTTPS on Render,
  // so there is no mixed-content problem and no need for the 'http' override
  // this file carried while the backend was an IP-only HTTP host.

  // NOTE: deliberately NOT enabling the CapacitorHttp plugin. It would bypass
  // CORS neatly, but it does not support streaming responses — it would break
  // the SSE chat at /api/ai/chat/stream.
};

export default config;
