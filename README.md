# DeFiMath [![License: MIT][license-badge]][license]

[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

![Tests](https://github.com/MerkleBlue/defimath/actions/workflows/test.yml/badge.svg)

DeFiMath is a high-performance, open-source Solidity library designed for Ethereum smart contracts. It provides optimized, gas-efficient implementations of core DeFi primitives and mathematical utilities—built with precision and performance in mind.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Derivatives](#derivatives)
  - [Option Pricing (Black-Scholes)](#option-pricing-using-black-scholes)
  - [Futures](#futures)
- [Math](#math)
- [Credits](#credits)
- [License](#license)

## Features

- **DeFi primitives**: core building blocks tailored for advanced financial protocols like options, futures, and other derivatives.
- **High-precision math**: accurate fixed-point and integer operations essential for financial calculations.
- **Gas optimized**: carefully engineered for minimal gas usage without compromising precision.
- **Test coverage**: fully tested with comprehensive unit tests to ensure correctness and reliability.
- **Modular & extensible**: designed for flexibility—import only what you need or extend to suit your protocol.
- **Open-source**: MIT-licensed, community-friendly, transparent, auditable, and free to use.

## Installation

Install via npm:

```bash
npm install defimath-lib
```

Requires **Solidity `^0.8.30`**.

## Usage

Import only the modules you need:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import "defimath/derivatives/Options.sol";
```

All values use **18-decimal fixed-point format** (`1e18 = 1.0`):

| Parameter        | Type      | Unit           | Example                   |
| :--------------- | :-------- | :------------- | :------------------------ |
| `spot`           | `uint128` | price × 1e18   | `1000e18` = $1,000        |
| `strike`         | `uint128` | price × 1e18   | `1100e18` = $1,100        |
| `timeToExpirySec`| `uint32`  | seconds        | `2592000` = 30 days       |
| `volatility`     | `uint64`  | ratio × 1e18   | `0.8e18` = 80% IV         |
| `rate`           | `uint64`  | ratio × 1e18   | `0.05e18` = 5% risk-free  |

Inputs outside the supported ranges revert with descriptive errors (e.g., `StrikeUpperBoundError`, `TimeToExpiryUpperBoundError`).

```solidity
contract OptionsExchange {
    function getQuote(
        uint128 spot,           // e.g. 1000e18 for $1,000
        uint128 strike,         // e.g. 1100e18 for $1,100
        uint32 timeToExpirySec, // e.g. 2592000 for 30 days
        uint64 volatility,      // e.g. 0.8e18 for 80% IV
        uint64 rate             // e.g. 0.05e18 for 5% risk-free rate
    ) external pure returns (uint256 callPrice, uint256 putPrice) {
        callPrice = DeFiMathOptions.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
        putPrice  = DeFiMathOptions.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }
}
```

## Derivatives

### Option Pricing using Black-Scholes

The implementation is based on the original Black-Scholes formula, which is a mathematical model used to calculate the theoretical price of options. The formula is widely used in the financial industry for pricing European-style options.

The Black-Scholes formula is given by:

```math
C = S N(d_1) - K e^{-rT} N(d_2)
```
```math
P = K e^{-rT} N(-d_2) - S N(-d_1)
```

where $C$ is the call option price, $P$ is the put option price, $S$ is the current asset price, $K$ is the strike price, $T$ is the time to expiration (in years), $r$ is the annualized risk-free interest rate, $N(d)$ is the cumulative distribution function of the standard normal distribution, and $d_1$ and $d_2$ are given by:

```math
d_1 = \frac{\ln(S/K) + (r + \sigma^2/2)T}{\sigma \sqrt{T}},  d_2 = d_1 - \sigma \sqrt{T}
```

where $\sigma$ is the volatility of the underlying asset. Learn more about the [Black-Scholes model on Wikipedia](https://en.wikipedia.org/wiki/Black%E2%80%93Scholes_model).

#### Performance

The maximum absolute error for call or put option pricing is approximately 1.2e-10 at a $1,000 spot price — offering near-perfect precision.

Option pricing computations cost roughly 3,200 gas on average — orders of magnitude cheaper than a typical Uniswap V3 swap (~110,000 gas).

The following table compares **gas efficiency** of DeFiMath with other implementations over a typical range of parameters.

| Function | DeFiMath | Derivexyz | Premia | Party1983 |  Dopex |
| :------- | -------: | --------: | -----: | --------: | -----: |
| call     |     3203 |     30220 |  20635 |     39974 |  95447 |
| put      |     3229 |     30220 |  20827 |     40137 |  94808 |
| delta    |     2033 |     19574 |      - |     26853 |      - |
| gamma    |     1707 |         - |      - |         - |      - |
| theta    |     3823 |         - |      - |         - |      - |
| vega     |     1680 |     16503 |      - |         - |      - |

The table below compares the **maximum relative error** against a trusted JavaScript reference implementation.

| Function | DeFiMath | Derivexyz | Premia | Party1983 | Dopex |
| :------- | -------: | --------: | -----: | --------: | ----: |
| call     |  5.6e-12 |  6.8e-13  | 1.7e-1 |   3.8e+1  |     - |
| put      |  5.4e-12 |  6.5e-13  | 1.7e-1 |   9.9e+1  |     - |
| delta    |  6.9e-15 |  6.7e-16  |      - |   9.2e-1  |     - |
| gamma    |  9.1e-17 |         - |      - |         - |     - |
| theta    |  3.7e-14 |         - |      - |         - |     - |
| vega     |  4.8e-14 |  1.1e-15  |      - |         - |     - |

#### Limits

The following limitations apply to all option functions. Inputs outside these ranges revert with a descriptive error.

- **Strike price**: 0.2x to 5x the spot price (e.g., $200–$5,000 for a $1,000 spot).
- **Time to expiration**: up to 2 years.
- **Volatility**: up to 1800%.
- **Risk-free rate**: up to 400%.

### Futures

DeFiMath includes a gas-efficient futures pricing library using continuous compounding:

```solidity
import "defimath/derivatives/Futures.sol";
```

## Math

DeFiMath includes a low-level math library (`DeFiMath`) with optimized fixed-point implementations of common mathematical functions. All inputs and outputs use 18-decimal fixed-point format (`1e18 = 1.0`). Available functions: `exp`, `ln`, `log2`, `log10`, `sqrt`, `stdNormCDF`, `erf`.

```solidity
import "defimath/math/Math.sol";
```

The following table compares **gas efficiency** of DeFiMath with other math libraries over a typical range of parameters.

| Function   | DeFiMath | PRBMath | ABDKQuad | Solady | SolStat |
| :--------- | -------: | ------: | -------: | -----: | ------: |
| exp        |      359 |    2748 |     5371 |    420 |       - |
| ln         |      608 |    6994 |    15843 |    536 |       - |
| log2       |      681 |    6691 |    15191 |      - |       - |
| log10      |      681 |    8570 |        - |      - |       - |
| sqrt       |      383 |    961* |      731 |   415* |       - |
| stdNormCDF |      799 |       - |        - |      - |    4884 |
| erf        |      773 |       - |        - |      - |    4236 |

\* not a fixed-point function

The table below compares the **maximum relative error** against a trusted JavaScript reference implementation.

| Function   | DeFiMath | PRBMath  | ABDKQuad | Solady   | SolStat |
| :--------- | -------: | -------: | -------: | -------: | ------: |
| exp        |  5.1e-12 |  1.9e-12 |  1.9e-12 |  1.9e-12 |       - |
| ln         |  1.5e-12 |  1.3e-12 |  1.6e-12 |  1.6e-12 |       - |
| log2       |  1.5e-12 |  1.3e-12 |  1.6e-12 |        - |       - |
| log10      |  1.4e-12 |  1.3e-12 |        - |        - |       - |
| sqrt       |  2.8e-14 |  2.8e-14 |  2.8e-14 |  2.8e-14 |       - |
| stdNormCDF |  4.6e-13 |        - |        - |        - |  3.2e-6 |
| erf        |  7.4e-13 |        - |        - |        - |  5.7e-6 |

## Credits

The following libraries were used for comparison:
- [Derivexyz](https://github.com/derivexyz/v1-core/blob/master/contracts/libraries/BlackScholes.sol)
- [Premia](https://github.com/Premian-Labs/premia-contracts/blob/master/contracts/libraries/OptionMath.sol)
- [Party1983](https://github.com/partylikeits1983/black_scholes_solidity/blob/main/contracts/libraries/BlackScholesModel.sol)
- [Dopex](https://github.com/code-423n4/2023-08-dopex/blob/main/contracts/libraries/BlackScholes.sol)
- [PRBMath](https://github.com/PaulRBerg/prb-math)
- [ABDK](https://github.com/abdk-consulting/abdk-libraries-solidity)
- [Solady](https://github.com/Vectorized/solady)
- [SolStat](https://github.com/primitivefinance/solstat)

## License

This project is released under the MIT License.
