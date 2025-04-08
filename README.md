# DeFiMath [![License: MIT][license-badge]][license]

[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

DeFiMath is an open-source, high-performance Solidity library for Ethereum smart contract development. The library is optimized for gas efficiency while preserving very high precision. 

# Usage
The library is designed to be used in Ethereum smart contracts. It provides a set of mathematical functions and utilities that can be easily integrated into your Solidity projects.
To use DeFiMath in your project, you can import the library into your Solidity contract as follows:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "defimath/derivatives/Options.sol";
```
To use the library, you can call the functions provided by the library directly in your Solidity contract. For example, to calculate the call option price using the Black-Scholes formula, you can use the following code:

```solidity
contract OptionsExchange {
    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathOptions.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }
}
```
# Features

# Math
The table below compares the performance of DeFiMath with other math function implementations, showing the __maximum relative error (%)__ against a trusted JavaScript reference implementation.  

| Function      | PRBMath  | ABDKQuad |  Solady | SolStat | DeFiMath |  
| :------------ | -------: | -------: | ------: | ------: | -------: |
| exp           | 1.9e-12  | 1.9e-12  | 1.9e-12 |    -    | 4.0e-9   |
| ln            | 1.3e-12  | 1.6e-12  | 1.6e-12 |    -    | 7.3e-11  |
| log2          | 1.3e-12  | 1.6e-12  |    -    |    -    | 7.3e-11  |
| log10         | 1.3e-12  |     -    |    -    |    -    | 7.3e-11  |
| sqrt          | 2.6e-12  | 2.6e-12  | 2.6e-12 |    -    | 7.1e-11  |
| stdNormCDF    |    -     |    -     |    -    | 9.3e-6  | 4.9e-9   |
| erf           |    -     |    -     |    -    | 2.6e-2  | 4.4e-7   | 

Here's gas efficiency comparison table for the same implementations. 

| Function      | PRBMath  | ABDKQuad |  Solady | SolStat | DeFiMath |  
| :------------ | -------: | -------: | ------: | ------: | -------: |
| exp           |    2748  |    5371  |     420 |    -    |    665   |
| ln            |    6994  |   15843  |     536 |    -    |    580   |
| log2          |    6691  |   15191  |    -    |    -    |    613   |
| log10         |    8570  |     -    |    -    |    -    |    613   |
| sqrt          |     952  |     731  |     415 |    -    |    787   |
| stdNormCDF    |    -     |    -     |    -    |   4884  |   1080   |
| erf           |    -     |    -     |    -    |   4236  |    986   | 


# Derivatives

## Option Pricing using Black-Scholes

The implementation is based on the original Black-Scholes formula, which is a mathematical model used to calculate the theoretical price of options. The formula is widely used in the financial industry for pricing European-style options.
The Black-Scholes formula is given by:  
```math
C = S N(d_1) - K e^{-rT} N(d_2)
```
where \(C\) is the call option price, \(S\) is the current asset price, \(K\) is the strike price, \(T\) is the time to expiration (in years), \(r\) is the annualized risk-free interest rate, \(N(d)\) is the cumulative distribution function of the standard normal distribution, and \(d_1\) and \(d_2\) are given by:
```math
d_1 = \frac{\ln(S/K) + (r + \sigma^2/2)T}{\sigma \sqrt{T}}
```
```math
d_2 = d_1 - \sigma \sqrt{T}
```
where \(\sigma\) is the volatility of the underlying asset.

Learn more about [Black Scholes model on Wikipedia](https://en.wikipedia.org/wiki/Black%E2%80%93Scholes_model).

### Limits

The following limitations apply to the BlackScholes implementation:
 - strike prices - up to 5x spot price on both sides, i.e. strike from $200 to $5000 for a $1000 spot
 - time to expiration - up to 2 years
 - volatility - up to 1800%
 - risk-free rate - up to 400%

### Performance
Maximum absolute error when call or put option is calculated is < $0.0000002 for a $1000 spot price.  

Calculating call or put option price costs around 4k gas on average (not accounting for 21k gas paid by each tx). For reference, Uniswap V3 swap costs around 130k gas.  

The following table compares performance of DeFiMath with other implementations of Black-Scholes formula when a call option is called over a typical range of parameters. 

| Metric        |  DeFiMath     |  Derivexyz | Premia     | Party1983   | Dopex   |
| :------------ | ------------: | ---------: | ---------: | ----------: | ------: | 
| Avg abs error |  0.00000000   | 0.00000000 | 0.03957955 |  5.69158932 |         |
| Max abs error |  0.00000002   | 0.00000000 | 0.17114025 | 37.66781134 |         |
| Avg gas   |        4118   |      30226 |      20635 |       40010 |   95458 |

# Credits

The following libraries were used for comparison:
 - [PRBMath](https://github.com/PaulRBerg/prb-math)
 - [ABDK](https://github.com/abdk-consulting/abdk-libraries-solidity)
 - [Solady](https://github.com/Vectorized/solady)
 - [SolStat](https://github.com/primitivefinance/solstat)
 - [Derivexyz](https://github.com/derivexyz/v1-core/blob/master/contracts/libraries/BlackScholes.sol)
 - [Premia](https://github.com/Premian-Labs/premia-contracts/blob/master/contracts/libraries/OptionMath.sol)
 - [Party1983](https://github.com/partylikeits1983/black_scholes_solidity/blob/main/contracts/libraries/BlackScholesModel.sol)
 - [Dopex](https://github.com/code-423n4/2023-08-dopex/blob/main/contracts/libraries/BlackScholes.sol)
# License

DeFiMath project is released under the MIT License.
