// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "./Binaries.sol";
import "./BlackScholes.sol";

contract AdapterHaptic {

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
        (call,) = Binaries._cashOrNothingPrices(inputs);
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
        (, put) = Binaries._cashOrNothingPrices(inputs);
        endGas = gasleft();

        gasUsed = startGas - endGas;
        return (put, gasUsed);
    }
}
