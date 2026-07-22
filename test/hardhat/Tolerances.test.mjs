// Shared error-tolerance constants for hardhat tests.
//
// One source of truth for the maximum acceptable difference between the Solidity
// implementation and the JS reference, per module / function. Tightening or loosening
// happens in this file — the test grids follow.
//
// Naming convention:
//   MAX_REL_ERROR_*  — relative error bound (|actual − expected| / |expected|)
//   MAX_ABS_ERROR_*  — absolute error bound (|actual − expected|)

// ── Math primitives ──────────────────────────────────────────────────────────────────────
export const MAX_REL_ERROR_EXP        = 2.2e-14;   // when y = exp(x) ≥ 1
export const MAX_ABS_ERROR_EXP        = 3.0e-16;   // when y = exp(x) < 1 (near the root x=0)

// expm1 crosses |result| = 1 at x = ln2 (it never reaches -1, so x < ln2 is the whole
// absolute band). It cannot reuse exp's bounds: its absolute band runs up to x = ln2
// where exp(x) → 2, so it carries ~2× exp's absolute error.
export const MAX_REL_ERROR_EXPM1      = 2.2e-14;   // when y = expm1(x) ≥ 1  (x ≥ ln2)
export const MAX_ABS_ERROR_EXPM1      = 5.0e-16;   // when y = expm1(x) < 1  (x < ln2, incl. the root x=0)

export const MAX_REL_ERROR_LN         = 1.6e-15;   // when y = |ln(x)| ≥ 1
export const MAX_ABS_ERROR_LN         = 1.0e-15;   // when y = |ln(x)| < 1 (near the root x=1)

export const MAX_REL_ERROR_SQRT       = 2.0e-18;   // when y = sqrt(x) ≥ 1, measured vs decimal.js (exact)
export const MAX_ABS_ERROR_SQRT       = 1.0e-18;   // when y = sqrt(x) < 1 — correctly rounded, i.e. off by at most 1 wei

export const MAX_REL_ERROR_CBRT       = 2.0e-13;   // when y = cbrt(x) ≥ 1
export const MAX_ABS_ERROR_CBRT       = 1.0e-16;   // when y = cbrt(x) < 1 

export const MAX_REL_ERROR_POW        = 1.0e-11;   // todo: switch to abs/rel errors for functions below 

export const MAX_ABS_ERROR_ERF        = 2.0e-14;

export const MAX_ABS_ERROR_CDF        = 6.4e-15;

// ── Options (vanilla, on a $1000 underlying) ─────────────────────────────────────────────
export const MAX_ABS_ERROR_OPTION     = 1.3e-10;   // in $, for call/put price
export const MAX_ABS_ERROR_DELTA      = 1.2e-13;
export const MAX_ABS_ERROR_GAMMA      = 3.2e-15;
export const MAX_ABS_ERROR_THETA      = 1.9e-12;
export const MAX_ABS_ERROR_VEGA       = 4e-13;
export const MAX_REL_ERROR_IV         = 1.0e-6;    // round-trip relative: price → impliedVolatility → vol; Newton-Raphson convergence target

// ── Binary (cash-or-nothing, unit-payout) ────────────────────────────────────────────────
// Price worst-case ~9.5e-13: deep-OTM under 400% rate / 1844% vol, where true normCDF
// underflows to 0 but Solidity stdNormCDF leaves a tiny residual.
export const MAX_ABS_ERROR_BINARY       = 2e-12;
export const MAX_ABS_ERROR_BINARY_DELTA = 1e-13;
export const MAX_ABS_ERROR_BINARY_GAMMA = 1e-15;
export const MAX_ABS_ERROR_BINARY_THETA = 1e-14;   // per day
export const MAX_ABS_ERROR_BINARY_VEGA  = 1e-14;   // per 1% vol

// ── Futures ──────────────────────────────────────────────────────────────────────────────
export const MAX_ABS_ERROR_FUTURE     = 1.2e-9;

// ── Rates ────────────────────────────────────────────────────────────────────────────────
export const MAX_REL_ERROR_COMPOUND   = 5.4e-14;   // inherits exp's relative error
export const MAX_REL_ERROR_LOG_RETURN = 1.6e-15;   // inherits ln's relative error
export const MAX_ABS_ERROR_RATE_CONV  = 1e-15;     // Taylor branch precision for rate conversions
export const MAX_REL_ERROR_IRR        = 1e-9;      // Newton-Raphson convergence tolerance

// ── Stats (arithmetic aggregation) ───────────────────────────────────────────────────────
export const MAX_REL_ERROR_AGG        = 1e-15;     // arithmetic-only operations: essentially exact
export const MAX_REL_ERROR_STATS      = 2.2e-14;   // multi-step stats (variance→vol→sharpe) accumulate ~1.5e-14 vs the f64 reference
