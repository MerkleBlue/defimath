// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BlackScholes.sol";

contract AdapterDerivexyz {

    function callPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 call;
        uint256 startGas;
        uint256 endGas;

        BlackScholes.BlackScholesInputs memory inputs = BlackScholes.BlackScholesInputs(
            timeToExpirySec,
            volatility,
            spot,
            strike,
            int64(rate)
        );

        startGas = gasleft();
        (call,) = BlackScholes.optionPrices(inputs);
        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (call, gasUsed);
    }

    function putPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 put;
        uint256 startGas;
        uint256 endGas;

        BlackScholes.BlackScholesInputs memory inputs = BlackScholes.BlackScholesInputs(
            timeToExpirySec,
            volatility,
            spot,
            strike,
            int64(rate)
        );

        startGas = gasleft();
        (, put) = BlackScholes.optionPrices(inputs);
        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (put, gasUsed);
    }

    function delta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (int256 deltaCall, int256 deltaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        BlackScholes.BlackScholesInputs memory inputs = BlackScholes.BlackScholesInputs(
            timeToExpirySec,
            volatility,
            spot,
            strike,
            int64(rate)
        );

        startGas = gasleft();
        (deltaCall, deltaPut) = BlackScholes.delta(inputs);
        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (deltaCall, deltaPut, gasUsed);
    }

    function vega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 _vega, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        BlackScholes.BlackScholesInputs memory inputs = BlackScholes.BlackScholesInputs(
            timeToExpirySec,
            volatility,
            spot,
            strike,
            int64(rate)
        );

        startGas = gasleft();
        _vega = BlackScholes.vega(inputs);
        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (_vega / 100, gasUsed);
    }
}
