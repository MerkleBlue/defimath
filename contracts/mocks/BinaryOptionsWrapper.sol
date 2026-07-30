// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../derivatives/BinaryOptions.sol";

contract BinaryOptionsWrapper {

    function call(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return BinaryOptions.call(spot, strike, timeToExp, volatility, rate);
    }

    function callMG(
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

        result = BinaryOptions.call(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function put(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return BinaryOptions.put(spot, strike, timeToExp, volatility, rate);
    }

    function putMG(
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

        result = BinaryOptions.put(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function delta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return BinaryOptions.delta(spot, strike, timeToExp, volatility, rate);
    }

    function deltaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (deltaCall, deltaPut) = BinaryOptions.delta(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (deltaCall, deltaPut, startGas - endGas);
    }

    function gamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 gammaCall, int128 gammaPut) {
        return BinaryOptions.gamma(spot, strike, timeToExp, volatility, rate);
    }

    function gammaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 gammaCall, int128 gammaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (gammaCall, gammaPut) = BinaryOptions.gamma(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (gammaCall, gammaPut, startGas - endGas);
    }

    function theta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 thetaCall, int128 thetaPut) {
        return BinaryOptions.theta(spot, strike, timeToExp, volatility, rate);
    }

    function thetaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 thetaCall, int128 thetaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (thetaCall, thetaPut) = BinaryOptions.theta(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (thetaCall, thetaPut, startGas - endGas);
    }

    function vega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 vegaCall, int128 vegaPut) {
        return BinaryOptions.vega(spot, strike, timeToExp, volatility, rate);
    }

    function vegaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 vegaCall, int128 vegaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (vegaCall, vegaPut) = BinaryOptions.vega(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (vegaCall, vegaPut, startGas - endGas);
    }
}
