// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BlackScholes.sol";

contract AdapterDopex {

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

        uint256 timeToExpiryDays = uint256(timeToExpirySec) * 1e18 / (24 * 60 * 60);

        startGas = gasleft();
        call = BlackScholes.calculate(
            0,
            spot,
            strike,
            timeToExpiryDays,
            rate,
            volatility
        );
        endGas = gasleft();
        
        return (call, startGas - endGas);
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

        uint256 timeToExpiryDays = uint256(timeToExpirySec) * 1e18 / (24 * 60 * 60);

        startGas = gasleft();
        put = BlackScholes.calculate(
            1,
            spot,
            strike,
            timeToExpiryDays,
            rate,
            volatility
        );
        endGas = gasleft();
        
        return (put, startGas - endGas);
    }
}
