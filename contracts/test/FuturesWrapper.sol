// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../derivatives/Futures.sol";

contract FuturesWrapper {

    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint64 rate) external pure returns (uint256) {
        return DeFiMathFutures.getFuturePrice(spot, timeToExpirySec, rate);
    }

    function getFuturePriceMG(
        uint128 spot,
        uint32 timeToExpirySec,
        uint64 rate
    ) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathFutures.getFuturePrice(spot, timeToExpirySec, rate);

        endGas = gasleft();
        
        return startGas - endGas;
    }
}
