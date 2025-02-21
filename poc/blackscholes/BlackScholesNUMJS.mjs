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

const log = false;

export class BlackScholesNUMJS {

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice(spot, strike, timeSec, vol, rate) {
    // step 0) check inputs
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

  getPutOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 0) check inputs
    if (spot < MIN_SPOT) throw new Error(1);
    if (spot > MAX_SPOT) throw new Error(2);
    if (strike * MAX_STRIKE_SPOT_RATIO < spot) throw new Error(3);
    if (spot * MAX_STRIKE_SPOT_RATIO < strike) throw new Error(4);
    if (timeToExpirySec > MAX_EXPIRATION) throw new Error(5);
    if (vol < MIN_VOLATILITY) throw new Error(6);
    if (vol > MAX_VOLATILITY) throw new Error(7);
    if (rate > MAX_RATE) throw new Error(8);

    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate strike scaled and discounted strike
    const discountedStrike = this.getDiscountedStrike(strike, rate, timeToExpirySec);
    const strikeScaled = (discountedStrike / spot) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);
    // console.log("timeToExpiryScaled (not rounded)", timeToExpirySec * (volRatio * volRatio));
    // console.log("strikeScaled", strikeScaled, "timeToExpirySecScaled", timeToExpirySecScaled, timeToExpirySec);

    // handle when time is 0
    if (timeToExpirySecScaled === 0) {
      return Math.max(0, strike - spot);
    }

    // step 4: interpolate price
    const finalPrice = this.interpolatePrice3(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    const callPrice = finalPrice * spotScale;
    log && console.log("call price:", finalPrice);
    log && console.log(callPrice, discountedStrike, spot);

    return Math.max(0, callPrice + discountedStrike - spot);
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

    // // we use Pade approximation for exp(x)
    // // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    // const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    // const x = rate * timeToExpiryYears;
    // const numerator = (x + 3) ** 2 + 3;
    // const denominator = (x - 3) ** 2 + 3;
    // const discountedStrikePrice = strike * (denominator / numerator);

    // const timeYears = timeSec / SECONDS_IN_YEAR;
    // const x = rate * timeYears;

    // return discountedStrikePrice;
  };

  // x is from 0 to 4
  exp(x) {
    const E_TO_005 = 1.051271096376024; // e ^ 0.05
    let exp1 = 1;

    if (x > 0.05) {
      const exponent = Math.floor(x / 0.05);
      x -= exponent * 0.05;
      exp1 = E_TO_005 ** exponent;
    }

    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const exp2 = (numerator / denominator);

    return exp1 * exp2; // using e ^ (a + b) = e ^ a * e ^ b
  };

  // helper function used only for ln(x) calculation, used only integers
  getBaseLog(x, y) {
    return Math.log(y) / Math.log(x);
  }

  ln(x) {
    // handle special case where x = 1
    if (x === 1) {
      return 0;
    }

    const LN_1_20 = 0.182321556793955;
    let multiplier = 0;

    if (x > 1.2) {
      multiplier = Math.floor(this.getBaseLog(1.2, x));
      x = x / (1.2 ** multiplier);
    }

    // we use Pade approximation for ln(x)
    // ln(x) ≈ (x - 1) / (x + 1) * (1 + 1/3 * ((x - 1) / (x + 1)) ^ 2 + 1/5 * ((x - 1) / (x + 1)) ^ 4 + 1/7 * ((x - 1) / (x + 1)) ^ 6)
    const numerator = x - 1;
    const denominator = x + 1;
    const fraction = numerator / denominator;
    const naturalLog = fraction * (1 + 1/3 * fraction ** 2 + 1/5 * fraction ** 4 + 1/7 * fraction ** 6);
    
    const finalLN = naturalLog * 2 + LN_1_20 * multiplier; // using ln(a * b) = ln(a) + ln(b)

    return finalLN;
  };

  getD1(spot, strike, timeToExpiryYear, vol, rate) {
    const d1 = (rate * timeToExpiryYear + Math.pow(vol, 2) * timeToExpiryYear / 2 - Math.log(strike / spot)) / (vol * Math.sqrt(timeToExpiryYear));


    // const discountedStrike = this.getDiscountedStrikePrice(strike, rate, timeToExpiryYear * SECONDS_IN_YEAR);
    // const d1 = this.ln(spot / discountedStrike) / vol / Math.sqrt(timeToExpiryYear) + 0.5 * vol * Math.sqrt(timeToExpiryYear);

    return d1;
  }

  getD2(d1, timeToExpiryYear, vol) {
    const d2 = d1 - vol * Math.sqrt(timeToExpiryYear);

    return d2;
  }

  stdNormCDF2(x) {
    const SQRT2PI = 2.506628274631001;

    return 0.5 + x / SQRT2PI - (x ** 3) / (6 * SQRT2PI) + (x ** 5) / (40 * SQRT2PI) - (x ** 7) / (336 * SQRT2PI) + (x ** 9) / (3456 * SQRT2PI) - (x ** 11) / (21120 * SQRT2PI);

    // errors on 3rd decimal
    // return 1 / (1 + Math.exp(-1.65451 * x));

    // by chatgpt, doesn't work
    // return 0.5 + 0.196854 * x + 0.115194 * (x ** 2) + 0.000344 * (x ** 3) + 0.019527 * (x ** 4);
  };

  // stdNormCDF(x) {
  //   const SQRT2PI = 2.506628274631001;

  //   return 0.5 + x / SQRT2PI - (x ** 3) / (6 * SQRT2PI) + (x ** 5) / (40 * SQRT2PI) - (x ** 7) / (336 * SQRT2PI) + (x ** 9) / (3456 * SQRT2PI) - (x ** 11) / (21120 * SQRT2PI) + (x ** 13) / (599040 * SQRT2PI)

  //   // errors on 3rd decimal
  //   // return 1 / (1 + Math.exp(-1.65451 * x));

  //   // by chatgpt, doesn't work
  //   // return 0.5 + 0.196854 * x + 0.115194 * (x ** 2) + 0.000344 * (x ** 3) + 0.019527 * (x ** 4);
  // };

  // from bs
  stdNormCDF3(x)
  {
    var probability = 0;
    // avoid divergence in the series which happens around +/-8 when summing the
    // first 100 terms
    if(x >= 8)
    {
      probability = 1;
    }
    else if(x <= -8)
    {
      probability = 0;
    }
    else
    {
      for(var i = 0; i < 100; i++)
      {
        probability += (Math.pow(x, 2*i+1)/this._doubleFactorial(2*i+1));
      }
      probability *= Math.pow(Math.E, -0.5*Math.pow(x, 2));
      probability /= Math.sqrt(2*Math.PI);
      probability += 0.5;
    }
    return probability;
  }

  _doubleFactorial(n)
  {
    var val = 1;
    for(var i = n; i > 1; i-=2)
    {
      val *= i;
    }
    return val;
  }

  _abs(x) {
    return x < 0 ? -x : x;
  }

  
  // Exponentiation function (this is an approximation for exp() as it's not available in basic JS)
  expE(x) {
    return Math.exp(x / PRECISE_UNIT);
  }
  
  // using erf function, abs error is up to $0.000100
  stdNormCDF(x) {
    // erf maximum error: 1.5×10−7 - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions
    function erf(z) {
      // Approximation of error function
      const t = 1 / (1 + 0.3275911 * Math.abs(z));
      const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
      
      const poly = a1 * t + a2 * t ** 2 + a3 * t ** 3 + a4 * t ** 4 + a5 * t ** 5;
      const approx = 1 - poly * Math.exp(-z * z);
      
      return z >= 0 ? approx : -approx;
    }

    // OLD CODE
    // // taylor series approximation
    // function erf2(z) {
    //   const TWO_SQRT_PI = 2 / Math.sqrt(Math.PI);

    //   const result = TWO_SQRT_PI * (z - (z ** 3) / 3 + (z ** 5) / 10 - (z ** 7) / 42 + (z ** 9) / 216);
      
    //   return result;
    // }
    
    return 0.5 * (1 + erf(x / Math.sqrt(2)));
  }
}