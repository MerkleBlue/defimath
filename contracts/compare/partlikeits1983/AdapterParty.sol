// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BlackScholesModel.sol";

contract AdapterParty {

    function callPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        int256 call;
        // uint256 put;
        uint256 startGas;
        uint256 endGas;

        uint256 timeYear = uint256(timeToExpirySec) * 1e18 / 31536000;

        BS.BlackScholesInput memory inputs = BS.BlackScholesInput(
            int256(int128(spot)),
            int256(int128(strike)),
            int256(timeYear),
            int256(int64(rate)),
            int256(int64(volatility))
        );

        // int128 spot64x64 = int128(uint128(uint256(spot) * 2 ** 64 / 1e18));
        // int128 strike64x64 = int128(uint128(uint256(strike) * 2 ** 64 / 1e18));
        // int128 timeToExpiry64x64 = int128(uint128((uint256(timeToExpirySec) * 1e18 / (365 * 24 * 60 * 60)) * 2 ** 64 / 1e18));
        // int128 volatility64x64 = int128(uint128(uint256(volatility) * 2 ** 64 / 1e18));

        startGas = gasleft();

        int result = BS.c_BS_CALL(inputs);
        if (result > 0) {
            call = result;
        }

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (uint256(call), gasUsed);
    }
}
