// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../derivatives/Options.sol";

contract OptionsWrapper {

    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathOptions.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getPutOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathOptions.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getDelta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return DeFiMathOptions.getDelta(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getCallOptionPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathOptions.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function getPutOptionPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathOptions.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function getDeltaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut,  uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        (deltaCall, deltaPut) = DeFiMathOptions.getDelta(spot, strike, timeToExpirySec, volatility, rate);
        endGas = gasleft();
        
        return (deltaCall, deltaPut, startGas - endGas);
    }
}
