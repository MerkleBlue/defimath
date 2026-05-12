// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../derivatives/Futures.sol";

contract FuturesWrapper {

    function futurePrice(uint128 spot, uint32 timeToExpirySec, uint64 rate) external pure returns (uint256) {
        return DeFiMathFutures.futurePrice(spot, timeToExpirySec, rate);
    }

    function futurePriceMG(
        uint128 spot,
        uint32 timeToExpirySec,
        uint64 rate
    ) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathFutures.futurePrice(spot, timeToExpirySec, rate);

        endGas = gasleft();
        
        return startGas - endGas;
    }
}
