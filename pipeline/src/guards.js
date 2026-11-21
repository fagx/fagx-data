'use strict';
/**
 * Operational guards for list publication (docs/runbook.md).
 *
 * Shrink guard: a published list must not shrink by more than 50% in a
 * single publication. A genuine, intentional shrink is done with
 * `--allow-shrink` in a supervised run and documented in the PR (see
 * runbook). In CI the guard always runs without the override.
 */

/**
 * @param {number} previousCount entries in the currently published list
 * @param {number} nextCount entries in the candidate list
 * @param {{minRatio?: number, allowShrink?: boolean}} [opts]
 * @returns {{ok: boolean, ratio: number|null, reason?: string}}
 */
function shrinkGuard(previousCount, nextCount, opts = {}) {
  const minRatio = opts.minRatio ?? 0.5;
  if (!Number.isInteger(previousCount) || previousCount < 0 || !Number.isInteger(nextCount) || nextCount < 0) {
    return { ok: false, ratio: null, reason: 'E_BAD_COUNTS' };
  }
  if (previousCount === 0) return { ok: true, ratio: null };
  const ratio = nextCount / previousCount;
  if (ratio < minRatio && !opts.allowShrink) {
    return { ok: false, ratio, reason: 'E_SHRINK_GT_50PCT' };
  }
  return { ok: true, ratio };
}

module.exports = { shrinkGuard };
