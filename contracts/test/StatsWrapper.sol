// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../finance/Stats.sol";

contract StatsWrapper {

    function geometricMean(uint256 a, uint256 b) external pure returns (uint256) {
        return DeFiMathStats.geometricMean(a, b);
    }

    function weightedAverage(uint256[] calldata values, uint256[] calldata weights) external pure returns (uint256) {
        return DeFiMathStats.weightedAverage(values, weights);
    }

    function mean(uint256[] calldata values) external pure returns (uint256) {
        return DeFiMathStats.mean(values);
    }

    function stdDev(uint256[] calldata values) external pure returns (uint256) {
        return DeFiMathStats.stdDev(values);
    }

    // measure gas

    function geometricMeanMG(uint256 a, uint256 b) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = DeFiMathStats.geometricMean(a, b);
        return (result, startGas - gasleft());
    }

    function weightedAverageMG(uint256[] calldata values, uint256[] calldata weights) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = DeFiMathStats.weightedAverage(values, weights);
        return (result, startGas - gasleft());
    }

    function meanMG(uint256[] calldata values) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = DeFiMathStats.mean(values);
        return (result, startGas - gasleft());
    }

    function stdDevMG(uint256[] calldata values) external view returns (uint256 result, uint256 gasUsed) {
        uint256 startGas = gasleft();
        result = DeFiMathStats.stdDev(values);
        return (result, startGas - gasleft());
    }
}
