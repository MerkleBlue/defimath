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
        uint256 call;
        uint256 startGas;
        uint256 endGas;
        int256 result;

        uint256 timeYear = uint256(timeToExpirySec) * 1e18 / 31536000;

        BS.BlackScholesInput memory inputs = BS.BlackScholesInput(
            int256(int128(spot)),
            int256(int128(strike)),
            int256(timeYear),
            int256(int64(rate)),
            int256(int64(volatility))
        );

        startGas = gasleft();
        result = BS.c_BS_CALL(inputs);
        endGas = gasleft();

        if (result > 0) {
            call = uint256(result);
        }
        
        return (call, startGas - endGas);
    }

    function putPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 call;
        uint256 startGas;
        uint256 endGas;
        int256 result;

        uint256 timeYear = uint256(timeToExpirySec) * 1e18 / 31536000;

        BS.BlackScholesInput memory inputs = BS.BlackScholesInput(
            int256(int128(spot)),
            int256(int128(strike)),
            int256(timeYear),
            int256(int64(rate)),
            int256(int64(volatility))
        );

        startGas = gasleft();
        result = BS.c_BS_PUT(inputs);
        endGas = gasleft();

        if (result > 0) {
            call = uint256(result);
        }
        
        gasUsed = startGas - endGas;
        return (call, gasUsed);
    }
}
