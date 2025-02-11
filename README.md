# primitive-core
Primitives for Solidity DeFi contracts

## Black Scholes Option Pricing

The Black Scholes option pricing model is a mathematical model used to calculate the price of a European call or put option. European options can be exercised only at the expiration date of the option. 

Black Scholes formula uses 5 inputs, and calculates option price. The inputs are:
- Current price of the underlying asset
- Strike price of the option
- Time to expiration
- Risk-free interest rate
- Volatility of the underlying asset

Calculating option price using math calculations that includes logarithms and standard normal distribution can be expensive when implemented in Solidity, so we can use pre-calculated values for the option price.

## Option Price Calculation

We can use the following rules to simplify lookup in the tables:

1. Risk-free rate can be applied to strike price before lookup, by doing new_strike = strike / e ^ rate * time
see https://optioncreator.com/st7im8w and https://optioncreator.com/steaphh
2. Strike and Spot price can be expressed as a ratio, by doing ratio = spot / strike. This is one dimension of the table. We know that if we for example multiply both spot and strike by 2, we get the same option price multiplied with 2. 
3. Time to expiration and volatility are connected. If we multiply time to expiration by 4, and divide volatility by 2, we get the same option price. This means that if we populate a dimension with time only for a fixed volatility, then we can always find the time in the table by finding the ration between input volatility and fixed volatility, square that ratio, and then find the time by multiplying input time with squared ratio. This is the second dimension of the table.
see: https://optioncreator.com/sty6x02

Additionally, call-put parity allows us that we only use one table with call options to calculate put price using: call + strike = future + put

# Limitations

The following limitations apply to the lookup table:

 - strike prices are limited to 5x spot price on both sides, i.e. from $200 to $5000 for spot price of $1000
 - time to expiration is in range from 1 second to 2 years
 - volatility is limited from 1% to 192%
 - risk-free rate is limited to 20%

# Precision

Maximum error is either less than $0.0001 or less than 0.001% of the option price for a $1000 spot price.
The average error is tbd.   
Maximum error is $0.000061 when called within limitations for a $1000 spot price. For example, for ETH options when ETH is trading around $4000, max error is $0.000244 (less than 1/40 of a cent).

# Performance

BlackScholes contract costs on average around 6400 gas to calculate option price (not accounting for 21k gas paid by each tx). For reference, Uniswap V3 swap costs around 130k gas.

# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.js
npx hardhat clean
npx hardhat compile
npx hardhat coverage
npx hardhat test poc/blackscholes/BlackScholesJS.test.mjs 
node poc/blackscholes/generateLookupTable.mjs
```
