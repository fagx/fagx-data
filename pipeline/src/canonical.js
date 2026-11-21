'use strict';
/**
 * Canonical JSON serialization for signed payloads.
 *
 * Rules (see docs/sobre-firmado.md):
 * - Object keys sorted recursively in code-point order.
 * - No whitespace between tokens.
 * - UTF-8 bytes of the resulting string are what gets base64-encoded
 *   into `payload_b64`.
 */

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

module.exports = { canonicalize, canonicalJson, canonicalBytes };
