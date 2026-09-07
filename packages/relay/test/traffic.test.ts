import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addressKey} from '../bld/client-address.js';
import {TrafficLimiter, parseTrafficOptions} from '../bld/traffic.js';

const MiB = 1024 * 1024;
const start = Date.UTC(2026, 8, 8, 12);

test('traffic bursts refill and rejected transfers do not spend other budgets', () => {
  let now = start;
  const limiter = new TrafficLimiter(
    {
      global: {burstMiB: 2, kibPerSecond: 1},
      ip: {burstMiB: 1, kibPerSecond: 1},
    },
    () => now,
  );
  assert.equal(limiter.take('alice', 'project', MiB), 0);
  assert.equal(limiter.take('alice', 'project', 1024), 1);
  assert.equal(limiter.take('bob', 'project', MiB), 0);
  now += 500;
  assert.equal(limiter.take('alice', 'project', 1024), 1);
  now += 500;
  assert.equal(limiter.take('alice', 'project', 1024), 0);
  assert.equal(limiter.take('bob', 'project', 1), 1);
});

test('session and IP daily quotas survive reconnects and new session IDs', () => {
  let now = start;
  const limiter = new TrafficLimiter(
    {ip: {dailyMiB: 2}, session: {dailyMiB: 1}},
    () => now,
  );
  assert.equal(limiter.take('alice', 'one', MiB), 0);
  assert.equal(limiter.take('alice', 'one', 1), 43200);
  assert.equal(limiter.take('bob', 'one', 1), 43200);
  assert.equal(limiter.take('alice', 'two', MiB), 0);
  assert.equal(limiter.take('alice', 'three', 1), 43200);
  assert.equal(limiter.take('bob', 'three', MiB), 0);
  now += 60 * 60 * 1000;
  limiter.sweep();
  assert.equal(limiter.take('alice', 'four', 1), 39600);
  now = Date.UTC(2026, 8, 9);
  limiter.sweep();
  assert.equal(limiter.take('alice', 'one', MiB), 0);
});

test('global byte and request limits still apply when clients rotate identities', () => {
  let now = start;
  const limiter = new TrafficLimiter(
    {global: {dailyMiB: 1, requestsPerSecond: 1, requestBurst: 2}},
    () => now,
  );
  assert.equal(limiter.take('alice', undefined, 0, 1), 0);
  assert.equal(limiter.take('bob', undefined, 0, 1), 0);
  assert.equal(limiter.take('carol', undefined, 0, 1), 1);
  now += 1000;
  assert.equal(limiter.take('carol', 'project', MiB, 1), 0);
  assert.equal(limiter.take('dave', 'other', 1), 43199);
});

test('tracking capacity never evicts spent daily quota to admit another identity', () => {
  let now = start;
  const limiter = new TrafficLimiter({maxSubjects: 2}, () => now);
  assert.equal(limiter.take('alice', 'one', 100), 0);
  assert.equal(limiter.take('bob', 'two', 100), 0);
  now += 3600_000;
  assert.ok(limiter.take('carol', 'three', 100) > 0);
  assert.equal(limiter.take('alice', 'one', 100), 0);
  now = Date.UTC(2026, 8, 9);
  assert.equal(limiter.take('carol', 'three', 100), 0);
});

test('inactive request-only entries can expire without discarding live byte budgets', () => {
  let now = start;
  const limiter = new TrafficLimiter({maxSubjects: 1}, () => now);
  assert.equal(limiter.take('alice', undefined, 0, 1), 0);
  assert.ok(limiter.take('bob', undefined, 0, 1) > 0);
  now += 10_000;
  assert.equal(limiter.take('bob', 'project', 100), 0);
  assert.ok(limiter.take('alice', 'project', 100) > 0);
});

test('client quota keys normalize IPv4 aliases and IPv6 /64 privacy addresses', () => {
  for (const value of ['192.0.2.1', '::ffff:192.0.2.1', '::ffff:c000:201'])
    assert.equal(addressKey(value), '192.0.2.1');
  assert.equal(
    addressKey('2001:db8:1:2::1'),
    addressKey('2001:0db8:0001:0002:ffff:aaaa:bbbb:cccc'),
  );
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.notEqual(addressKey('::1'), addressKey('127.0.0.1'));
  assert.throws(() => addressKey('unknown'));
});

test('operator limits reject typos, nonpositive limits and prototype keys', () => {
  assert.deepEqual(parseTrafficOptions({ip: {dailyMiB: 32}}), {
    ip: {dailyMiB: 32},
  });
  for (const value of [
    null,
    [],
    {typo: {}},
    {ip: null},
    {ip: {dailyMib: 5}},
    {ip: {dailyMiB: 0}},
    {ip: {kibPerSecond: Infinity}},
    {ip: {requestBurst: 0.5}},
    {maxSubjects: 0},
    JSON.parse('{"ip":{"__proto__":1}}'),
  ])
    assert.throws(() => parseTrafficOptions(value));
});
