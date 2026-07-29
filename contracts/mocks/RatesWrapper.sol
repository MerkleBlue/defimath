// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../finance/Rates.sol";

contract RatesWrapper {

    function compoundInterest(uint128 principal, uint64 rate, uint32 timeSec) external pure returns (uint256) {
        return Rates.compoundInterest(principal, rate, timeSec);
    }

    function presentValue(uint128 futureValue, uint64 rate, uint32 timeSec) external pure returns (uint256) {
        return Rates.presentValue(futureValue, rate, timeSec);
    }

    function logReturn(uint128 currentPrice, uint128 previousPrice) external pure returns (int256) {
        return Rates.logReturn(currentPrice, previousPrice);
    }

    function continuousToDiscrete(int256 apr) external pure returns (int256) {
        return Rates.continuousToDiscrete(apr);
    }

    function discreteToContinuous(int256 apy) external pure returns (int256) {
        return Rates.discreteToContinuous(apy);
    }

    function yieldToMaturity(uint128 price, uint128 faceValue, uint32 timeToMaturity) external pure returns (int256) {
        return Rates.yieldToMaturity(price, faceValue, timeToMaturity);
    }

    function internalRateOfReturn(int256[] calldata cashflows, uint32[] calldata times, int256 guess) external pure returns (int256) {
        return Rates.internalRateOfReturn(cashflows, times, guess);
    }

    // measure gas

    function compoundInterestMG(uint128 principal, uint64 rate, uint32 timeSec) external view returns (uint256 amount, uint256 gasUsed) {
        uint256 startGas = gasleft();
        amount = Rates.compoundInterest(principal, rate, timeSec);
        return (amount, startGas - gasleft());
    }

    function presentValueMG(uint128 futureValue, uint64 rate, uint32 timeSec) external view returns (uint256 amount, uint256 gasUsed) {
        uint256 startGas = gasleft();
        amount = Rates.presentValue(futureValue, rate, timeSec);
        return (amount, startGas - gasleft());
    }

    function logReturnMG(uint128 currentPrice, uint128 previousPrice) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Rates.logReturn(currentPrice, previousPrice);
        return (y, startGas - gasleft());
    }

    function continuousToDiscreteMG(int256 apr) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Rates.continuousToDiscrete(apr);
        return (y, startGas - gasleft());
    }

    function discreteToContinuousMG(int256 apy) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Rates.discreteToContinuous(apy);
        return (y, startGas - gasleft());
    }

    function yieldToMaturityMG(uint128 price, uint128 faceValue, uint32 timeToMaturity) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Rates.yieldToMaturity(price, faceValue, timeToMaturity);
        return (y, startGas - gasleft());
    }

    function internalRateOfReturnMG(int256[] calldata cashflows, uint32[] calldata times, int256 guess) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Rates.internalRateOfReturn(cashflows, times, guess);
        return (y, startGas - gasleft());
    }
}
