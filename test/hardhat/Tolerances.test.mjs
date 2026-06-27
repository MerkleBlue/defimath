// Shared error-tolerance constants for hardhat tests.
//
// One source of truth for the maximum acceptable difference between the Solidity
// implementation and the JS reference, per module / function. Tightening or loosening
// happens in this file — the test grids follow.
//
// Naming convention:
//   MAX_REL_ERROR_*  — relative error bound (|actual − expected| / |expected|)
//   MAX_ABS_ERROR_*  — absolute error bound (|actual − expected|)
//
// Most thresholds are empirically calibrated against the typical test grid; comments
// note the dominant source of imprecision (JS reference ULP drift, Newton-Raphson
// convergence target, FP18 quantization, etc.).

// ── Math primitives ──────────────────────────────────────────────────────────────────────
export const MAX_REL_ERROR_EXP        = 5.4e-14;
export const MAX_REL_ERROR_LN         = 1.6e-15;
export const MAX_REL_ERROR_SQRT       = 2.2e-14;
export const MAX_REL_ERROR_SQRT_TIME  = 9e-15;
export const MAX_REL_ERROR_CBRT       = 1e-14;
export const MAX_REL_ERROR_POW        = 1e-11;
export const MAX_ABS_ERROR_ERF        = 4.5e-9;
export const MAX_ABS_ERROR_CDF        = 6.4e-15;

// ── Options (vanilla, on a $1000 underlying) ─────────────────────────────────────────────
export const MAX_OPTION_ABS_ERROR     = 1.3e-10;   // in $, for call/put price
export const MAX_DELTA_ABS_ERROR      = 1.2e-13;
export const MAX_GAMMA_ABS_ERROR      = 3.2e-15;
export const MAX_THETA_ABS_ERROR      = 1.9e-12;
export const MAX_VEGA_ABS_ERROR       = 4e-13;

// ── Binary (cash-or-nothing, unit-payout) ────────────────────────────────────────────────
// Price worst-case ~9.5e-13: deep-OTM under 400% rate / 1844% vol, where true normCDF
// underflows to 0 but Solidity stdNormCDF leaves a tiny residual.
export const MAX_BINARY_ABS_ERROR       = 2e-12;
export const MAX_BINARY_DELTA_ABS_ERROR = 1e-13;
export const MAX_BINARY_GAMMA_ABS_ERROR = 1e-15;
export const MAX_BINARY_THETA_ABS_ERROR = 1e-14;   // per day
export const MAX_BINARY_VEGA_ABS_ERROR  = 1e-14;   // per 1% vol

// ── Futures ──────────────────────────────────────────────────────────────────────────────
export const MAX_ABS_ERROR_FUTURE     = 1.2e-9;

// ── Rates ────────────────────────────────────────────────────────────────────────────────
export const MAX_REL_ERROR_COMPOUND   = 5.4e-14;   // inherits exp's relative error
export const MAX_REL_ERROR_LOG_RETURN = 1.6e-15;   // inherits ln's relative error
export const MAX_ABS_ERROR_RATE_CONV  = 1e-15;     // Taylor branch precision for rate conversions
export const MAX_REL_ERROR_IRR        = 1e-9;      // Newton-Raphson convergence tolerance

// ── Stats (arithmetic aggregation; sqrt re-exported above) ───────────────────────────────
export const MAX_REL_ERROR_AGG        = 1e-15;     // arithmetic-only operations: essentially exact
