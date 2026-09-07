import {createRelay} from './server.js';

const port = Number(process.env.PORT ?? 3134);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer from 1 to 65535.');
const relay = createRelay();
relay.server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.info(`Code3D relay listening on port ${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void relay.close().catch(() => {
      process.exitCode = 1;
    });
  });
