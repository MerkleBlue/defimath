// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../finance/Rates.sol";

contract RatesWrapper {

    function compoundInterest(uint128 principal, uint64 rate, uint32 timeSec) external pure returns (uint256) {
        return DeFiMathRates.compoundInterest(principal, rate, timeSec);
    }

    function presentValue(uint128 futureValue, uint64 rate, uint32 timeSec) external pure returns (uint256) {
        return DeFiMathRates.presentValue(futureValue, rate, timeSec);
    }

    function logReturn(uint128 newPrice, uint128 oldPrice) external pure returns (int256) {
        return DeFiMathRates.logReturn(newPrice, oldPrice);
    }

    function continuousToDiscrete(int256 r) external pure returns (int256) {
        return DeFiMathRates.continuousToDiscrete(r);
    }

    function discreteToContinuous(int256 r) external pure returns (int256) {
        return DeFiMathRates.discreteToContinuous(r);
    }

    // measure gas

    function compoundInterestMG(uint128 principal, uint64 rate, uint32 timeSec) external view returns (uint256 amount, uint256 gasUsed) {
        uint256 startGas = gasleft();
        amount = DeFiMathRates.compoundInterest(principal, rate, timeSec);
        return (amount, startGas - gasleft());
    }

    function presentValueMG(uint128 futureValue, uint64 rate, uint32 timeSec) external view returns (uint256 amount, uint256 gasUsed) {
        uint256 startGas = gasleft();
        amount = DeFiMathRates.presentValue(futureValue, rate, timeSec);
        return (amount, startGas - gasleft());
    }

    function logReturnMG(uint128 newPrice, uint128 oldPrice) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = DeFiMathRates.logReturn(newPrice, oldPrice);
        return (y, startGas - gasleft());
    }

    function continuousToDiscreteMG(int256 r) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = DeFiMathRates.continuousToDiscrete(r);
        return (y, startGas - gasleft());
    }

    function discreteToContinuousMG(int256 r) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = DeFiMathRates.discreteToContinuous(r);
        return (y, startGas - gasleft());
    }
}
