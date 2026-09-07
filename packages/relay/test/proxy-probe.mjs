// Executed by docker.mjs inside its isolated relay container. That container's
// exact IP is added only to the temporary Caddy trust list for this probe.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:https';
import {createHostIdentity} from '@code3d/agent';
import WebSocket from 'ws';

const tls = {
  ca: process.env.CODE3D_COMPOSE_TEST_CA,
  servername: 'localhost',
};
let sequence = 0;
function headers(ip) {
  return {
    host: 'localhost',
    'cf-connecting-ip': ip,
    // These untrusted headers must never influence the claimed visitor's quota.
    'x-forwarded-for': `198.51.100.${++sequence}`,
    'x-real-ip': `203.0.113.${sequence}`,
  };
}

function http(ip) {
  return new Promise((resolve, reject) => {
    const req = request(
      'https://gateway/unknown',
      {...tls, headers: headers(ip), signal: AbortSignal.timeout(5000)},
      res => {
        res.resume();
        res.on('error', reject);
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const exhausted = '192.0.2.1';
const available = '192.0.2.2';
for (let i = 0; i < 4; i++) assert.equal(await http(exhausted), 404);
assert.equal(
  await http(exhausted),
  429,
  'rotating XFF must not reset IP quota',
);
assert.equal(
  await http(available),
  404,
  'different visitors need separate quota',
);

const identity = await createHostIdentity();
function socket(ip) {
  return new WebSocket(`wss://gateway/sessions/${identity.sessionId}/host`, {
    ...tls,
    headers: headers(ip),
    handshakeTimeout: 5000,
  });
}

const rejected = socket(exhausted);
await new Promise((resolve, reject) => {
  rejected.on('error', reject);
  rejected.on('open', () => {
    rejected.close();
    reject(new Error('exhausted visitor must not open a WebSocket'));
  });
  rejected.on('unexpected-response', (_req, res) => {
    res.resume();
    rejected.terminate();
    resolve(assert.equal(res.statusCode, 429));
  });
});

const accepted = socket(available);
try {
  await once(accepted, 'open');
  const ready = once(accepted, 'message', {signal: AbortSignal.timeout(5000)});
  accepted.send(JSON.stringify({type: 'host', token: identity.token}));
  assert.equal(JSON.parse((await ready)[0].toString()).type, 'ready');
  assert.equal(await http(available), 404);
  assert.equal(
    await http(available),
    429,
    'HTTP and WSS must share visitor quota',
  );
  const closed = once(accepted, 'close', {signal: AbortSignal.timeout(5000)});
  accepted.ping();
  assert.equal(
    (await closed)[0],
    1008,
    'WSS frames must retain the visitor IP',
  );
} finally {
  accepted.terminate();
}

assert.equal(await http('192.0.2.3'), 404);
for (let i = 0; i < 4; i++) assert.equal(await http('2001:db8:1234:1::1'), 404);
assert.equal(await http('2001:db8:1234:1::2'), 429, 'IPv6 /64 shares quota');
assert.equal(await http('2001:db8:1234:2::1'), 404);
console.log(
  'Trusted Cloudflare visitor IPs, ignored XFF, shared HTTPS/WSS quota and IPv6 /64 passed.',
);
