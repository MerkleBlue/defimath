// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../derivatives/BlackScholes.sol";

contract BlackScholesWrapper {

    function callOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathBlackScholes.callOptionPrice(spot, strike, timeToExp, volatility, rate);
    }

    function putOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathBlackScholes.putOptionPrice(spot, strike, timeToExp, volatility, rate);
    }

    function delta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return DeFiMathBlackScholes.delta(spot, strike, timeToExp, volatility, rate);
    }

    function gamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 gammaOut) {
        return DeFiMathBlackScholes.gamma(spot, strike, timeToExp, volatility, rate);
    }

    function theta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 thetaCall, int128 thetaPut) {
        return DeFiMathBlackScholes.theta(spot, strike, timeToExp, volatility, rate);
    }

    function vega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 vegaOut) {
        return DeFiMathBlackScholes.vega(spot, strike, timeToExp, volatility, rate);
    }

    function callOptionPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBlackScholes.callOptionPrice(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function putOptionPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBlackScholes.putOptionPrice(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function deltaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut,  uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        (deltaCall, deltaPut) = DeFiMathBlackScholes.delta(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();
        
        return (deltaCall, deltaPut, startGas - endGas);
    }

    function gammaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 gammaOut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        gammaOut = DeFiMathBlackScholes.gamma(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();

        return (gammaOut, startGas - endGas);
    }

    function thetaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 thetaCall, int128 thetaPut,  uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        (thetaCall, thetaPut) = DeFiMathBlackScholes.theta(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();
        
        return (thetaCall, thetaPut, startGas - endGas);
    }

    function vegaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 vegaOut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        vegaOut = DeFiMathBlackScholes.vega(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();

        return (vegaOut, startGas - endGas);
    }

    function impliedVolatility(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) external pure returns (uint256 volatility) {
        return DeFiMathBlackScholes.impliedVolatility(spot, strike, timeToExp, rate, optionPrice, isCall);
    }

    function impliedVolatilityMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) external view returns (uint256 volatility, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        volatility = DeFiMathBlackScholes.impliedVolatility(spot, strike, timeToExp, rate, optionPrice, isCall);
        endGas = gasleft();

        return (volatility, startGas - endGas);
    }
}
