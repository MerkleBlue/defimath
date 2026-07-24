# DeFiMath [![License: MIT][license-badge]][license]

[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

![Tests](https://github.com/MerkleBlue/defimath/actions/workflows/test.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/defimath-lib.svg)](https://www.npmjs.com/package/defimath-lib)
[![npm downloads](https://img.shields.io/npm/dm/defimath-lib.svg)](https://www.npmjs.com/package/defimath-lib)
[![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.31-blue.svg)](https://soliditylang.org)

> Gas-optimized Solidity library for DeFi math. Black-Scholes option pricing at **2,582 gas**, with a broad set of primitives across math, interest rates, statistics, and derivatives.

[DeFiMath](https://defimath.com) is a pure-Solidity library of DeFi math primitives. 40+ functions across four modules: low-level math, derivatives, interest rates, and statistics. No external runtime dependencies. MIT-licensed.

## Why DeFiMath

- **Unlocks new use cases.** Gas-efficient enough to make real-time options pricing, on-chain IV solving on every quote, and risk-adjusted vault fees economically viable. Use cases that were previously off-chain workarounds now fit in a single transaction.
- **Breadth.** 40+ primitives spanning math (`exp`, `ln`, `sqrt`), derivatives (Black-Scholes + Greeks, binary options, IV solver), interest rates (compound, present value, IRR, YTM), and statistics (volatility, Sharpe, VaR, CVaR, max drawdown).
- **Pure Solidity.** ~16KB published, zero runtime dependencies, easy to audit.
- **Validated precision.** Sub-1e-10 absolute error on options pricing. Every math primitive carries an explicit, enforced error bound — from 2e-18 (`sqrt`) to 1e-12 (`pow`) — measured as relative error where the result is ≥ 1 and absolute error near a root or for bounded functions like `stdNormCDF` and `erf`; see the per-function tables below. Validated against `simple-statistics`, `black-scholes`, `greeks`, and `math-erf` reference libraries.

## Benchmarks

Every function is benchmarked against existing on-chain implementations. A representative comparison:

| Function | DeFiMath | Next best | Multiple |
| :------- | -------: | --------: | -------: |
| `callOptionPrice` | **2,582** | 13,360 (Derivexyz) | **5.2×** |
| `putOptionPrice`  | **2,592** | 13,363 (Derivexyz) | **5.2×** |
| `binaryCallPrice` | **1,913** | 16,218 (Haptic)    | **8.5×** |
| `delta`           | **1,661** | 8,621 (Derivexyz)  | **5.2×** |
| `vega`            | **1,373** | 7,490 (Derivexyz)  | **5.5×** |
| `ln`              | **390**   | 518 (Solady)       | 1.3× |
| `sqrt`            | **197**   | 384 (Solady)       | **1.9×** |
| `cbrt`            | **340**   | 550 (Solady)       | **1.6×** |
| `stdNormCDF`      | **618**   | 3,103 (SolStat)    | **5.0×** |

Full per-function tables in the [defimath-compare README](https://github.com/MerkleBlue/defimath-compare#readme).

## Install

### Hardhat / npm

```bash
npm install defimath-lib
```

### Foundry

```bash
forge install defimath-lib=MerkleBlue/defimath
```

Then add to `remappings.txt`:

```
defimath-lib/=lib/defimath-lib/
```

The `defimath-lib=` install alias plus this remapping make the same `import "defimath-lib/contracts/derivatives/Options.sol"` line work under both Foundry and Hardhat. Without the remapping, Foundry auto-detects `contracts/` as the src directory and produces `defimath-lib/=lib/defimath-lib/contracts/`, which collides with the leading `contracts/` segment in the import path.

Either way, your project must target **Solidity `^0.8.31`** and **`evmVersion: "osaka"`** (Fusaka). The library uses the `clz` Yul builtin (added in Solidity 0.8.31) which emits the `CLZ` opcode introduced in Osaka — both the compiler version and EVM target are hard requirements.

## Usage

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "defimath-lib/contracts/derivatives/Options.sol";

contract OptionsExchange {
    function quote(
        uint128 spot, uint128 strike, uint32 timeToExp,
        uint64 vol, uint64 rate
    ) external pure returns (uint256 callPx, uint256 putPx) {
        callPx = DeFiMathOptions.callOptionPrice(spot, strike, timeToExp, vol, rate);
        putPx  = DeFiMathOptions.putOptionPrice(spot, strike, timeToExp, vol, rate);
    }
}
```

All values use 18-decimal fixed-point (`1e18 = 1.0`). Time is in seconds. See module docs for full parameter conventions.

## Functions

### Math primitives — `DeFiMath` (Math.sol)

| Function | Gas | Max abs error | Max rel error | Description |
| :------- | --: | ------------: | ------------: | :---------- |
| `exp`        | 289  | 3.0e-16 | 2.2e-14 | Exponential function `e^x` |
| `ln`         | 390  | 1.0e-15 | 1.6e-15 | Natural logarithm |
| `log2`       | 406  | 1.0e-15 | 1.6e-15 | Base-2 logarithm |
| `log10`      | 406  | 1.0e-15 | 1.6e-15 | Base-10 logarithm |
| `pow`        | 761  | 1.0e-14 | 1.0e-12 | Power function `x^a` |
| `sqrt`       | 197  | 1.0e-18 | 2.0e-18 | Square root |
| `cbrt`       | 340  | 1.0e-16 | 2.0e-13 | Cube root |
| `expm1`      | 295  | 5.0e-16 | 2.2e-14 | `e^x − 1` (precision-preserving for small x) |
| `log1p`      | 494  | 1.0e-15 | 3.0e-15 | `ln(1 + x)` (precision-preserving for small x) |
| `stdNormCDF` | 618  | 3.0e-15 |       — | Standard normal CDF Φ(x) |
| `erf`        | 649  | 2.0e-15 |       — | Error function |
| `mulDiv`     | 155  |   exact |   exact | `(a · b) / d` with full 512-bit intermediate precision |
| `mul`        | 130  |   exact |   exact | `(a · b) / 1e18` — fixed-point multiply with denominator baked in |
| `abs`        | 17   |   exact |   exact | Branchless `\|int256\|` (handles `int256.min` cleanly) |
| `min`        | 23   |   exact |   exact | Branchless minimum of two `uint256` |
| `max`        | 23   |   exact |   exact | Branchless maximum of two `uint256` |
| `clamp`      | 78   |   exact |   exact | Clamp `x` into `[lo, hi]` (composed `max` then `min`) |
| `avg`        | 21   |   exact |   exact | Overflow-safe `(a + b) / 2` via `(a & b) + ((a ^ b) >> 1)` |

*Figures are the error bounds the test suite enforces — the constants in [`test/hardhat/Tolerances.test.mjs`](test/hardhat/Tolerances.test.mjs), asserted against a JS / decimal.js reference across each function's full documented domain. The metric follows the **result** magnitude: **relative** where `|result| ≥ 1`, **absolute** where `|result| < 1`. Relative error is undefined at a function's root (`ln` at `x = 1`, `expm1`/`log1p` at `x = 0`), where any nonzero error divides by ~0 — absolute is the meaningful bound there. Both are published wherever the suite bounds both. `—` marks a metric the suite does not bound: `erf` and `stdNormCDF` are bounded in [−1, 1] and [0, 1] so only absolute is meaningful. `sqrt`'s absolute bound of `1.0e-18` is exactly 1 wei — it is correctly rounded below 1. `log2`, `log10` and `log1p` inherit `ln`'s bounds. `exact` denotes integer-arithmetic functions with no approximation error.*

### Derivatives — `DeFiMathOptions`, `DeFiMathBinary`, `DeFiMathFutures`

| Function | Gas | Max abs error | Max rel error | Description |
| :------- | --: | ------------: | ------------: | :---------- |
| `callOptionPrice`     | 2,582  | 1.3e-10 |       — | European call (Black-Scholes) |
| `putOptionPrice`      | 2,592  | 1.3e-10 |       — | European put (Black-Scholes) |
| `delta`               | 1,661  | 1.2e-13 |       — | First derivative w.r.t. spot |
| `gamma`               | 1,433  | 3.2e-15 |       — | Second derivative w.r.t. spot |
| `theta`               | 3,101  | 1.9e-12 |       — | Time decay (per day) |
| `vega`                | 1,373  |   4e-13 |       — | Sensitivity to volatility |
| `impliedVolatility`   | 11,668 / 11,743 |  — |  1.0e-6 | IV via Newton-Raphson (call / put) |
| `binaryCallPrice`     | 1,913  |   2e-12 |       — | Cash-or-nothing call |
| `binaryPutPrice`      | 1,918  |   2e-12 |       — | Cash-or-nothing put |
| `binaryDelta`         | 1,717  |   1e-13 |       — | Binary delta (signed) |
| `binaryGamma`         | 1,859  |   1e-15 |       — | Binary gamma (signed) |
| `binaryTheta`         | 3,161  |   1e-14 |       — | Binary theta (per day) |
| `binaryVega`          | 1,805  |   1e-14 |       — | Binary vega (signed) |
| `futurePrice`         | 400    |  1.2e-9 |       — | `spot · e^(rt)` |

*Bounds enforced by the test suite — the constants in [`test/hardhat/Tolerances.test.mjs`](test/hardhat/Tolerances.test.mjs). Absolute error is the metric throughout: option prices are quoted at a $1,000 spot (so `1.3e-10` is in dollars), binaries at unit payout, `theta` per day and `vega` per 1% vol. `impliedVolatility` is the exception — it is bounded by round-trip **relative** error against its Newton-Raphson convergence target.*

### Interest & rates — `DeFiMathRates` (Rates.sol)

| Function | Gas | Max abs error | Max rel error | Description |
| :------- | --: | ------------: | ------------: | :---------- |
| `compoundInterest`       | 425     |       — | 5.4e-14 | Continuous compounding: `P · e^(rt)` |
| `presentValue`           | 477     |       — | 5.4e-14 | Discounting: `FV · e^(−rt)` |
| `logReturn`              | 600     |       — | 1.6e-15 | `ln(currentPrice / previousPrice)` |
| `continuousToDiscrete`   | 375     |   1e-15 |       — | `e^apr − 1` (APR → APY) |
| `discreteToContinuous`   | 574     |   1e-15 |       — | `ln(1 + apy)` (APY → APR) |
| `yieldToMaturity`        | 736     |       — | 5.4e-14 | Zero-coupon YTM (closed form) |
| `internalRateOfReturn`   | 16k–47k |       — |    1e-9 | IRR via Newton-Raphson (cost scales with cashflow count) |

*Bounds enforced by the test suite — the constants in [`test/hardhat/Tolerances.test.mjs`](test/hardhat/Tolerances.test.mjs). Compounding and discounting inherit `exp`'s relative bound, `logReturn` inherits `ln`'s. The two rate conversions are bounded **absolutely** (`1e-15`) because they run a Taylor branch through their root at `r = 0`, where relative error is undefined. `internalRateOfReturn` is bounded by its Newton-Raphson convergence tolerance.*

### Statistics — `DeFiMathStats` (Stats.sol)

| Function | Gas | Max abs error | Max rel error | Description |
| :------- | --: | ------------: | ------------: | :---------- |
| `geometricMean`            | 284                |       — | 2.2e-14 | `sqrt(a · b)` — Uniswap V2 invariant |
| `mean`                     | 6,980 @ 30 elem    |       — |   1e-15 | Arithmetic mean |
| `stdDev`                   | 15,252 @ 30 elem   |       — | 2.2e-14 | Sample std. dev. (Bessel-corrected) |
| `weightedAverage`          | 15,687 @ 30 elem   |       — |   1e-15 | Σ(v·w) / Σ(w) |
| `historicalVolatility`     | 25,820 @ 30 prices |       — | 2.2e-14 | Annualized vol from log returns |
| `sharpeRatio`              | 25,958 @ 30 prices |       — | 2.2e-14 | Risk-adjusted return |
| `maxDrawdown`              | 15,470 @ 30 prices |       — |   1e-15 | Peak-to-trough decline |
| `valueAtRisk`              | 34,531 @ 30 prices |       — | 2.2e-14 | NumPy-compatible linear interpolation |
| `conditionalValueAtRisk`   | 31,889 @ 30 prices |       — | 2.2e-14 | Expected shortfall (left tail mean) |

*Bounds enforced by the test suite — the constants in [`test/hardhat/Tolerances.test.mjs`](test/hardhat/Tolerances.test.mjs). All results are ≥ 1 in practice, so relative error is the metric throughout. `1e-15` marks arithmetic-only aggregation (essentially exact, at IEEE 754 machine epsilon); `2.2e-14` covers the multi-step paths (variance → vol → Sharpe) that accumulate rounding. `valueAtRisk` is validated against `simple-statistics`.*

## Testing

Two independent layers:

- **Hardhat** — 640 tests validating against external JavaScript references (`Math`, `math-erf`, `black-scholes`, `greeks`, `simple-statistics`) at concrete points across the operational domain, plus strict-equality gas-regression assertions on every performance test.
- **Foundry** — 92 mathematical properties × 32,000 random runs each = **2,944,000 random executions per CI run**. Validates the algebraic structure (round-trips, monotonicity, identities, output bounds, symmetries) with automatic counterexample shrinking.

732 total tests. Run with `npm test`. Sources live at [`test/hardhat/`](test/hardhat/) and [`test/foundry/`](test/foundry/). Per-module test breakdowns on the [Documentation page](https://defimath.com/docs/#testing).

## Precision

Every function is validated against trusted JavaScript reference implementations: `black-scholes`, `greeks`, `math-erf`, and `simple-statistics`. Per-function error figures appear in the tables above; the full benchmark suite — including head-to-head precision vs. competing libraries — lives in [defimath-compare](https://github.com/MerkleBlue/defimath-compare).

## License

MIT.
