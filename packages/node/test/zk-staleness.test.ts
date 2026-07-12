import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zkEncrypt, zkDecrypt } from '../src/zk.js';
import { decideOnFetchFailure, cacheIsFresh } from '../src/staleness.js';

const id = { vaultPass: 'hunter2', teamId: 'TEAM123456', bundleId: 'com.example.app' };

test('ZK round trip (CLI-compatible format: nonce||ciphertext||tag, v2 salt)', () => {
  const plain = JSON.stringify({ apiKey: 'sk-secret', flags: { x: true } });
  const blob = zkEncrypt(Buffer.from(plain), id);
  assert.equal(zkDecrypt(blob, id).toString('utf8'), plain);
});

test('ZK decrypt fails closed on wrong password, wrong app identity, or tampering', () => {
  const blob = zkEncrypt(Buffer.from('{"a":1}'), id);
  assert.throws(() => zkDecrypt(blob, { ...id, vaultPass: 'wrong' }));
  // Per-customer salt: same password, different app → different key.
  assert.throws(() => zkDecrypt(blob, { ...id, bundleId: 'com.other.app' }));
  const bytes = Buffer.from(blob, 'base64');
  bytes[14] ^= 0xff; // flip a ciphertext bit — GCM tag must reject it
  assert.throws(() => zkDecrypt(bytes.toString('base64'), id));
  assert.throws(() => zkDecrypt('dG9vc2hvcnQ=', id), /too short/);
});

test('staleness decision table', () => {
  assert.deepEqual(decideOnFetchFailure('failHard', true), { action: 'throw' });
  assert.deepEqual(decideOnFetchFailure('warnAndUse', true), { action: 'use-cache', warn: true });
  assert.deepEqual(decideOnFetchFailure('useSilently', true), { action: 'use-cache', warn: false });
  // No cache → always throw, regardless of policy.
  assert.deepEqual(decideOnFetchFailure('useSilently', false), { action: 'throw' });
  assert.deepEqual(decideOnFetchFailure('warnAndUse', false), { action: 'throw' });
});

test('freshness window', () => {
  assert.equal(cacheIsFresh(1000, 500, 1400), true);
  assert.equal(cacheIsFresh(1000, 500, 1501), false);
  assert.equal(cacheIsFresh(1000, undefined, 1001), false); // no window → always revalidate
});
