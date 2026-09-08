import {type AgentConfig} from '@code3d/agent';
import {createLocalBridge} from './bridge.js';

/** The owning session keeps stdin/PTY open; ending it closes the local listener. */
export async function runServe(config: AgentConfig): Promise<void> {
  let finish!: () => void;
  let reason: string | undefined;
  const finished = new Promise<void>(resolve => {
    finish = resolve;
  });
  const stop = (value: string) => {
    reason ??= value;
    finish();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const listeners = signals.map(signal => ({
    signal,
    listener: () => stop(signal),
  }));
  const closed = () => stop('stdin_closed');
  for (const {signal, listener} of listeners) process.once(signal, listener);
  for (const event of ['end', 'close', 'error'])
    process.stdin.once(event, closed);
  process.stdin.resume();
  if (process.stdin.readableEnded || process.stdin.destroyed) closed();
  let bridge: Awaited<ReturnType<typeof createLocalBridge>> | undefined;
  try {
    bridge = await createLocalBridge(config);
    if (!reason)
      process.stdout.write(
        JSON.stringify({
          ok: true,
          event: 'listening',
          host: '127.0.0.1',
          port: config.port,
        }) + '\n',
      );
    await finished;
  } finally {
    for (const {signal, listener} of listeners) process.off(signal, listener);
    for (const event of ['end', 'close', 'error'])
      process.stdin.off(event, closed);
    await bridge?.close();
    process.stdin.pause();
    if (bridge && reason)
      process.stdout.write(
        JSON.stringify({
          ok: true,
          event: 'stopped',
          reason,
          ...(reason === 'stdin_closed'
            ? {
                message:
                  'The owning session closed stdin. Keep stdin or a PTY open when starting serve with the session-managed process tool.',
              }
            : {}),
        }) + '\n',
      );
  }
}
