# DeFiMath [![License: MIT][license-badge]][license]

[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

![Tests](https://github.com/MerkleBlue/defimath/actions/workflows/test.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/defimath-lib.svg)](https://www.npmjs.com/package/defimath-lib)
[![npm downloads](https://img.shields.io/npm/dm/defimath-lib.svg)](https://www.npmjs.com/package/defimath-lib)
[![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.31-blue.svg)](https://soliditylang.org)

> Gas-optimized Solidity library for DeFi math. Black-Scholes option pricing at **2,887 gas**, with a broad set of primitives across math, interest rates, statistics, and derivatives.

[DeFiMath](https://defimath.com) is a pure-Solidity library of DeFi math primitives. 40+ functions across four modules: low-level math, derivatives, interest rates, and statistics. No external runtime dependencies. MIT-licensed.

## Why DeFiMath

- **Unlocks new use cases.** Gas-efficient enough to make real-time options pricing, on-chain IV solving on every quote, and risk-adjusted vault fees economically viable. Use cases that were previously off-chain workarounds now fit in a single transaction.
- **Breadth.** 40+ primitives spanning math (`exp`, `ln`, `sqrt`), derivatives (Black-Scholes + Greeks, binary options, IV solver), interest rates (compound, present value, IRR, YTM), and statistics (volatility, Sharpe, VaR, CVaR, max drawdown).
- **Pure Solidity.** ~16KB published, zero runtime dependencies, easy to audit.
- **Validated precision.** Sub-1e-10 absolute error on options pricing; sub-1e-12 on math primitives. Validated against `simple-statistics`, `black-scholes`, `greeks`, and `math-erf` reference libraries.

## Benchmarks

Every function is benchmarked against existing on-chain implementations. A representative comparison:

| Function | DeFiMath | Next best | Multiple |
| :------- | -------: | --------: | -------: |
| `callOptionPrice` | **2,887** | 13,360 (Derivexyz) | **4.6×** |
| `putOptionPrice`  | **2,898** | 13,363 (Derivexyz) | **4.6×** |
| `binaryCallPrice` | **2,102** | 16,218 (Haptic)    | **7.7×** |
| `delta`           | **1,807** | 8,621 (Derivexyz)  | **4.8×** |
| `vega`            | **1,449** | 7,490 (Derivexyz)  | **5.2×** |
| `ln`              | **375**   | 518 (Solady)       | 1.4× |
| `sqrt`            | **245**   | 341 (Solady)       | 1.4× |
| `stdNormCDF`      | **731**   | 2,794 (SolStat)    | **3.8×** |

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

import "defimath/derivatives/Options.sol";

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
| `exp`        | 333  | 5.1e-12 | Exponential function `e^x` |
| `ln`         | 375  | 1.5e-12 | Natural logarithm |
| `log2`       | 391  | 1.5e-12 | Base-2 logarithm |
| `log10`      | 391  | 1.4e-12 | Base-10 logarithm |
| `pow`        | 750  | 5.2e-12 | Power function `x^a` |
| `sqrt`       | 245  | 2.8e-14 | Square root |
| `expm1`      | 439  | 9.9e-12 | `e^x − 1` (precision-preserving for small x) |
| `log1p`      | 500  | 7.0e-13 | `ln(1 + x)` (precision-preserving for small x) |
| `stdNormCDF` | 731  | 4.6e-13 | Standard normal CDF Φ(x) |
| `erf`        | 685  | 7.4e-13 | Error function |

*Precision is max relative error vs. JS reference implementation.*

### Derivatives — `DeFiMathOptions`, `DeFiMathBinary`, `DeFiMathFutures`

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `callOptionPrice`     | 2,887  | 5.6e-12 | European call (Black-Scholes) |
| `putOptionPrice`      | 2,898  | 5.4e-12 | European put (Black-Scholes) |
| `delta`               | 1,807  | 6.9e-15 | First derivative w.r.t. spot |
| `gamma`               | 1,509  | 9.1e-17 | Second derivative w.r.t. spot |
| `theta`               | 3,451  | 3.7e-14 | Time decay (per day) |
| `vega`                | 1,449  | 4.8e-14 | Sensitivity to volatility |
| `impliedVolatility`   | 13,111 | ≤ 1e-6  | IV via Newton-Raphson |
| `binaryCallPrice`     | 2,102  | 5.7e-15 | Cash-or-nothing call |
| `binaryPutPrice`      | 2,107  | 5.4e-15 | Cash-or-nothing put |
| `binaryDelta`         | 1,835  | 1.2e-16 | Binary delta (signed) |
| `binaryGamma`         | 1,977  | 1.0e-15 | Binary gamma (signed) |
| `binaryTheta`         | 3,511  | 8.2e-16 | Binary theta (per day) |
| `binaryVega`          | 1,924  | 2.7e-16 | Binary vega (signed) |
| `futurePrice`         | ~400   | ≤ 5e-14 | `spot · e^(rt)` |

*Precision is max absolute error vs. JS reference (at $1,000 spot for European, unit-payout for binary). `impliedVolatility` uses round-trip relative error.*

### Interest & rates — `DeFiMathRates` (Rates.sol)

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `compoundInterest`       | 467     | 2.9e-14 | Continuous compounding: `P · e^(rt)` |
| `presentValue`           | 519     | 2.8e-14 | Discounting: `FV · e^(−rt)` |
| `logReturn`              | 600     | 7.1e-16 | `ln(currentPrice / previousPrice)` |
| `continuousToDiscrete`   | 508     | 2.6e-14 | `e^apr − 1` (APR → APY) |
| `discreteToContinuous`   | 589     | 7.0e-15 | `ln(1 + apy)` (APY → APR) |
| `yieldToMaturity`        | 736     | 2.7e-14 | Zero-coupon YTM (closed form) |
| `internalRateOfReturn`   | 17k–49k | 3.7e-15 | IRR via Newton-Raphson (cost scales with cashflow count) |

*Precision is max relative error vs. JS reference; inherits the underlying `exp`/`ln`/`expm1`/`log1p` primitives. `internalRateOfReturn` is worst-case bounded by the Newton-Raphson convergence tolerance (1e-8); the listed number is post-convergence agreement with the JS reference.*

### Statistics — `DeFiMathStats` (Stats.sol)

| Function | Gas | Precision | Description |
| :------- | --: | --------: | :---------- |
| `geometricMean`            | 330             | 1.2e-16 | `sqrt(a · b)` — Uniswap V2 invariant |
| `mean`                     | ~230/elem       | 2.0e-16 | Arithmetic mean |
| `stdDev`                   | ~460/elem       | 4.1e-16 | Sample std. dev. (Bessel-corrected) |
| `weightedAverage`          | ~470/elem       | 4.3e-16 | Σ(v·w) / Σ(w) |
| `historicalVolatility`     | 25k @ 30 prices | 1.6e-14 | Annualized vol from log returns |
| `sharpeRatio`              | 26k @ 30 prices | 2.2e-14 | Risk-adjusted return |
| `maxDrawdown`              | 15k @ 30 prices | 9.9e-16 | Peak-to-trough decline |
| `valueAtRisk`              | 32k @ 30 prices | 2.1e-14 | NumPy-compatible linear interpolation |
| `conditionalValueAtRisk`   | 32k @ 30 prices | 2.5e-14 | Expected shortfall (left tail mean) |

*Precision is max relative error vs. JS reference (`simple-statistics` for `valueAtRisk`). Sub-1e-15 values are at IEEE 754 machine-epsilon precision (arithmetic-only operations).*

## Precision

Every function is validated against trusted JavaScript reference implementations: `black-scholes`, `greeks`, `math-erf`, and `simple-statistics`. Per-function error figures appear in the tables above; the full benchmark suite — including head-to-head precision vs. competing libraries — lives in [defimath-compare](https://github.com/MerkleBlue/defimath-compare).

## License

MIT.
