'use strict';
/**
 * Payload semantic checks shared by the pipeline and the published list.
 *
 * The published payload (v0.1) carries institucional + prefijos only.
 * Community numbers are aggregated for the v0.2 track (BE-03) and are
 * never part of the v0.1 payload.
 *
 * v1 payload shape (FAG-28 / criterio SEC-01 §6): institutional entries
 * carry both delivery forms — `numero` (national canonical, 600+7) and
 * `numero_e164` ('56' + numero) — so the D4 exclusion is immune to the
 * carrier delivery variant. Institutional `rangos` exist in the Fase 0
 * schema but are always empty in v0.1 (the seed is exact numbers only).
 */

const INSTITUTIONAL_NUMBER = /^600[0-9]{7}$/;
const INSTITUTIONAL_E164 = /^56600[0-9]{7}$/;
const ALLOWED_PREFIXES = ['600', '809'];

/** Validate one institutional entry ({ numero, numero_e164 }). Returns null or a reason. */
function checkInstitucionalEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'E_INSTITUCIONAL';
  const keys = Object.keys(entry);
  if (keys.length !== 2 || !('numero' in entry) || !('numero_e164' in entry)) return 'E_INSTITUCIONAL';
  if (typeof entry.numero !== 'string' || !INSTITUTIONAL_NUMBER.test(entry.numero)) return 'E_INSTITUCIONAL';
  if (typeof entry.numero_e164 !== 'string' || !INSTITUTIONAL_E164.test(entry.numero_e164)) return 'E_INSTITUCIONAL';
  if (entry.numero_e164 !== '56' + entry.numero) return 'E_INSTITUCIONAL';
  return null;
}

/** Validate the institutional object ({ numeros, rangos }). Returns null or a reason. */
function checkInstitucional(institucional) {
  if (!institucional || typeof institucional !== 'object' || Array.isArray(institucional)) {
    return 'E_INSTITUCIONAL';
  }
  const keys = Object.keys(institucional);
  if (keys.length !== 2 || !('numeros' in institucional) || !('rangos' in institucional)) {
    return 'E_INSTITUCIONAL';
  }
  const numeros = institucional.numeros;
  if (!Array.isArray(numeros)) return 'E_INSTITUCIONAL';
  for (const entry of numeros) {
    const reason = checkInstitucionalEntry(entry);
    if (reason) return reason;
  }
  const byNumero = new Set(numeros.map((e) => e.numero));
  if (byNumero.size !== numeros.length) return 'E_INSTITUCIONAL_DUPLICADOS';
  const byE164 = new Set(numeros.map((e) => e.numero_e164));
  if (byE164.size !== numeros.length) return 'E_INSTITUCIONAL_DUPLICADOS';
  // v0.1 publishes exact institutional numbers only; empty rangos is the
  // Fase 0 shape (institutional ranges) with no entries yet.
  if (!Array.isArray(institucional.rangos) || institucional.rangos.length > 0) {
    return 'E_INSTITUCIONAL_RANGOS';
  }
  return null;
}

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
  const instReason = checkInstitucional(payload.institucional);
  if (instReason) return { ok: false, reason: instReason };
  if (!Array.isArray(payload.prefijos) || !payload.prefijos.every((p) => ALLOWED_PREFIXES.includes(p))) {
    return { ok: false, reason: 'E_PREFIJOS' };
  }
  return { ok: true };
}

/** List size for the shrink guard: every blocked entry the app applies. */
function listSize(payload) {
  if (!checkPayload(payload).ok) return null;
  return (
    payload.institucional.numeros.length +
    payload.institucional.rangos.length +
    payload.prefijos.length
  );
}

module.exports = {
  checkPayload,
  listSize,
  INSTITUTIONAL_NUMBER,
  INSTITUTIONAL_E164,
  ALLOWED_PREFIXES,
};
