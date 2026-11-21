'use strict';
/**
 * v0.2 track (BE-03): pure logic for the decrementable reporter window
 * (F-04) and the adaptive expired-deletion budget (F-03).
 *
 * These functions are pure so unit tests need no emulator; the pipeline
 * stages in pipeline.js apply them through a `store`.
 */

const { MODEL } = require('./quota');

const WINDOW_DAYS = 90; // Plan v0.1, P-16: retention lives in the pipeline, not a TTL
const WINDOW_SECONDS = WINDOW_DAYS * 86_400;

// --- F-04: ventana_reportantes { uid_hash -> last_report_en } ---

/**
 * Add (or slide) a reporter window entry. Decision D-V1: the entry keeps
 * the MOST RECENT report time, so re-reports slide it forward and the
 * prune horizon is "90 days since the reporter's last report of this
 * number". Keys are hashed reporter ids — raw uids never reach here.
 */
function windowAdd(ventana, uidHash, atEpoch) {
  if (typeof uidHash !== 'string' || uidHash.length === 0) {
    throw new TypeError('E_BAD_UID_HASH');
  }
  if (!Number.isInteger(atEpoch)) throw new TypeError('E_BAD_AT_EPOCH');
  const next = { ...ventana };
  next[uidHash] = Math.max(next[uidHash] ?? 0, atEpoch);
  return next;
}

/**
 * Prune entries older than the window. An entry survives when
 * `last + WINDOW_SECONDS > now`, mirroring report expiry
 * (`expira_en = creado_en + 90d`, deleted when `expira_en < now`).
 * Returns the kept window, how many entries dropped, and the resulting
 * distinct-reporter count (F-04: the window decrements as it prunes).
 */
function windowPrune(ventana, nowEpoch, windowSeconds = WINDOW_SECONDS) {
  const horizon = nowEpoch - windowSeconds; // drop at <= horizon
  const kept = {};
  let dropped = 0;
  for (const [uid, at] of Object.entries(ventana || {})) {
    if (Number(at) > horizon) kept[uid] = Number(at);
    else dropped += 1;
  }
  return { ventana: kept, dropped, reportantes: Object.keys(kept).length };
}

// --- F-03: adaptive budget for the expired-deletion queue ---

/**
 * Per-run delete cap for the expired queue. Decision D-F3: spread the
 * pending backlog across the remaining cleanup runs of the day, never
 * below one batch while anything is pending, never above the prudent
 * per-run cap. With no runs left (misconfiguration or backlog burst),
 * fail open at the prudent cap rather than stalling the queue.
 */
function adaptiveCap({ pending, runsRemainingToday }) {
  if (!Number.isInteger(pending) || pending < 0) throw new TypeError('E_BAD_PENDING');
  if (!Number.isInteger(runsRemainingToday) || runsRemainingToday < 0) {
    throw new TypeError('E_BAD_RUNS_REMAINING');
  }
  if (pending === 0) return 0;
  if (runsRemainingToday === 0) return MODEL.prudentCapPerRun;
  return Math.max(MODEL.batchSize, Math.min(MODEL.prudentCapPerRun, Math.ceil(pending / runsRemainingToday)));
}

/** Runs left today given the fixed schedule (MODEL.runsPerDay) — pure. */
function runsRemainingToday(nowEpoch, runsPerDay = MODEL.runsPerDay) {
  const slotLength = 86_400 / runsPerDay;
  const inDay = ((nowEpoch % 86_400) + 86_400) % 86_400;
  const slotIndex = Math.min(runsPerDay - 1, Math.floor(inDay / slotLength));
  // the slot in progress is the run being computed; the rest remain
  return runsPerDay - 1 - slotIndex;
}

module.exports = {
  WINDOW_DAYS,
  WINDOW_SECONDS,
  windowAdd,
  windowPrune,
  adaptiveCap,
  runsRemainingToday,
};
