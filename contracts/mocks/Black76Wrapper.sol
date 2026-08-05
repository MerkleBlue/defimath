// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../derivatives/Black76.sol";

contract Black76Wrapper {

    function call(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return Black76.call(future, strike, timeToExp, volatility, rate);
    }

    function put(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return Black76.put(future, strike, timeToExp, volatility, rate);
    }

    function delta(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return Black76.delta(future, strike, timeToExp, volatility, rate);
    }

    function gamma(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 gammaOut) {
        return Black76.gamma(future, strike, timeToExp, volatility, rate);
    }

    function theta(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 thetaCall, int128 thetaPut) {
        return Black76.theta(future, strike, timeToExp, volatility, rate);
    }

    function vega(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 vegaOut) {
        return Black76.vega(future, strike, timeToExp, volatility, rate);
    }

    function impliedVolatility(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) external pure returns (uint256 volatility) {
        return Black76.impliedVolatility(future, strike, timeToExp, rate, optionPrice, isCall);
    }

    // ── gas-measuring variants ─────────────────────────────────────────────

    function callMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 startGas = gasleft();
        uint256 result = Black76.call(future, strike, timeToExp, volatility, rate);
        return (result, startGas - gasleft());
    }

    function putMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 startGas = gasleft();
        uint256 result = Black76.put(future, strike, timeToExp, volatility, rate);
        return (result, startGas - gasleft());
    }

    function deltaMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut, uint256 gasUsed) {
        uint256 startGas = gasleft();
        (deltaCall, deltaPut) = Black76.delta(future, strike, timeToExp, volatility, rate);
        return (deltaCall, deltaPut, startGas - gasleft());
    }

    function gammaMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 gammaOut, uint256 gasUsed) {
        uint256 startGas = gasleft();
        gammaOut = Black76.gamma(future, strike, timeToExp, volatility, rate);
        return (gammaOut, startGas - gasleft());
    }

    function thetaMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 thetaCall, int128 thetaPut, uint256 gasUsed) {
        uint256 startGas = gasleft();
        (thetaCall, thetaPut) = Black76.theta(future, strike, timeToExp, volatility, rate);
        return (thetaCall, thetaPut, startGas - gasleft());
    }

    function vegaMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 vegaOut, uint256 gasUsed) {
        uint256 startGas = gasleft();
        vegaOut = Black76.vega(future, strike, timeToExp, volatility, rate);
        return (vegaOut, startGas - gasleft());
    }

    function impliedVolatilityMG(
        uint128 future,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) external view returns (uint256 volatility, uint256 gasUsed) {
        uint256 startGas = gasleft();
        volatility = Black76.impliedVolatility(future, strike, timeToExp, rate, optionPrice, isCall);
        return (volatility, startGas - gasleft());
    }
}
