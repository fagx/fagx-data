'use strict';
/**
 * Payload semantic checks shared by the pipeline and the published list.
 *
 * The published payload (v0.1) carries institucional + prefijos only.
 * Community numbers are aggregated for the v0.2 track (BE-03) and are
 * never part of the v0.1 payload.
 */

const INSTITUTIONAL_NUMBER = /^600[0-9]{6}$/;
const ALLOWED_PREFIXES = ['600', '809'];

/** Validate payload semantics. Returns { ok: true } or { ok: false, reason }. */
function checkPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'E_PAYLOAD_NOT_OBJECT' };
  }
  const required = ['schema_version', 'secuencia', 'generado_en', 'institucional', 'prefijos'];
  for (const field of required) {
    if (!(field in payload)) return { ok: false, reason: `E_MISSING_${field.toUpperCase()}` };
  }
  const extra = Object.keys(payload).filter((k) => !required.includes(k));
  if (extra.length > 0) return { ok: false, reason: 'E_UNKNOWN_FIELDS' };
  if (payload.schema_version !== 1) return { ok: false, reason: 'E_SCHEMA_VERSION' };
  if (!Number.isInteger(payload.secuencia) || payload.secuencia < 1) {
    return { ok: false, reason: 'E_SECUENCIA' };
  }
  if (!Number.isInteger(payload.generado_en) || payload.generado_en < 0) {
    return { ok: false, reason: 'E_GENERADO_EN' };
  }
  if (!Array.isArray(payload.institucional) || !payload.institucional.every((n) => typeof n === 'string' && INSTITUTIONAL_NUMBER.test(n))) {
    return { ok: false, reason: 'E_INSTITUCIONAL' };
  }
  if (new Set(payload.institucional).size !== payload.institucional.length) {
    return { ok: false, reason: 'E_INSTITUCIONAL_DUPLICADOS' };
  }
  if (!Array.isArray(payload.prefijos) || !payload.prefijos.every((p) => ALLOWED_PREFIXES.includes(p))) {
    return { ok: false, reason: 'E_PREFIJOS' };
  }
  return { ok: true };
}

/** List size for the shrink guard: every blocked entry the app applies. */
function listSize(payload) {
  if (!checkPayload(payload).ok) return null;
  return payload.institucional.length + payload.prefijos.length;
}

module.exports = { checkPayload, listSize, INSTITUTIONAL_NUMBER, ALLOWED_PREFIXES };
