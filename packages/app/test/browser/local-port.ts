import {createServer} from 'node:net';
import {once} from 'node:events';
import type {TestContext} from 'node:test';

/** Reserve fixture ports through the OS, including Windows/WSL exclusions. */
export async function reserveLocalPort(t: TestContext) {
  const server = createServer(socket => socket.destroy());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No local port.');
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  };
  t.after(release);
  return {port: address.port, release};
}
