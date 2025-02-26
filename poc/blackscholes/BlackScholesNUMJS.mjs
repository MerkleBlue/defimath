import { blackScholesWrapped } from "../../test/BlackScholesDUO.test.mjs";

export const SECONDS_IN_DAY = 24 * 60 * 60;
export const SECONDS_IN_YEAR = 365 * SECONDS_IN_DAY;

// strike price +-5x from spot price
export const STRIKE_MIN = 20;                 // 20;
export const STRIKE_MAX = 500;                // 500;

// limits
export const MIN_SPOT = 0.000001;             // 1 milionth of a $
export const MAX_SPOT = 1e15;                 // 1 quadrillion $
export const MAX_STRIKE_SPOT_RATIO = 5;  
export const MAX_EXPIRATION = 63072000;       // 2 years
export const MIN_VOLATILITY = 0.01;           // 1% volatility
export const MAX_VOLATILITY = 1.92;           // 192% volatility
export const MAX_RATE = 0.2;                  // 20% risk-free rate

export const E_TO_0_03125 = 1.031743407499103;          // e ^ 0.03125
export const E = 2.7182818284590452354;                 // e
export const E_TO_32 = 78962960182680.695160978022635;  // e ^ 32

const log = false;

// solidity: 
// sqrt = 800
// exp = 340
// ln = 400
// stdNormCDF = 600 x 2 = 1200
// TOTAL: 2740 gas

// NOTE: sqrt(time) = e ^ (1/2 * ln(time)) => could be optimized below 800 gas

export class BlackScholesNUMJS {
  

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice(spot, strike, timeSec, vol, rate) {
    if (spot < MIN_SPOT) throw new Error(1);
    if (spot > MAX_SPOT) throw new Error(2);
    if (strike * MAX_STRIKE_SPOT_RATIO < spot) throw new Error(3);
    if (spot * MAX_STRIKE_SPOT_RATIO < strike) throw new Error(4);
    if (timeSec > MAX_EXPIRATION) throw new Error(5);
    if (vol < MIN_VOLATILITY) throw new Error(6);
    if (vol > MAX_VOLATILITY) throw new Error(7);
    if (rate > MAX_RATE) throw new Error(8);

    const timeYear = timeSec / SECONDS_IN_YEAR;

    const d1 = this.getD1(spot, strike, timeYear, vol, rate);
    const d2 = this.getD2(d1, timeYear, vol);
    const discountedStrike = this.getDiscountedStrike(strike, timeSec, rate);
    const callPrice = spot * this.stdNormCDF(d1) - discountedStrike * this.stdNormCDF(d2);

    return callPrice;
  };

  getPutOptionPrice(spot, strike, timeSec, vol, rate) {
    if (spot < MIN_SPOT) throw new Error(1);
    if (spot > MAX_SPOT) throw new Error(2);
    if (strike * MAX_STRIKE_SPOT_RATIO < spot) throw new Error(3);
    if (spot * MAX_STRIKE_SPOT_RATIO < strike) throw new Error(4);
    if (timeSec > MAX_EXPIRATION) throw new Error(5);
    if (vol < MIN_VOLATILITY) throw new Error(6);
    if (vol > MAX_VOLATILITY) throw new Error(7);
    if (rate > MAX_RATE) throw new Error(8);

    const timeYear = timeSec / SECONDS_IN_YEAR;

    const d1 = this.getD1(spot, strike, timeYear, vol, rate);
    const d2 = this.getD2(d1, timeYear, vol);
    const discountedStrike = this.getDiscountedStrike(strike, timeSec, rate);
    const putPrice = discountedStrike * this.stdNormCDF(-d2) - spot * this.stdNormCDF(-d1);

    return putPrice;
  };

  getFuturePrice(spot, timeSec, rate) {
    const timeYears = timeSec / SECONDS_IN_YEAR;
    const x = rate * timeYears;

    return spot * this.exp(x);
  };

  getDiscountedStrike(strike, timeSec, rate) {
    const timeYears = timeSec / SECONDS_IN_YEAR;
    const x = rate * timeYears;

    return strike / this.exp(x);
  };

  // x must be > 0, [0, 4]
  exp(x) {
    // add limits to simulate solidity
    if (x < -50) {
      return 1e-18;
    }
    if (x > 50) {
      return 1e18;
    }

    // handle special case where x = 0
    if( x === 0) {
      return 1;
    }

    const isPositive = x > 0;
    x = Math.abs(x);

    let exp1 = 1;
    let exp2 = 1;
    let exp3 = 1;

    if (x > 32) {
      const exponent = Math.floor(x / 32);
      x -= exponent * 32;
      exp1 = this.getExpPrecalculated(E_TO_32, exponent);
    }

    if (x > 1) {
      const exponent = Math.floor(x);
      x -= exponent;
      exp2 = this.getExpPrecalculated(E, exponent);
    }

    // below 1
    if (x > 0.03125) {
      const exponent = Math.floor(x / 0.03125);
      x -= exponent * 0.03125;
      exp3 = this.getExpPrecalculated(E_TO_0_03125, exponent);
    }


    log && console.log("exp1 JS:", exp1);

    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const exp4 = (numerator / denominator);
    log && console.log("exp4 JS:", exp4);
    const result = exp1 * exp2 * exp3 * exp4; // using e ^ (a + b) = e ^ a * e ^ b

    return isPositive ? result : 1 / result;
  };

  getExpPrecalculated(base, exponent) {
    // NOTE: nothing is precalculated in JS
    return base ** exponent;
  }

  // x must be positive
  // x is in range [1, 16]
  ln(x) {
    // handle special case where x = 1
    if (x === 1) {
      return 0;
    }

    const LN_1_20 = 0.086643397569993; // ln(1.090507732665258)
    const ROOT_32_OF_16 = 1.090507732665257659;
    let multiplier = 0;

    const isLargerThan1 = x > 1;

    if (!isLargerThan1) {
      x = 1 / x;
    }

    if (x > ROOT_32_OF_16) {
      // todo: always reduce x to < 1 (if x is 5 then: return -exp(1/5))
      multiplier = Math.floor(this.getBaseLog(ROOT_32_OF_16, x));
      x = x / (ROOT_32_OF_16 ** multiplier);
    }

    // we use Pade approximation for ln(x)
    // ln(x) ≈ (x - 1) / (x + 1) * (1 + 1/3 * ((x - 1) / (x + 1)) ^ 2 + 1/5 * ((x - 1) / (x + 1)) ^ 4 + 1/7 * ((x - 1) / (x + 1)) ^ 6)
    const numerator = x - 1;
    const denominator = x + 1;
    const fraction = numerator / denominator;
    // console.log("JS fraction:", fraction);
    // const fraction2 = fraction ** 2;
    // const fraction4 = fraction ** 4;
    // const fraction6 = fraction ** 6;
    // console.log("JS fraction2:", fraction2);
    // console.log("JS fraction4:", fraction4);
    // console.log("JS fraction6:", fraction6);
    const naturalLog = fraction * (1 + 1/3 * fraction ** 2 + 1/5 * fraction ** 4 + 1/7 * fraction ** 6);
    
    const finalLN = naturalLog * 2 + LN_1_20 * multiplier; // using ln(a * b) = ln(a) + ln(b)

    return isLargerThan1 ? finalLN : -finalLN;
  };

  // Maclaurin series
  // x: [1, 1.03125]
  sqrt(x) {
    x = x - 1;
    const result = 1 + x/2 - 1/8 * x ** 2 + 3 / 48 * x ** 3 - 15 / 384 * x ** 4 + 105 / 3840 * x ** 5 - 945 / 46080 * x ** 6 + 10395 / 645120 * x ** 7 - 135135 / 10321920 * x ** 8;// + 2027025 / 185794560 * x ** 9 - 34459425 / 3715891200 * x ** 10 + 654729075 / 81749606400 * x ** 11 - 13749310575 / 1961511552000 * x ** 12 + 316234143225 / 50128896076800 * x ** 13 - 7905853580625 / 1371195958095360 * x ** 14 + 213458046676875 / 39346408075264000 * x ** 15; 
    return result;
  }

  getD1(spot, strike, timeToExpiryYear, vol, rate) {
    const d1 = (rate * timeToExpiryYear + (vol ** 2) * timeToExpiryYear / 2 - this.ln(strike / spot)) / (vol * Math.sqrt(timeToExpiryYear));

    return d1;
  }

  getD2(d1, timeToExpiryYear, vol) {
    const d2 = d1 - vol * Math.sqrt(timeToExpiryYear);

    return d2;
  }
  
  // using erf function
  stdNormCDF(x) {
    return 0.5 * (1 + this.erf(x * 0.707106781186548)); // 1 / sqrt(2)
  }

  // erf maximum error: 1.5×10−7 - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions
  erf(z) {
    // Approximation of error function
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    
    const poly = a1 * t + a2 * t ** 2 + a3 * t ** 3 + a4 * t ** 4 + a5 * t ** 5;
    const approx = 1 - poly * this.exp(-z * z);
    
    return z >= 0 ? approx : -approx;
  }

  // helper function used only for ln(x) calculation, used only integers
  getBaseLog(x, y) {
    return Math.log(y) / Math.log(x);
  }
}