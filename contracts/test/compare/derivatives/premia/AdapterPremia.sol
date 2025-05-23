// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OptionMath.sol";
import "./lib/ABDKMath64x64.sol";

contract AdapterPremia {

    function callPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 call;
        uint256 startGas;
        uint256 endGas;

        int128 spot64x64 = int128(uint128(uint256(spot) * 2 ** 64 / 1e18));
        int128 strike64x64 = int128(uint128(uint256(strike) * 2 ** 64 / 1e18));
        int128 timeToExpiry64x64 = int128(uint128((uint256(timeToExpirySec) * 1e18 / (365 * 24 * 60 * 60)) * 2 ** 64 / 1e18));
        int128 volatility64x64 = int128(uint128(uint256(volatility) * 2 ** 64 / 1e18));

        startGas = gasleft();

        call = uint128(OptionMath._blackScholesPrice(
            volatility64x64,
            strike64x64,
            spot64x64,
            timeToExpiry64x64,
            true
        ));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (call * 1e18 / 2 ** 64, gasUsed);
    }

    function putPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 put;
        uint256 startGas;
        uint256 endGas;

        int128 spot64x64 = int128(uint128(uint256(spot) * 2 ** 64 / 1e18));
        int128 strike64x64 = int128(uint128(uint256(strike) * 2 ** 64 / 1e18));
        int128 timeToExpiry64x64 = int128(uint128((uint256(timeToExpirySec) * 1e18 / (365 * 24 * 60 * 60)) * 2 ** 64 / 1e18));
        int128 volatility64x64 = int128(uint128(uint256(volatility) * 2 ** 64 / 1e18));

        startGas = gasleft();

        put = uint128(OptionMath._blackScholesPrice(
            volatility64x64,
            strike64x64,
            spot64x64,
            timeToExpiry64x64,
            false
        ));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (put * 1e18 / 2 ** 64, gasUsed);
    }
}
