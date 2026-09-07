// Origin-side trust checks. The isolated client stands in for cloudflared on the
// private backend; live Cloudflare header handling is a public deployment check.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHostIdentity} from '@code3d/agent';
import WebSocket from 'ws';

export async function probeClientAddresses(relay, fetch) {
  let sequence = 0;
  const headers = ip => ({
    'cf-connecting-ip': ip,
    'x-forwarded-for': `198.51.100.${++sequence}`,
    'x-real-ip': `203.0.113.${sequence}`,
  });
  const http = async ip => {
    const response = await fetch(relay + '/unknown', {
      headers: headers(ip),
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    return response.status;
  };
  const invalid = await fetch(relay + '/unknown', {
    headers: {'x-real-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.1'},
  });
  assert.equal(
    invalid.status,
    400,
    'other proxy headers cannot supply visitor IP',
  );
  assert.equal(await http('192.0.2.1, 192.0.2.2'), 400);
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
  const socket = ip =>
    new WebSocket(
      relay.replace('http:', 'ws:') + `/sessions/${identity.sessionId}/host`,
      {headers: headers(ip), handshakeTimeout: 5000},
    );
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
    const ready = once(accepted, 'message', {
      signal: AbortSignal.timeout(5000),
    });
    accepted.send(JSON.stringify({type: 'host', token: identity.token}));
    assert.equal(JSON.parse((await ready)[0].toString()).type, 'ready');
    assert.equal(await http(available), 404);
    assert.equal(
      await http(available),
      429,
      'HTTP and WS must share visitor quota',
    );
    const closed = once(accepted, 'close', {signal: AbortSignal.timeout(5000)});
    accepted.ping();
    assert.equal(
      (await closed)[0],
      1008,
      'WS frames must retain the visitor IP',
    );
  } finally {
    accepted.terminate();
  }
  assert.equal(await http('192.0.2.3'), 404);
  for (let i = 0; i < 4; i++)
    assert.equal(await http('2001:db8:1234:1::1'), 404);
  assert.equal(await http('2001:db8:1234:1::2'), 429, 'IPv6 /64 shares quota');
  assert.equal(await http('2001:db8:1234:2::1'), 404);
  console.log(
    'CF visitor IPs, ignored XFF/X-Real-IP, shared HTTP/WS quota and IPv6 /64 passed.',
  );
}
