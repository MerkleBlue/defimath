// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./lib/Statistics.sol";

library BS {
    using PRBMathSD59x18 for int256;

    /// @notice BSOptionParams
    /// @dev nested struct BS_params 
    struct BSOptionParams {
        int K; 
        int T; 
        int r; 
        int sigma; 
    }

    /// @notice BlackScholesInput
    /// @dev Only used internally by smart contract
    struct BlackScholesInput {
        int S;
        int K; 
        int T; 
        int r; 
        int sigma; 
    }

    /// @notice BS_params
    /// @dev User 1 input
    struct BS_params {
        address tokenA;
        address tokenB;

        uint tokenA_balance;
        uint tokenB_balance;

        bool isCall;
        bool isLong;

        uint amount;
        uint expiry;
        uint fees;
        uint perDay;
        uint hedgeFee;

        uint lastHedgeTimeStamp;

        BSOptionParams parameters;
    }

    /// @notice d1 of Black Scholes
    /// @param S price
    /// @param K strike
    /// @param r risk free rate
    /// @param sigma volatility
    /// @param T expiry
    /// @return d1 d1
    function D1(int S,int K, int r, int sigma, int T) internal pure returns (int){
        int d1 = ((S.div(K)).ln() + (r + ((sigma.pow(2e18)).div(2e18)).mul(T))).div(sigma.mul(T.sqrt()));
        return d1;
    }

    /// @notice d2 of Black Scholes
    /// @param d1 d1
    /// @param sigma volatility
    /// @param T expiry
    /// @return d2 d2
    function D2(int d1, int sigma, int T) internal pure returns (int){
        int d2 = d1 - sigma.mul(T.sqrt());
        return d2;
    }

    /// @notice BS Call (returns price and delta)
    /// @param _params BlackScholesInput
    /// @return C price
    /// @return delta delta
    function BS_CALL(BlackScholesInput memory _params) internal pure returns (int C, int delta) {
        int d1 = D1(_params.S,_params.K,_params.r,_params.sigma,_params.T);
        int d2 = D2(d1,_params.sigma,_params.T);
        C = _params.S.mul(Statistics.cdf(d1)) - (_params.K.mul((-_params.r.mul(_params.T)).exp()).mul(Statistics.cdf(d2)));
        delta = Statistics.cdf(d1);
        return (C,delta);
    }

    /// @notice BS Call (returns price)
    /// @param _params BlackScholesInput
    /// @return C price
    function c_BS_CALL(BlackScholesInput memory _params) internal pure returns (int C) {
        int d1 = D1(_params.S,_params.K,_params.r,_params.sigma,_params.T);
        int d2 = D2(d1,_params.sigma,_params.T);
        C = _params.S.mul(Statistics.cdf(d1)) - (_params.K.mul((-_params.r.mul(_params.T)).exp()).mul(Statistics.cdf(d2)));
        return C;
    }

    /// @notice BS Call (returns delta)
    /// @param _params BlackScholesInput
    /// @return delta price
    function delta_BS_CALL(BlackScholesInput memory _params) internal pure returns (int delta) {
        int d1 = D1(_params.S,_params.K,_params.r,_params.sigma,_params.T);
        delta = Statistics.cdf(d1);
        return delta;
    }

    /// @notice BS Put (returns price and delta)
    /// @param _params BlackScholesInput
    /// @return C price
    /// @return delta delta
    function BS_PUT(BlackScholesInput memory _params) internal pure returns (int C, int delta) {
        int d1 = D1(_params.S,_params.K,_params.r,_params.sigma,_params.T);
        int d2 = D2(d1,_params.sigma,_params.T);
        C = _params.K.mul((-_params.r.mul(_params.T)).exp()).mul(Statistics.cdf(-d2)) - (_params.S.mul(Statistics.cdf(-d1)));
        delta = Statistics.cdf(d1) - 1e18;
        return (C,delta);
    }

    /// @notice BS Put (returns price)
    /// @param _params BlackScholesInput
    /// @return C price
    function c_BS_PUT(BlackScholesInput memory _params) internal pure returns (int C) {
        int d1 = D1(_params.S,_params.K,_params.r,_params.sigma,_params.T);
        int d2 = D2(d1,_params.sigma,_params.T);
        C = _params.K.mul((-_params.r.mul(_params.T)).exp()).mul(Statistics.cdf(-d2)) - (_params.S.mul(Statistics.cdf(-d1)));
        return C;
    }

    /// @notice BS Put (returns delta)
    /// @param _params BlackScholesInput
    /// @return delta price
    function delta_BS_PUT(BlackScholesInput memory _params) internal pure returns (int delta) {
        int d1 = D1(_params.S,_params.K,_params.r,_params.sigma,_params.T);
        delta = Statistics.cdf(d1) - 1e18;
        return delta;
    }
}