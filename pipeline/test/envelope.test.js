'use strict';
/**
 * Round-trip sign/verify with the committed solo-test key, plus the
 * signature-level negative cases the app must reject:
 * tampered payload byte, unknown key_id, alg !== ES256, signature from
 * a different key.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { signEnvelope, verifyEnvelope, loadKeyring, keyFromKeyring } = require('../src/envelope');
const { canonicalBytes } = require('../src/canonical');

const KEYS = path.resolve(__dirname, '..', 'keys');
const keyring = loadKeyring(KEYS);

const PAYLOAD = {
  schema_version: 1,
  secuencia: 1,
  generado_en: 1795219200,
  institucional: [],
  prefijos: ['600', '809'],
};

const PRIV = fs.readFileSync(path.join(KEYS, 'solo-test', 'private.pem'), 'utf8');
const KEY = { privateKeyPem: PRIV, keyId: 'solo-test-2026-11' };

test('round-trip: sign with solo-test key verifies against the committed keyring', () => {
  const envelope = signEnvelope(PAYLOAD, KEY);
  const result = verifyEnvelope(envelope, keyring);
  assert.equal(result.ok, true, `verification failed: ${result && result.reason}`);
  assert.deepEqual(result.payload, PAYLOAD);
  assert.equal(result.key_id, 'solo-test-2026-11');
});

test('canonical payload is deterministic (sorted keys, no whitespace)', () => {
  const a = canonicalBytes({ b: 2, a: { d: 4, c: 3 } }).toString('utf8');
  const b = canonicalBytes({ a: { c: 3, d: 4 }, b: 2 }).toString('utf8');
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":4},"b":2}');
});

test('negative: tampered payload byte fails verification', () => {
  const envelope = signEnvelope(PAYLOAD, KEY);
  const bytes = Buffer.from(envelope.payload_b64, 'base64');
  // flip a byte in the last character of the JSON (before the closing brace)
  const idx = bytes.length - 3;
  bytes[idx] = bytes[idx] === 0x39 ? 0x38 : 0x39; // flip digit '9' <-> '8'
  envelope.payload_b64 = bytes.toString('base64');
  const result = verifyEnvelope(envelope, keyring);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'E_BAD_SIGNATURE');
});

test('negative: unknown key_id is rejected before signature work', () => {
  const envelope = signEnvelope(PAYLOAD, KEY);
  envelope.key_id = 'unknown-key-9999';
  const result = verifyEnvelope(envelope, keyring);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'E_UNKNOWN_KEY_ID');
});

test('negative: alg other than ES256 is rejected', () => {
  const envelope = signEnvelope(PAYLOAD, KEY);
  envelope.alg = 'RS256';
  const result = verifyEnvelope(envelope, keyring);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'E_ALG');
});

test('negative: signature made by a different key fails', () => {
  const other = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const envelope = signEnvelope(PAYLOAD, { privateKeyPem: other.privateKey, keyId: 'solo-test-2026-11' });
  const result = verifyEnvelope(envelope, keyring);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'E_BAD_SIGNATURE');
});

test('keyring exposes only public keys; solo-test is marked disposable', () => {
  assert.equal(keyring.keys.length, 1);
  assert.equal(keyring.keys[0].key_id, 'solo-test-2026-11');
  assert.equal(keyring.keys[0].nivel, 'solo-test');
  assert.equal(keyFromKeyring(keyring, 'solo-test-2026-11').publicPem.includes('BEGIN PUBLIC KEY'), true);
});
