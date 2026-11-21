'use strict';
/**
 * Simulated Firestore quota budget for the pipeline (Spark free tier).
 *
 * All numbers are plan-level constants (Plan v0.1 and Fase 0 verdict);
 * they are exercised with fictitious volumes (1,000/day and 10,000/day)
 * as a CI guard. Real consumption is recorded per publication in
 * builds/ (counts and hashes, never numbers).
 *
 * Model per day at a sustained volume of N reports/day:
 * - Reads: cursor read (1) + N new reports (query) + aggregate doc reads
 *   (~1 per affected number; ~2% of N, to be measured in builds/).
 * - Writes: aggregate doc writes (~1 per affected number) + pipeline
 *   status (1) + builds/ log (1).
 * - Deletes: at steady state N reports/day expire (90-day window). The
 *   cleanup stage deletes with adaptive batches (F-03): batches of 500,
 *   up to a prudent per-run cap, across the daily runs, staying under
 *   the 20,000 deletes/day Spark quota. Pending expired reports above
 *   the alert threshold raise an operational alert (runbook).
 */

const QUOTAS = {
  readsPerDay: 50_000,
  writesPerDay: 20_000,
  deletesPerDay: 20_000,
};

const MODEL = {
  aggregateUniqueness: 0.02, // affected numbers / reports, plan estimate
  runsPerDay: 4, // scheduled cleanup runs (keeps workflows active, G3)
  batchSize: 500, // Firestore batch limit
  prudentCapPerRun: 4_500, // adaptive-batch prudent cap
  pendingAlertThreshold: 10_000,
};

/** Adaptive-batch delete capacity per day (F-03). */
function deleteCapacityPerDay() {
  return MODEL.runsPerDay * MODEL.prudentCapPerRun;
}

/**
 * @param {number} reportsPerDay sustained fictitious volume
 * @param {{pendingExpired?: number}} [opts]
 * @returns {{ok: boolean, reads: number, writes: number, deletes: number,
 *            deleteCapacity: number, alerts: string[]}}
 */
function quotaBudget(reportsPerDay, opts = {}) {
  if (!Number.isInteger(reportsPerDay) || reportsPerDay < 0) {
    return { ok: false, reads: null, writes: null, deletes: null, deleteCapacity: null, alerts: ['E_BAD_VOLUME'] };
  }
  const pendingExpired = opts.pendingExpired ?? 0;
  const affectedNumbers = Math.ceil(reportsPerDay * MODEL.aggregateUniqueness);
  const reads = 1 + reportsPerDay + affectedNumbers;
  const writes = affectedNumbers + 2; // aggregates + status + builds log
  const deletes = reportsPerDay; // steady state: everything expires within 90 days
  const deleteCapacity = deleteCapacityPerDay();
  const alerts = [];
  if (pendingExpired > MODEL.pendingAlertThreshold) {
    alerts.push(`ALERT_PENDING_EXPIRED:${pendingExpired}`);
  }
  const ok =
    reads <= QUOTAS.readsPerDay &&
    writes <= QUOTAS.writesPerDay &&
    deletes <= deleteCapacity &&
    deleteCapacity <= QUOTAS.deletesPerDay;
  return { ok, reads, writes, deletes, deleteCapacity, alerts };
}

module.exports = { QUOTAS, MODEL, quotaBudget, deleteCapacityPerDay };
