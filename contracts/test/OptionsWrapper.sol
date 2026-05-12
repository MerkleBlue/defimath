// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../derivatives/Options.sol";

contract OptionsWrapper {

    function callOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathOptions.callOptionPrice(spot, strike, timeToExp, volatility, rate);
    }

    function putOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathOptions.putOptionPrice(spot, strike, timeToExp, volatility, rate);
    }

    function delta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return DeFiMathOptions.delta(spot, strike, timeToExp, volatility, rate);
    }

    function gamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 gamma) {
        return DeFiMathOptions.gamma(spot, strike, timeToExp, volatility, rate);
    }

    function theta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 thetaCall, int128 thetaPut) {
        return DeFiMathOptions.theta(spot, strike, timeToExp, volatility, rate);
    }

    function vega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 vega) {
        return DeFiMathOptions.vega(spot, strike, timeToExp, volatility, rate);
    }

    function callOptionPriceMG(
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

        result = DeFiMathOptions.callOptionPrice(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function putOptionPriceMG(
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

        result = DeFiMathOptions.putOptionPrice(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function deltaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut,  uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        (deltaCall, deltaPut) = DeFiMathOptions.delta(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();
        
        return (deltaCall, deltaPut, startGas - endGas);
    }

    function gammaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 gamma, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        gamma = DeFiMathOptions.gamma(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();
        
        return (gamma, startGas - endGas);
    }

    function thetaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 thetaCall, int128 thetaPut,  uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        (thetaCall, thetaPut) = DeFiMathOptions.theta(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();
        
        return (thetaCall, thetaPut, startGas - endGas);
    }

    function vegaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 vega, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        vega = DeFiMathOptions.vega(spot, strike, timeToExp, volatility, rate);
        endGas = gasleft();

        return (vega, startGas - endGas);
    }

    function impliedVolatility(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) external pure returns (uint256 volatility) {
        return DeFiMathOptions.impliedVolatility(spot, strike, timeToExp, rate, optionPrice, isCall);
    }

    function impliedVolatilityMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) external view returns (uint256 volatility, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        volatility = DeFiMathOptions.impliedVolatility(spot, strike, timeToExp, rate, optionPrice, isCall);
        endGas = gasleft();

        return (volatility, startGas - endGas);
    }
}
