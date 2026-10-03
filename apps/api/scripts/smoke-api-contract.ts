import { discoveryQuerySchema } from '@footy-finder/shared';
import request from 'supertest';
import { app } from '../src/app.js';
import { allowedOrigins } from '../src/config/cors.js';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const origin = allowedOrigins[0];
assert(origin, 'A configured browser origin is required.');

for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  const response = await request(app)
    .options('/tickets/mine')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
  assert(response.status === 204, `${method} preflight did not return 204.`);
  assert(
    response.headers['access-control-allow-origin'] === origin,
    `${method} preflight did not allow the configured origin.`,
  );
  assert(
    response.headers['access-control-allow-credentials'] === 'true',
    `${method} preflight did not allow credentials.`,
  );
  assert(
    String(response.headers['access-control-allow-methods']).includes(method),
    `${method} is absent from the CORS method allowlist.`,
  );
  assert(
    String(response.headers['access-control-allow-headers'])
      .toLowerCase()
      .includes('idempotency-key'),
    'Idempotency-Key is absent from the CORS header allowlist.',
  );
}

const invalidUuid = await request(app).get('/players/not-a-uuid');
assert(invalidUuid.status === 400, 'Malformed UUID route parameters must return 400.');
assert(
  invalidUuid.body.code === 'INVALID_ROUTE_PARAMETER',
  'Malformed UUID route parameters must use INVALID_ROUTE_PARAMETER.',
);

assert(
  discoveryQuerySchema.parse({ availableOnly: 'false' }).availableOnly === false,
  'availableOnly=false must remain false.',
);
assert(
  discoveryQuerySchema.parse({ availableOnly: 'true' }).availableOnly === true,
  'availableOnly=true must remain true.',
);

const coerciveBooleanAccepted = discoveryQuerySchema.safeParse({ availableOnly: '1' }).success;
assert(!coerciveBooleanAccepted, 'Non-boolean discovery values must be rejected.');

console.log('Slice 1 browser/API contract smoke test passed.');
