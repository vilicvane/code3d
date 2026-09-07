import {readFile} from 'node:fs/promises';
import {createRelay} from './server.js';
import {parseTrafficOptions} from './traffic.js';

const port = Number(process.env.PORT ?? 3134);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer from 1 to 65535.');
const trustProxy = process.env.RELAY_TRUST_PROXY ?? 'false';
if (trustProxy !== 'true' && trustProxy !== 'false')
  throw new Error('RELAY_TRUST_PROXY must be true or false.');
const relay = createRelay({
  trustProxy: trustProxy === 'true',
  traffic: process.env.RELAY_LIMITS_FILE
    ? parseTrafficOptions(
        JSON.parse(await readFile(process.env.RELAY_LIMITS_FILE, 'utf8')),
      )
    : undefined,
});
relay.server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.info(`Code3D relay listening on port ${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void relay.close().catch(() => {
      process.exitCode = 1;
    });
  });
