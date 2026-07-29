// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../statistics/Statistics.sol";

contract StatisticsWrapper {

    function geometricMean(uint256 a, uint256 b) external pure returns (uint256) {
        return Statistics.geometricMean(a, b);
    }

    function weightedAverage(uint256[] calldata values, uint256[] calldata weights) external pure returns (uint256) {
        return Statistics.weightedAverage(values, weights);
    }

    function mean(uint256[] calldata values) external pure returns (uint256) {
        return Statistics.mean(values);
    }

    function stdDev(uint256[] calldata values) external pure returns (uint256) {
        return Statistics.stdDev(values);
    }

    function historicalVolatility(uint256[] calldata prices, uint32 intervalSec) external pure returns (uint256) {
        return Statistics.historicalVolatility(prices, intervalSec);
    }

    function sharpeRatio(uint256[] calldata prices, uint32 intervalSec, uint64 riskFreeRateAnnual) external pure returns (int256) {
        return Statistics.sharpeRatio(prices, intervalSec, riskFreeRateAnnual);
    }

    function maxDrawdown(uint256[] calldata equity) external pure returns (uint256) {
        return Statistics.maxDrawdown(equity);
    }

    function valueAtRisk(uint256[] calldata prices, uint64 confidence) external pure returns (int256) {
        return Statistics.valueAtRisk(prices, confidence);
    }

    function conditionalValueAtRisk(uint256[] calldata prices, uint64 confidence) external pure returns (int256) {
        return Statistics.conditionalValueAtRisk(prices, confidence);
    }

    // measure gas

    function geometricMeanMG(uint256 a, uint256 b) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.geometricMean(a, b);
        return (result, startGas - gasleft());
    }

    function weightedAverageMG(uint256[] calldata values, uint256[] calldata weights) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.weightedAverage(values, weights);
        return (result, startGas - gasleft());
    }

    function meanMG(uint256[] calldata values) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.mean(values);
        return (result, startGas - gasleft());
    }

    function stdDevMG(uint256[] calldata values) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.stdDev(values);
        return (result, startGas - gasleft());
    }

    function historicalVolatilityMG(uint256[] calldata prices, uint32 intervalSec) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.historicalVolatility(prices, intervalSec);
        return (result, startGas - gasleft());
    }

    function sharpeRatioMG(uint256[] calldata prices, uint32 intervalSec, uint64 riskFreeRateAnnual) external view returns (int256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.sharpeRatio(prices, intervalSec, riskFreeRateAnnual);
        return (result, startGas - gasleft());
    }

    function maxDrawdownMG(uint256[] calldata equity) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.maxDrawdown(equity);
        return (result, startGas - gasleft());
    }

    function valueAtRiskMG(uint256[] calldata prices, uint64 confidence) external view returns (int256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.valueAtRisk(prices, confidence);
        return (result, startGas - gasleft());
    }

    function conditionalValueAtRiskMG(uint256[] calldata prices, uint64 confidence) external view returns (int256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = Statistics.conditionalValueAtRisk(prices, confidence);
        return (result, startGas - gasleft());
    }
}
