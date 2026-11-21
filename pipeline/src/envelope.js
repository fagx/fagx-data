'use strict';
/**
 * Signed envelope for the published blocklist (docs/sobre-firmado.md).
 *
 * Envelope shape (blocklist.json as served by Pages):
 * {
 *   "format": "fagx-blocklist",
 *   "format_version": 1,
 *   "alg": "ES256",
 *   "key_id": "solo-test-2026-11",
 *   "payload_b64": "<base64 of canonical payload JSON, UTF-8>",
 *   "signature_b64": "<base64 of ECDSA(P-256) DER signature over the ASCII bytes of payload_b64>"
 * }
 *
 * The signature covers the exact `payload_b64` string (ASCII bytes), so
 * verification on the app side (JCA `SHA256withECDSA` over the base64
 * string) is unambiguous: no re-canonicalization happens before the
 * signature check. The keyring only ever holds public keys here; private
 * keys live in one of the three plan levels (solo-test committed keys,
 * beta key as Actions secret, production key pending P-09/Q3).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalBytes } = require('./canonical');

const ENVELOPE_FORMAT = 'fagx-blocklist';
const ENVELOPE_FORMAT_VERSION = 1;
const SUPPORTED_ALG = 'ES256';

/**
 * Load a keyring directory. Every subdirectory with a meta.json and a
 * public.pem becomes a key entry. `solo-test` marks committed disposable
 * test keys; beta/production keys never live in the repository.
 */
function loadKeyring(keysDir) {
  const keys = [];
  for (const entry of fs.readdirSync(keysDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(keysDir, entry.name);
    const metaPath = path.join(dir, 'meta.json');
    const pubPath = path.join(dir, 'public.pem');
    if (!fs.existsSync(metaPath) || !fs.existsSync(pubPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.alg !== SUPPORTED_ALG) {
      throw new Error(`keyring: unsupported alg in ${entry.name}`);
    }
    keys.push({
      key_id: meta.key_id,
      nivel: meta.nivel,
      nivelLabel: entry.name,
      publicPem: fs.readFileSync(pubPath, 'utf8'),
    });
  }
  if (keys.length === 0) throw new Error('keyring: no keys found');
  return { keys };
}

function keyFromKeyring(keyring, keyId) {
  return keyring.keys.find((k) => k.key_id === keyId) || null;
}

/** Sign a payload object with a private key. Returns the envelope object. */
function signEnvelope(payload, { privateKeyPem, keyId }) {
  const payloadB64 = canonicalBytes(payload).toString('base64');
  const signature = crypto.sign('sha256', Buffer.from(payloadB64, 'ascii'), {
    key: privateKeyPem,
    dsaEncoding: 'der',
  });
  return {
    format: ENVELOPE_FORMAT,
    format_version: ENVELOPE_FORMAT_VERSION,
    alg: SUPPORTED_ALG,
    key_id: keyId,
    payload_b64: payloadB64,
    signature_b64: signature.toString('base64'),
  };
}

/**
 * Verify an envelope against a keyring. Returns
 * { ok: true, payload } or { ok: false, reason }.
 *
 * The app-side contract (docs/sobre-firmado.md) rejects, before parsing
 * the payload: unknown key_id, alg !== ES256, bad signature. Payload
 * semantic checks (secuencia rollback, generado_en in the future,
 * schema_version) are the app's :core job and are kept out of here.
 */
function verifyEnvelope(envelope, keyring) {
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, reason: 'E_ENVELOPE_NOT_OBJECT' };
  }
  if (envelope.format !== ENVELOPE_FORMAT || envelope.format_version !== ENVELOPE_FORMAT_VERSION) {
    return { ok: false, reason: 'E_FORMAT' };
  }
  if (envelope.alg !== SUPPORTED_ALG) {
    return { ok: false, reason: 'E_ALG' };
  }
  if (typeof envelope.payload_b64 !== 'string' || typeof envelope.signature_b64 !== 'string') {
    return { ok: false, reason: 'E_FIELDS' };
  }
  const key = keyFromKeyring(keyring, envelope.key_id);
  if (!key) {
    return { ok: false, reason: 'E_UNKNOWN_KEY_ID' };
  }
  let signature;
  try {
    signature = Buffer.from(envelope.signature_b64, 'base64');
  } catch {
    return { ok: false, reason: 'E_SIGNATURE_ENCODING' };
  }
  let payloadBytes;
  try {
    payloadBytes = Buffer.from(envelope.payload_b64, 'base64');
  } catch {
    return { ok: false, reason: 'E_PAYLOAD_ENCODING' };
  }
  const valid = crypto.verify(
    'sha256',
    Buffer.from(envelope.payload_b64, 'ascii'),
    { key: key.publicPem, dsaEncoding: 'der' },
    signature,
  );
  if (!valid) {
    return { ok: false, reason: 'E_BAD_SIGNATURE' };
  }
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'E_PAYLOAD_JSON' };
  }
  return { ok: true, payload, key_id: key.key_id };
}

module.exports = {
  ENVELOPE_FORMAT,
  ENVELOPE_FORMAT_VERSION,
  SUPPORTED_ALG,
  loadKeyring,
  keyFromKeyring,
  signEnvelope,
  verifyEnvelope,
};
