// ============================================================
// ConjunctionEngine.js
//
// A dedicated, self-contained conjunction-analysis module.
// Given a set of "primary" objects (tracked satellites) and
// "secondary" objects (debris/rocket bodies), it predicts real
// closest-approach events over a forward time window using
// genuine SGP4 propagation — not a simple current-distance
// threshold check.
//
// Screening is deliberately staged, mirroring how real conjunction
// assessment pipelines are structured (coarse orbital filter ->
// coarse time-sampled ranking -> fine propagation -> local
// refinement), so it stays fast even with thousands of tracked
// objects while still approximating the true closest approach:
//
//   STAGE 1 — Orbital shell filter (broad phase)
//     Purely geometric, no propagation at all: derive each
//     object's perigee/apogee radius band from its mean motion
//     and eccentricity (real SGP4-consistent orbital mechanics,
//     via a = (xke / no)^(2/3)), and discard any pair whose
//     radius bands can never overlap. This is time-independent —
//     unlike a current-position distance check, it will not miss
//     a conjunction that occurs later in the window just because
//     the two objects happen to be far apart *right now*.
//
//   STAGE 2 — Coarse time-sampled ranking
//     For pairs that survive Stage 1, sample a handful of points
//     across the prediction window (real propagation, but sparse)
//     to rank candidates by rough minimum separation, and keep
//     only the closest few per primary.
//
//   STAGE 3 — Fine propagation + local refinement
//     For the short ranked candidate list: propagate both objects
//     together at a fine time step across the full window to find
//     the best coarse-fine sample, then perform two rounds of
//     local refinement (progressively narrowing the search window
//     and shrinking the timestep around that sample) to approximate
//     the true continuous-time closest approach — instead of just
//     reporting whichever fixed-grid point happened to be smallest.
//
// Distances are also converted into a physically meaningful
// "effective separation" by subtracting each object's representative
// hard-body radius before classifying risk — so risk reflects actual
// collision geometry, not a mathematical point-to-point distance.
//
// This is a simplified miss-distance model (not a full
// covariance-based probability-of-collision calculation like real
// CARA/CDMs use), but every distance, time, and velocity reported
// comes from genuine propagation — nothing here is fabricated.
// ============================================================

import * as satellite from "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm";

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function classifyRisk(km) {
  if (km < 1)   return "CRITICAL";
  if (km < 5)   return "HIGH";
  if (km < 25)  return "MEDIUM";
  if (km < 100) return "LOW";
  return "SAFE";
}

// Representative physical radius per object type, in meters. Real
// per-object dimensions aren't available from TLE data (SGP4 elements
// carry no size information), so these are typical/representative
// values for each category — not a measurement of any specific object.
// Used only to convert a raw center-to-center distance into a
// physically meaningful effective separation for risk classification.
const HARD_BODY_RADIUS_M = {
  satellite: 7.5,      // typical satellite bus, representative of the 5-10m range
  starlink: 7.5,
  "rocket-body": 11.5, // spent upper stage, representative of the 8-15m range
  debris: 1.5,         // tracked fragmentation debris, representative of the 0.5-3m range
};
const DEFAULT_HARD_BODY_RADIUS_M = 2;

export function getHardBodyRadiusM(type) {
  return HARD_BODY_RADIUS_M[type] ?? DEFAULT_HARD_BODY_RADIUS_M;
}

export class ConjunctionEngine {
  constructor(opts = {}) {
    this.windowMinutes          = opts.windowMinutes ?? 30;   // how far ahead to predict
    this.coarseSampleMinutes    = opts.coarseSampleMinutes ?? 10; // Stage 2 sampling interval
    this.fineStepSeconds        = opts.fineStepSeconds ?? 30;     // Stage 3 propagation resolution
    this.shellMarginKm          = opts.shellMarginKm ?? 50;       // Stage 1 overlap tolerance
    this.maxCandidatesPerPrimary = opts.maxCandidatesPerPrimary ?? 5;
    this.globalMaxFinePairs     = opts.globalMaxFinePairs ?? 250; // hard safety cap for large catalogs
    this._shellCache = new WeakMap(); // satrec -> { periRadiusKm, apoRadiusKm }
  }

  /* ---------------- Stage 1: orbital shell (broad phase) ---------------- */

  _orbitShell(satrec) {
    const cached = this._shellCache.get(satrec);
    if (cached) return cached;

    const { xke, earthRadius } = satellite.constants;
    // a = (xke / n)^(2/3), in Earth radii (standard SGP4 relation);
    // satrec.no is mean motion in radians/minute, satrec.ecco is eccentricity.
    const aEarthRadii = Math.pow(xke / satrec.no, 2 / 3);
    const aKm = aEarthRadii * earthRadius;

    const shell = {
      periRadiusKm: aKm * (1 - satrec.ecco),
      apoRadiusKm:  aKm * (1 + satrec.ecco),
    };
    this._shellCache.set(satrec, shell);
    return shell;
  }

  _shellsOverlap(satrecA, satrecB) {
    const a = this._orbitShell(satrecA);
    const b = this._orbitShell(satrecB);
    return (a.periRadiusKm - this.shellMarginKm) <= b.apoRadiusKm &&
           (b.periRadiusKm - this.shellMarginKm) <= a.apoRadiusKm;
  }

  /* ---------------- Stage 2: coarse time-sampled ranking ---------------- */

  _rankCandidates(primary, secondaries, baseTime) {
    const shellPass = secondaries.filter(s => this._shellsOverlap(primary.satrec, s.satrec));
    if (!shellPass.length) return [];

    const sampleOffsets = [];
    for (let t = 0; t <= this.windowMinutes * 60; t += this.coarseSampleMinutes * 60) sampleOffsets.push(t);

    const scored = [];
    for (const secondary of shellPass) {
      let roughMinKm = Infinity;
      for (const t of sampleOffsets) {
        const future = new Date(baseTime.getTime() + t * 1000);
        const pvA = satellite.propagate(primary.satrec, future);
        const pvB = satellite.propagate(secondary.satrec, future);
        if (!pvA.position || !pvB.position) continue;
        const km = dist3(pvA.position, pvB.position);
        if (km < roughMinKm) roughMinKm = km;
      }
      if (Number.isFinite(roughMinKm)) scored.push({ secondary, roughMinKm });
    }

    scored.sort((a, b) => a.roughMinKm - b.roughMinKm);
    return scored.slice(0, this.maxCandidatesPerPrimary).map(o => o.secondary);
  }

  /* ---------------- Stage 3: fine propagation + local refinement ---------------- */

  // Generic local minimum search: scans a symmetric window around
  // centerTimeMs at a fixed step (window / numSteps), returning the
  // sample with the smallest separation found. Used twice in sequence
  // by _fineScreen, each time with a smaller window and finer step,
  // which is what lets the reported closest approach converge toward
  // the true continuous-time minimum instead of stopping at whichever
  // fixed-grid point happened to be smallest.
  _refineMinimum(primary, secondary, centerTimeMs, halfWindowSeconds, numSteps) {
    const stepSeconds = (2 * halfWindowSeconds) / numSteps;
    let best = null;
    for (let i = 0; i <= numSteps; i++) {
      const tOffset = -halfWindowSeconds + i * stepSeconds;
      const future = new Date(centerTimeMs + tOffset * 1000);
      const pvA = satellite.propagate(primary.satrec, future);
      const pvB = satellite.propagate(secondary.satrec, future);
      if (!pvA.position || !pvB.position || !pvA.velocity || !pvB.velocity) continue;
      const km = dist3(pvA.position, pvB.position);
      if (!best || km < best.distanceKm) {
        best = { distanceKm: km, timeMs: future.getTime(), relativeVelocityKmS: dist3(pvA.velocity, pvB.velocity) };
      }
    }
    return best;
  }

  _fineScreen(primary, secondary, baseTime) {
    // 3a — original fixed-step coarse-fine grid (unchanged): scan the
    // full window at fineStepSeconds resolution to find a bracket that
    // contains the true minimum.
    let coarseBest = null;
    for (let t = 0; t <= this.windowMinutes * 60; t += this.fineStepSeconds) {
      const future = new Date(baseTime.getTime() + t * 1000);
      const pvA = satellite.propagate(primary.satrec, future);
      const pvB = satellite.propagate(secondary.satrec, future);
      if (!pvA.position || !pvB.position || !pvA.velocity || !pvB.velocity) continue;

      const km = dist3(pvA.position, pvB.position);
      if (!coarseBest || km < coarseBest.distanceKm) {
        coarseBest = { distanceKm: km, timeMs: future.getTime(), relativeVelocityKmS: dist3(pvA.velocity, pvB.velocity) };
      }
    }
    if (!coarseBest) return null;

    // 3b — local refinement: the true minimum can only lie within one
    // fineStepSeconds of the coarse winner (that's the definition of the
    // grid resolution), so search that bracket at 1-second resolution...
    let refined = this._refineMinimum(primary, secondary, coarseBest.timeMs, this.fineStepSeconds, this.fineStepSeconds) || coarseBest;
    // ...then narrow again to a 1-second bracket at 0.1-second resolution.
    refined = this._refineMinimum(primary, secondary, refined.timeMs, 1, 10) || refined;

    // Hard-body radius: convert the raw center-to-center closest approach
    // into a physically meaningful effective separation for risk purposes,
    // without altering the raw distance itself.
    const radiusPrimaryKm   = getHardBodyRadiusM(primary.type) / 1000;
    const radiusSecondaryKm = getHardBodyRadiusM(secondary.type) / 1000;
    const effectiveDistanceKm = Math.max(0, refined.distanceKm - (radiusPrimaryKm + radiusSecondaryKm));

    return {
      distanceKm: refined.distanceKm,     // raw center-to-center closest approach (unchanged meaning)
      effectiveDistanceKm,                 // NEW: accounts for combined hard-body radius
      tca: new Date(refined.timeMs),
      relativeVelocityKmS: refined.relativeVelocityKmS,
    };
  }

  /* ---------------- Public entry point ---------------- */

  /**
   * Run a full screening pass.
   * @param {Array} primaries   objects with { satrec, ... } — e.g. tracked satellites
   * @param {Array} secondaries objects with { satrec, ... } — e.g. debris/rocket bodies
   * @param {Date}  baseTime    prediction start time
   * @returns {{ perPrimary: Map, worst: object|null }}
   *   perPrimary maps each primary -> { distanceKm, effectiveDistanceKm, tca, relativeVelocityKmS, secondary } | null
   *   worst is the single riskiest result across all primaries (or null if none found)
   *   "Riskiest"/"best" here is ranked by effectiveDistanceKm (accounts for
   *   hard-body radius), not raw distanceKm — see requirement 3.
   */
  run(primaries, secondaries, baseTime = new Date()) {
    const perPrimary = new Map();
    let worst = null;
    let finePairsUsed = 0;

    for (const primary of primaries) {
      if (finePairsUsed >= this.globalMaxFinePairs) { perPrimary.set(primary, null); continue; }

      const candidates = this._rankCandidates(primary, secondaries, baseTime);
      if (!candidates.length) { perPrimary.set(primary, null); continue; }

      let best = null;
      for (const secondary of candidates) {
        if (finePairsUsed >= this.globalMaxFinePairs) break;
        finePairsUsed++;

        const r = this._fineScreen(primary, secondary, baseTime);
        if (r && (!best || r.effectiveDistanceKm < best.effectiveDistanceKm)) {
          best = { ...r, secondary };
        }
      }

      perPrimary.set(primary, best);
      if (best && (!worst || best.effectiveDistanceKm < worst.effectiveDistanceKm)) {
        worst = { primary, ...best };
      }
    }

    return { perPrimary, worst };
  }
}
