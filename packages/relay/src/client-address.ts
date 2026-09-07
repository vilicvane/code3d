import type {IncomingMessage} from 'node:http';
import {isIP, SocketAddress} from 'node:net';

/** Only enable proxy trust on the private, unpublished Compose backend network. */
export function clientAddress(
  request: IncomingMessage,
  trustProxy: boolean,
): string {
  const value = trustProxy
    ? request.headers['x-real-ip']
    : request.socket.remoteAddress;
  if (typeof value !== 'string' || !isIP(value))
    throw new Error('A valid client IP is required.');
  return addressKey(value);
}

/** IPv4-mapped addresses share IPv4 quota; IPv6 privacy addresses share a /64. */
export function addressKey(value: string): string {
  const family = isIP(value);
  if (!family) throw new Error('Invalid IP address.');
  if (family === 4) return value;
  const address = SocketAddress.parse(`[${value}]:0`)!.address;
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4)
    return address.slice(7);
  const [prefix, suffix] = address.split('::');
  const left = prefix ? prefix.split(':') : [];
  const right = suffix ? suffix.split(':') : [];
  const words = address.includes('::')
    ? [
        ...left,
        ...Array<string>(8 - left.length - right.length).fill('0'),
        ...right,
      ]
    : left;
  return words.slice(0, 4).join(':') + '::/64';
}
