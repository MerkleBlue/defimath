# DeFiMath [![License: MIT][license-badge]][license]

[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

![Tests](https://github.com/MerkleBlue/defimath/actions/workflows/test.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/defimath-lib.svg)](https://www.npmjs.com/package/defimath-lib)
[![npm downloads](https://img.shields.io/npm/dm/defimath-lib.svg)](https://www.npmjs.com/package/defimath-lib)
[![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.31-blue.svg)](https://soliditylang.org)

> Gas-optimized Solidity library for DeFi math. Black-Scholes option pricing at **2,729 gas**, with a broad set of primitives across math, interest rates, statistics, and derivatives.

[DeFiMath](https://defimath.com) is a pure-Solidity library of DeFi math primitives. 40+ functions across four modules: low-level math, derivatives, interest rates, and statistics. No external runtime dependencies. MIT-licensed.

## Why DeFiMath

- **Unlocks new use cases.** Gas-efficient enough to make real-time options pricing, on-chain IV solving on every quote, and risk-adjusted vault fees economically viable. Use cases that were previously off-chain workarounds now fit in a single transaction.
- **Breadth.** 40+ primitives spanning math (`exp`, `ln`, `sqrt`), derivatives (Black-Scholes + Greeks, binary options, IV solver), interest rates (compound, present value, IRR, YTM), and statistics (volatility, Sharpe, VaR, CVaR, max drawdown).
- **Pure Solidity.** ~16KB published, zero runtime dependencies, easy to audit.
- **Validated precision.** Sub-1e-10 absolute error on options pricing; sub-1e-12 relative error on math primitives (absolute error for bounded functions like `stdNormCDF` and `erf`). Validated against `simple-statistics`, `black-scholes`, `greeks`, and `math-erf` reference libraries.

## Benchmarks

Every function is benchmarked against existing on-chain implementations. A representative comparison:

| Function | DeFiMath | Next best | Multiple |
| :------- | -------: | --------: | -------: |
| `callOptionPrice` | **2,729** | 13,360 (Derivexyz) | **4.9×** |
| `putOptionPrice`  | **2,739** | 13,363 (Derivexyz) | **4.9×** |
| `binaryCallPrice` | **2,018** | 16,218 (Haptic)    | **8.0×** |
| `delta`           | **1,724** | 8,621 (Derivexyz)  | **5.0×** |
| `vega`            | **1,439** | 7,490 (Derivexyz)  | **5.2×** |
| `ln`              | **375**   | 518 (Solady)       | 1.4× |
| `sqrt`            | **245**   | 341 (Solady)       | 1.4× |
| `cbrt`            | **368**   | 550 (Solady)       | 1.5× |
| `stdNormCDF`      | **660**   | 2,794 (SolStat)    | **4.2×** |

Full per-function tables in the [defimath-compare README](https://github.com/MerkleBlue/defimath-compare#readme).

## Install

```bash
npm install defimath-lib
```

Requires **Solidity `^0.8.31`** and **`evmVersion: "osaka"`** (Fusaka). The library uses the `clz` Yul builtin (added in Solidity 0.8.31) which emits the `CLZ` opcode introduced in Osaka — both the compiler version and EVM target are hard requirements.

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

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `exp`        | 333  | 5.1e-14 | Exponential function `e^x` |
| `ln`         | 375  | 1.5e-14 | Natural logarithm |
| `log2`       | 391  | 1.5e-14 | Base-2 logarithm |
| `log10`      | 391  | 1.4e-14 | Base-10 logarithm |
| `pow`        | 750  | 5.2e-14 | Power function `x^a` |
| `sqrt`       | 245  | 2.8e-16 | Square root |
| `cbrt`       | 368  | 2.2e-16 | Cube root |
| `expm1`      | 439  | 9.9e-14 | `e^x − 1` (precision-preserving for small x) |
| `log1p`      | 500  | 7.0e-15 | `ln(1 + x)` (precision-preserving for small x) |
| `stdNormCDF` | 660  | 4.7e-15 | Standard normal CDF Φ(x) |
| `erf`        | 685  | 7.4e-15 | Error function |
| `mulDiv`     | 155  | exact   | `(a · b) / d` with full 512-bit intermediate precision |
| `mul`        | 130  | exact   | `(a · b) / 1e18` — fixed-point multiply with denominator baked in |
| `abs`        | 17   | exact   | Branchless `\|int256\|` (handles `int256.min` cleanly) |
| `min`        | 23   | exact   | Branchless minimum of two `uint256` |
| `max`        | 23   | exact   | Branchless maximum of two `uint256` |
| `clamp`      | 78   | exact   | Clamp `x` into `[lo, hi]` (composed `max` then `min`) |
| `avg`        | 21   | exact   | Overflow-safe `(a + b) / 2` via `(a & b) + ((a ^ b) >> 1)` |

*Precision is max relative error vs. JS reference implementation, except `stdNormCDF` and `erf` — both bounded in [0, 1] and [−1, 1] respectively, where the test suite measures max absolute error. `exact` denotes integer-arithmetic functions with no approximation error.*

### Derivatives — `DeFiMathOptions`, `DeFiMathBinary`, `DeFiMathFutures`

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `callOptionPrice`     | 2,729  | 5.6e-12 | European call (Black-Scholes) |
| `putOptionPrice`      | 2,739  | 5.4e-12 | European put (Black-Scholes) |
| `delta`               | 1,724  | 6.2e-15 | First derivative w.r.t. spot |
| `gamma`               | 1,499  | 9.1e-17 | Second derivative w.r.t. spot |
| `theta`               | 3,293  | 3.5e-14 | Time decay (per day) |
| `vega`                | 1,439  | 4.3e-14 | Sensitivity to volatility |
| `impliedVolatility`   | 12,370 | ≤ 1e-6  | IV via Newton-Raphson |
| `binaryCallPrice`     | 2,018  | 6.2e-15 | Cash-or-nothing call |
| `binaryPutPrice`      | 2,023  | 5.9e-15 | Cash-or-nothing put |
| `binaryDelta`         | 1,825  | 1.3e-16 | Binary delta (signed) |
| `binaryGamma`         | 1,967  | 1.5e-18 | Binary gamma (signed) |
| `binaryTheta`         | 3,353  | 8.3e-16 | Binary theta (per day) |
| `binaryVega`          | 1,913  | 2.7e-16 | Binary vega (signed) |
| `futurePrice`         | 442    | 1.2e-9 | `spot · e^(rt)` |

*Precision is max absolute error vs. JS reference (at $1,000 spot for European, unit-payout for binary). `impliedVolatility` uses round-trip relative error.*

### Interest & rates — `DeFiMathRates` (Rates.sol)

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `compoundInterest`       | 467     | 2.8e-14 | Continuous compounding: `P · e^(rt)` |
| `presentValue`           | 519     | 2.8e-14 | Discounting: `FV · e^(−rt)` |
| `logReturn`              | 600     | 7.1e-16 | `ln(currentPrice / previousPrice)` |
| `continuousToDiscrete`   | 508     | 2.4e-14 | `e^apr − 1` (APR → APY) |
| `discreteToContinuous`   | 589     | 5.1e-16 | `ln(1 + apy)` (APY → APR) |
| `yieldToMaturity`        | 736     | 2.7e-14 | Zero-coupon YTM (closed form) |
| `internalRateOfReturn`   | 17k–49k | 3.7e-15 | IRR via Newton-Raphson (cost scales with cashflow count) |

*Precision is max relative error vs. JS reference; inherits the underlying `exp`/`ln`/`expm1`/`log1p` primitives. `internalRateOfReturn` is worst-case bounded by the Newton-Raphson convergence tolerance (1e-8); the listed number is post-convergence agreement with the JS reference.*

### Statistics — `DeFiMathStats` (Stats.sol)

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `geometricMean`            | 330                | 1.2e-16 | `sqrt(a · b)` — Uniswap V2 invariant |
| `mean`                     | 6,980 @ 30 elem    | 1.7e-16 | Arithmetic mean |
| `stdDev`                   | 15,298 @ 30 elem   | 4.2e-16 | Sample std. dev. (Bessel-corrected) |
| `weightedAverage`          | 15,687 @ 30 elem   | 2.8e-16 | Σ(v·w) / Σ(w) |
| `historicalVolatility`     | 26,135 @ 30 prices | 1.6e-14 | Annualized vol from log returns |
| `sharpeRatio`              | 26,273 @ 30 prices | 2.2e-14 | Risk-adjusted return |
| `maxDrawdown`              | 15,191 @ 30 prices | 9.9e-16 | Peak-to-trough decline |
| `valueAtRisk`              | 36,752 @ 30 prices | 1.9e-14 | NumPy-compatible linear interpolation |
| `conditionalValueAtRisk`   | 32,917 @ 30 prices | 2.5e-14 | Expected shortfall (left tail mean) |

*Precision is max relative error vs. JS reference (`simple-statistics` for `valueAtRisk`). Sub-1e-15 values are at IEEE 754 machine-epsilon precision (arithmetic-only operations).*

## Precision

Every function is validated against trusted JavaScript reference implementations: `black-scholes`, `greeks`, `math-erf`, and `simple-statistics`. Per-function error figures appear in the tables above; the full benchmark suite — including head-to-head precision vs. competing libraries — lives in [defimath-compare](https://github.com/MerkleBlue/defimath-compare).

## License

MIT.
