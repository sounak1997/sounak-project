// src/environment/environment.prod.ts
export const environment = {
  production: true,

  // Empty = same-origin relative URLs (e.g. "/api/ai/ask").
  //
  // In production nginx serves the app and proxies /api to the Express backend
  // on the same host and port, so relative URLs are correct and avoid CORS
  // entirely. Hardcoding a host here previously pointed at a decommissioned
  // EC2 instance and doubled the /api prefix, breaking every API call.
  apiUrl: '',
};
