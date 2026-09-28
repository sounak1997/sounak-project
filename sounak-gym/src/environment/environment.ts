export const environment = {
  production: false,
  // Empty = relative URLs, proxied to the backend by proxy.conf.json. Mirrors
  // how sounak-project is set up, so the same services work in both layouts.
  apiUrl: '',
  // The origin printed on the door poster.
  //
  // NOT location.origin: a poster generated on a dev machine would encode
  // http://localhost:4300/checkin, which is a QR that works for exactly one
  // person on one laptop. The poster is a physical object on a wall, scanned by
  // members who have never heard of this machine, so it always points at
  // production — in dev as well.
  publicUrl: 'https://suvidhaa-gym.sounak-project.workers.dev',
};
