# Open Solidity

Open Solidity is open-source, high-performance Solidity library for Ethereum smart contract development. The library is optimized for gas efficiency, while also preserving very high precision. 

# Derivatives

## Option Pricing using Black-Scholes

The implementation is based on the original Black-Scholes formula, which is a mathematical model used to calculate the theoretical price of options. The formula is widely used in the financial industry for pricing European-style options.
The Black-Scholes formula is given by:  
```math
C = S N(d_1) - K e^{-rT} N(d_2)
```
where:
- \(C\) is the call option price
- \(S\) is the current stock price
- \(K\) is the strike price
- \(T\) is the time to expiration (in years)
- \(r\) is the risk-free interest rate (annualized)

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

The following table compares performance of Open Solidity with other implementations of Black Scholes formula when a call option is called over a typical range of parameters. 

| Metric    |  [Open Solidity](https://github.com/MerkleBlue/open-solidity) |  [Derivexyz](https://github.com/derivexyz/v1-core/blob/master/contracts/libraries/BlackScholes.sol) |     [Premia](https://github.com/Premian-Labs/premia-contracts/blob/master/contracts/libraries/OptionMath.sol) |   [Party1983](https://github.com/partylikeits1983/black_scholes_solidity/blob/main/contracts/libraries/BlackScholesModel.sol) |   [Dopex](https://github.com/code-423n4/2023-08-dopex/blob/main/contracts/libraries/BlackScholes.sol) |
| :------------ | ------------: | ---------: | ---------: | ----------: | ------: | 
| Avg abs error |  0.00000000   | 0.00000000 | 0.03957955 |  5.69158932 |         |
| Max abs error |  0.00000002   | 0.00000000 | 0.17114025 | 37.66781134 |         |
| Avg gas   |        4129   |      30226 |      20635 |       40010 |   95458 |


# License

Open Solidity is released under the MIT License.
