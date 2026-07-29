// Shared constants for hardhat tests.
//
// One source of truth for error tolerances (max acceptable difference between the
// Solidity implementation and the JS reference) and gas benchmarks (average gas
// per call across the sync'd grid, measured against defimath-compare). Tightening
// or loosening happens in this file — the test grids follow.
//
// Naming convention:
//   MAX_REL_ERROR_*  — relative error bound (|actual − expected| / |expected|)
//   MAX_ABS_ERROR_*  — absolute error bound (|actual − expected|)
//   AVG_GAS_*        — average gas per call on the module's perf-test grid

// ── Math primitives ──────────────────────────────────────────────────────────────────────
export const MAX_REL_ERROR_EXP        = 2.2e-14;   // when y = exp(x) ≥ 1
export const MAX_ABS_ERROR_EXP        = 3.0e-16;   // when y = exp(x) < 1 (near the root x=0)
export const AVG_GAS_EXP              = 289;

export const AVG_GAS_EXP_POSITIVE     = 223;       // internal fast path, no error metric (matches exp positive branch)

export const MAX_REL_ERROR_EXPM1      = 2.2e-14;   // when y = expm1(x) ≥ 1  (x ≥ ln2)
export const MAX_ABS_ERROR_EXPM1      = 5.0e-16;   // when y = expm1(x) < 1  (x < ln2, incl. the root x=0)
export const AVG_GAS_EXPM1            = 295;

export const MAX_REL_ERROR_LN         = 1.6e-15;   // when y = |ln(x)| ≥ 1
export const MAX_ABS_ERROR_LN         = 1.0e-15;   // when y = |ln(x)| < 1 (near the root x=1)
export const AVG_GAS_LN               = 390;

export const MAX_REL_ERROR_LOG1P      = 3.0e-15;   // when y = |log1p(x)| >= 1
export const MAX_ABS_ERROR_LOG1P      = 1.0e-15;   // when y = |log1p(x)| < 1
export const AVG_GAS_LOG1P            = 494;

export const AVG_GAS_LOG2             = 406;       // inherits ln's error metrics via ln(x) / ln(2)
export const AVG_GAS_LOG10            = 406;       // inherits ln's error metrics via ln(x) / ln(10)

export const MAX_REL_ERROR_SQRT       = 2.0e-18;   // when y = sqrt(x) ≥ 1, measured vs decimal.js (exact)
export const MAX_ABS_ERROR_SQRT       = 1.0e-18;   // when y = sqrt(x) < 1 — correctly rounded, i.e. off by at most 1 wei
export const AVG_GAS_SQRT             = 197;

export const MAX_REL_ERROR_CBRT       = 2.0e-13;   // when y = cbrt(x) ≥ 1
export const MAX_ABS_ERROR_CBRT       = 1.0e-16;   // when y = cbrt(x) < 1
export const AVG_GAS_CBRT             = 340;

export const MAX_REL_ERROR_POW        = 1.0e-12;   // when y = pow(x, a), |y| >= 1
export const MAX_ABS_ERROR_POW        = 1.0e-14;   // when y = pow(x, a), |y| < 1
export const AVG_GAS_POW              = 761;

export const MAX_ABS_ERROR_ERF        = 2.0e-15;   // always |y| <= 1, no relative error
export const AVG_GAS_ERF              = 649;

export const MAX_ABS_ERROR_CDF        = 3.0e-15;   // always y <= 1, no relative error
export const AVG_GAS_CDF              = 618;

// ── Math utilities (bit-level ops, no error metric) ──────────────────────────────────────
export const AVG_GAS_MULDIV           = 155;
export const AVG_GAS_ABS              = 17;
export const AVG_GAS_MIN              = 23;
export const AVG_GAS_MAX              = 23;
export const AVG_GAS_CLAMP            = 78;
export const AVG_GAS_AVG              = 21;
export const AVG_GAS_SQRT_TIME        = 163;

// ── Black-Scholes (vanilla, on a $1000 underlying) ─────────────────────────────────────────────
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
