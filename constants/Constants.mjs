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

// ── Black-Scholes (vanilla) ──────────────────────────────────────────────────────────────
// Dual metric, same rule as the math primitives: relative where |result| ≥ 1, absolute where < 1.
export const MAX_REL_ERROR_OPTION     = 5e-12;     // when call/put price ≥ 1
export const MAX_ABS_ERROR_OPTION     = 1.3e-10;   // when call/put price < 1 (deep OTM), in $ at $1000 spot
export const AVG_GAS_CALL             = 2582;
export const AVG_GAS_PUT              = 2592;

export const MAX_ABS_ERROR_DELTA      = 1.2e-13;   // always |δ| ≤ 1, no relative error
export const AVG_GAS_DELTA            = 1661;

export const MAX_REL_ERROR_GAMMA      = 5e-12;     // when gamma ≥ 1 (low vol / short time)
export const MAX_ABS_ERROR_GAMMA      = 3.2e-15;   // when gamma < 1
export const AVG_GAS_GAMMA            = 1433;

export const MAX_REL_ERROR_THETA      = 5e-12;     // when |theta| ≥ 1 (per day)
export const MAX_ABS_ERROR_THETA      = 1.9e-12;   // when |theta| < 1
export const AVG_GAS_THETA            = 3101;

export const MAX_REL_ERROR_VEGA       = 5e-12;     // when vega ≥ 1 (per 1% vol)
export const MAX_ABS_ERROR_VEGA       = 4e-13;     // when vega < 1
export const AVG_GAS_VEGA             = 1373;

export const MAX_REL_ERROR_IV         = 1.0e-6;    // when recovered vol ≥ 1 — round-trip, Newton-Raphson convergence target
export const MAX_ABS_ERROR_IV         = 2e-6;      // when recovered vol < 1
export const AVG_GAS_IV_CALL          = 11668;
export const AVG_GAS_IV_PUT           = 11743;

// ── Binary (cash-or-nothing, unit-payout) ────────────────────────────────────────────────
// Abs-only, no relative metric: nothing here reaches the |result| ≥ 1 regime. Price is a
// discounted probability ∈ [0,1] (tops out at 1 only at the exact deep-ITM r=0 boundary),
// and the greeks stay ≪ 1 on the $1000-spot grid — delta/gamma carry 1/S and 1/S² factors,
// and the grid only pairs ultra-low vol / 1s time with far-OTM strikes where φ(d2) → 0.
// (Contrast Black-Scholes, where price and gamma/theta/vega cross 1 and need the dual rule.)
// Price worst-case ~9.5e-13: deep-OTM under 400% rate / 1844% vol, where true normCDF
// underflows to 0 but Solidity stdNormCDF leaves a tiny residual.
export const MAX_ABS_ERROR_BINARY       = 2e-12;   // call/put price (shared bound)
export const AVG_GAS_BINARY_CALL        = 1913;
export const AVG_GAS_BINARY_PUT         = 1918;

export const MAX_ABS_ERROR_BINARY_DELTA = 1e-13;
export const AVG_GAS_BINARY_DELTA       = 1717;

export const MAX_ABS_ERROR_BINARY_GAMMA = 1e-15;
export const AVG_GAS_BINARY_GAMMA       = 1859;

export const MAX_ABS_ERROR_BINARY_THETA = 1e-14;   // per day
export const AVG_GAS_BINARY_THETA       = 3161;

export const MAX_ABS_ERROR_BINARY_VEGA  = 1e-14;   // per 1% vol
export const AVG_GAS_BINARY_VEGA        = 1805;

// ── Futures ──────────────────────────────────────────────────────────────────────────────
// price = spot · e^(rτ): the error is fundamentally relative (inherits exp, scale-invariant).
export const MAX_REL_ERROR_FUTURE     = 2e-12;    // primary bound, enforced on the broad sweep
export const MAX_ABS_ERROR_FUTURE     = 1.2e-9;   // absolute error at a $1000 spot (scales with spot)

// ── Black-76 (options on a future) ──────────────────────────────────────────────────────
// Same dual metric and structure as Black-Scholes; prices a future underlying (d1 carries no rate
// term, whole payoff discounted by e^(-rτ)). Equivalently e^(-rτ) · Black-Scholes(spot = F, rate = 0).
export const MAX_REL_ERROR_B76_OPTION   = 5e-12;   // when call/put price ≥ 1
export const MAX_ABS_ERROR_B76_OPTION   = 1.3e-10; // when call/put price < 1 (deep OTM), in $ at $1000 future
export const AVG_GAS_B76_CALL           = 2552;
export const AVG_GAS_B76_PUT            = 2565;

export const MAX_ABS_ERROR_B76_DELTA    = 1.2e-13; // always |δ| ≤ 1, no relative error
export const AVG_GAS_B76_DELTA          = 1915;

export const MAX_REL_ERROR_B76_GAMMA    = 5e-12;   
export const MAX_ABS_ERROR_B76_GAMMA    = 3.2e-15;
export const AVG_GAS_B76_GAMMA          = 1704;

export const MAX_REL_ERROR_B76_THETA    = 5e-12;
export const MAX_ABS_ERROR_B76_THETA    = 1.9e-12;
export const AVG_GAS_B76_THETA          = 3255;

export const MAX_REL_ERROR_B76_VEGA     = 5e-12;
export const MAX_ABS_ERROR_B76_VEGA     = 4e-13;
export const AVG_GAS_B76_VEGA           = 1659;

export const MAX_REL_ERROR_B76_IV       = 1.0e-6;
export const MAX_ABS_ERROR_B76_IV       = 2e-6;
export const AVG_GAS_B76_IV_CALL        = 11760;
export const AVG_GAS_B76_IV_PUT         = 11802;

// ── Rates ────────────────────────────────────────────────────────────────────────────────
export const MAX_REL_ERROR_COMPOUND   = 5.4e-14;   // inherits exp's relative error
export const MAX_REL_ERROR_LOG_RETURN = 1.6e-15;   // inherits ln's relative error
export const MAX_ABS_ERROR_RATE_CONV  = 1e-15;     // Taylor branch precision for rate conversions
export const MAX_REL_ERROR_IRR        = 1e-9;      // Newton-Raphson convergence tolerance

// ── Stats (arithmetic aggregation) ───────────────────────────────────────────────────────
export const MAX_REL_ERROR_AGG        = 1e-15;     // arithmetic-only operations: essentially exact
export const MAX_REL_ERROR_STATS      = 2.2e-14;   // multi-step stats (variance→vol→sharpe) accumulate ~1.5e-14 vs the f64 reference
