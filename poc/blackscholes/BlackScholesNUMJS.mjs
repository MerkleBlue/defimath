export const SECONDS_IN_YEAR = 31536000;

// limits
export const MIN_SPOT = 0.000001;             // 1 milionth of a $
export const MAX_SPOT = 1e15;                 // 1 quadrillion $
export const MAX_STRIKE_SPOT_RATIO = 5;  
export const MAX_EXPIRATION = 63072000;       // 2 years
export const MAX_RATE = 4;                    // 400% risk-free rate

export const E_TO_0_03125 = 1.031743407499103;          // e ^ 0.03125
export const E = 2.7182818284590452354;                 // e
export const E_TO_32 = 78962960182680.695160978022635;  // e ^ 32

export class BlackScholesNUMJS {
  

  getCallOptionPrice(spot, strike, timeSec, vol, rate) {
    // check inputs
    this.checkInputs(spot, strike, timeSec, rate);

    // handle expired call 
    if (timeSec == 0) {
      if (spot > strike) {
          return spot - strike;
      }
      return 0;
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledVol = vol * Math.sqrt(timeYear) + 1e-16;
    const scaledRate = rate * timeYear;

    const d1 = this.getD1(spot, strike, timeYear, scaledVol, rate);
    const d2 = d1 - scaledVol;
    const discountedStrike = strike / this.exp(scaledRate);

    const spotNd1 = spot * this.stdNormCDF(d1);                                // spot * N(d1)
    const strikeNd2 = discountedStrike * this.stdNormCDF(d2);                  // strike * N(d2)

    if (spotNd1 > strikeNd2) {
        return spotNd1 - strikeNd2;
    }

    return 0;
  };

  getPutOptionPrice(spot, strike, timeSec, vol, rate) {
    // check inputs
    this.checkInputs(spot, strike, timeSec, rate);

    // handle expired put 
    if (timeSec == 0) {
      if (strike > spot) {
          return strike - spot;
      }
      return 0;
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledVol = vol * Math.sqrt(timeYear) + 1e-16;
    const scaledRate = rate * timeYear;

    const d1 = this.getD1(spot, strike, timeYear, scaledVol, rate);
    const d2 = d1 - scaledVol;
    const discountedStrike = strike / this.exp(scaledRate);

    const spotNd1 = spot * this.stdNormCDF(-d1);                               // spot * N(-d1)
    const strikeNd2 = discountedStrike * this.stdNormCDF(-d2);                 // strike * N(-d2)

    if (strikeNd2 > spotNd1) {
        return strikeNd2 - spotNd1;
    }

    return 0;
  };

  getFuturePrice(spot, timeSec, rate) {
    if (spot < MIN_SPOT) throw new Error("SpotLowerBoundError");
    if (spot > MAX_SPOT) throw new Error("SpotUpperBoundError");
    if (timeSec > MAX_EXPIRATION) throw new Error("TimeToExpiryUpperBoundError");
    if (rate > MAX_RATE) throw new Error("RateUpperBoundError");

    // handle expired future 
    if (timeSec == 0) {
      return spot;
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledRate = rate * timeYear;

    return spot * this.exp(scaledRate);
  };

  getDelta(spot, strike, timeSec, vol, rate) {
    // check inputs
    this.checkInputs(spot, strike, timeSec, rate);

    // handle expired option 
    if (timeSec == 0) {
      if (spot > strike) {
          return { deltaCall: 1, deltaPut: 0 };
      }
      return { deltaCall: 0, deltaPut: 1 };
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledVol = vol * Math.sqrt(timeYear) + 1e-16;

    const d1 = this.getD1(spot, strike, timeYear, scaledVol, rate);

    const deltaCall = this.stdNormCDF(d1);
    const deltaPut = deltaCall - 1;

    return { deltaCall, deltaPut };
  };

  getGamma(spot, strike, timeSec, vol, rate) {
    // check inputs
    this.checkInputs(spot, strike, timeSec, rate);

    // handle expired option 
    if (timeSec == 0) {
      return 0;
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledVol = vol * Math.sqrt(timeYear) + 1e-16;

    const d1 = this.getD1(spot, strike, timeYear, scaledVol, rate);

    const phi = Math.exp(-(d1 ** 2) / 2) / Math.sqrt(2 * Math.PI);    // N'(d1)
    return phi / (spot * scaledVol);                                  // N'(d1) / (spot * scaledVol)
  };

  getTheta(spot, strike, timeSec, vol, rate) {
    // check inputs
    this.checkInputs(spot, strike, timeSec, rate);

    // handle expired option 
    if (timeSec == 0) {
      return { thetaCall: 0, thetaPut: 0 };
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledVol = vol * Math.sqrt(timeYear) + 1e-16;

    const d1 = this.getD1(spot, strike, timeYear, scaledVol, rate);
    const d2 = d1 - scaledVol;

    const phi = Math.exp(-(d1 ** 2) / 2) / Math.sqrt(2 * Math.PI);

    // console.log("timeDecay JS ", (spot * vol * phi) / (2 * Math.sqrt(timeYear)));
    // console.log("carryCall JS ", rate * strike * this.exp(-rate * timeYear) * this.stdNormCDF(d2));
    // console.log("carryPut JS ", rate * strike * this.exp(-rate * timeYear) * this.stdNormCDF(-d2));

    const thetaCall = (-(spot * vol * phi) / (2 * Math.sqrt(timeYear)) - rate * strike * this.exp(-rate * timeYear) * this.stdNormCDF(d2)) / 365; // N'(d1) / (2 * sqrt(t)) - r * K * e^(-r*t) * N(d2)
    const thetaPut = (-(spot * vol * phi) / (2 * Math.sqrt(timeYear)) + rate * strike * this.exp(-rate * timeYear) * this.stdNormCDF(-d2)) / 365; // N'(d1) / (2 * sqrt(t)) + r * K * e^(-r*t) * N(-d2)
    return { thetaCall, thetaPut };
  };

  getVega(spot, strike, timeSec, vol, rate) {
    // check inputs
    this.checkInputs(spot, strike, timeSec, rate);

    // handle expired option 
    if (timeSec == 0) {
      return 0;
    }

    const timeYear = timeSec / SECONDS_IN_YEAR;
    const scaledVol = vol * Math.sqrt(timeYear) + 1e-16;

    const d1 = this.getD1(spot, strike, timeYear, scaledVol, rate);

    const phi = Math.exp(-(d1 ** 2) / 2) / Math.sqrt(2 * Math.PI);    // N'(d1)
    return spot * Math.sqrt(timeYear) * phi / 100;                    // 
  };

  checkInputs(spot, strike, timeSec, rate) {
    if (spot < MIN_SPOT) throw new Error("SpotLowerBoundError");
    if (spot > MAX_SPOT) throw new Error("SpotUpperBoundError");
    if (spot * MAX_STRIKE_SPOT_RATIO < strike) throw new Error("StrikeUpperBoundError");
    if (strike * MAX_STRIKE_SPOT_RATIO < spot) throw new Error("StrikeLowerBoundError");
    if (timeSec > MAX_EXPIRATION) throw new Error("TimeToExpiryUpperBoundError");
    if (rate > MAX_RATE) throw new Error("RateUpperBoundError");
  }

  // x: [-50, 50]
  exp(x) {
    if (x >= 0) {
      return this.expPositive(x);
    }

    return 1 / this.expPositive(-x);
  };

  // x: [0, 50]
  expPositive(x) {

    return Math.exp(x);
    // add limits to simulate solidity
    if (x > 50) {
      return 1e18;
    }

    // handle special case where x = 0
    if( x === 0) {
      return 1;
    }

    let exp1 = 1;
    let exp2 = 1;
    let exp3 = 1;

    if (x > 32) {
      const exponent = Math.floor(x / 32);
      x -= exponent * 32;
      exp1 = E_TO_32 ** exponent;
    }

    if (x > 1) {
      const exponent = Math.floor(x);
      x -= exponent;
      exp2 = E ** exponent;
    }

    // below 1
    if (x > 0.03125) {
      const exponent = Math.floor(x / 0.03125);
      x -= exponent * 0.03125;
      exp3 = E_TO_0_03125 ** exponent;
    }

    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const exp4 = (numerator / denominator);
    return exp1 * exp2 * exp3 * exp4; // using e ^ (a + b) = e ^ a * e ^ b
  };

  expPositive3(x) {

    // step 1
    const k = Math.floor(x / 0.693147180559945309);
    x = (x - k * 0.693147180559945309) / 256;

    // console.log("step 1 JS ", k, x);

    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    let r = (numerator / denominator);

    // console.log("step 2 JS ", r);

    r = r * r;
    // console.log("step 2.1 JS ", r);

    r = r * r;
    // console.log("step 2.2 JS ", r);

    r = r * r;
    // console.log("step 2.3 JS ", r);

    r = r * r;
    // console.log("step 2.4 JS ", r);

    r = r * r;
    // console.log("step 2.5 JS ", r);

    r = r ** 8 * 2 ** k;

    return r;
  };

  ln(x) {
    if (x >= 1) {
      return this.lnUpper(x);
    }

    return -this.lnUpper(1 / x)
  }

  log2(x) {
    if (x >= 1) {
      return this.lnUpper(x) / 0.69314718055994530942;
    }

    return -this.lnUpper(1 / x) / 0.69314718055994530942
  }

  log10(x) {
    if (x >= 1) {
      return this.lnUpper(x) / 2.302585092994046;
    }

    return -this.lnUpper(1 / x) / 2.302585092994046
  }

  // x: [1, 16]
  lnUpper(x) {
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
      multiplier = Math.floor(this.getBaseLog(ROOT_32_OF_16, x));
      x = x / (ROOT_32_OF_16 ** multiplier);
    }

    // we use Pade approximation for ln(x)
    // ln(x) ≈ (x - 1) / (x + 1) * (1 + 1/3 * ((x - 1) / (x + 1)) ^ 2 + 1/5 * ((x - 1) / (x + 1)) ^ 4 + 1/7 * ((x - 1) / (x + 1)) ^ 6)
    const numerator = x - 1;
    const denominator = x + 1;
    const fraction = numerator / denominator;

    const naturalLog = fraction * (1 + 1/3 * fraction ** 2 + 1/5 * fraction ** 4 + 1/7 * fraction ** 6);
    
    const finalLN = naturalLog * 2 + LN_1_20 * multiplier; // using ln(a * b) = ln(a) + ln(b)

    return isLargerThan1 ? finalLN : -finalLN;
  };

  sqrt(x) {
    if (x >= 1) {
      return this.sqrtUpper(x);
    }

    return 1 / this.sqrtUpper(1 / x);
  }

  // x: [1, 1e8]
  sqrtUpper(x) {
    const BASE_ROOT = 1.074607828321317497; // 64th root of 100
    let zeros = 1;
    let sqrtPrecompute = 1;

    // x: [100, 1e8) use scalability rule: sqrt(1234) = 10 * sqrt(12.34);
    if (x >= 100) {
      zeros = this.getSqrtZerosPrecompute(x);
      x /= zeros ** 2;
    }

    // x: [1.076, 100) use precomputed values
    if (x >= BASE_ROOT) {
      sqrtPrecompute = Math.sqrt(BASE_ROOT ** Math.floor(this.getBaseLog(BASE_ROOT, x)));
      x /= sqrtPrecompute ** 2;
    }

    // x: [1, 1.076] use Maclaurin series
    x -= 1;
    const sqrtAprox = 1 + x/2 - 1/8 * x ** 2 + 3/48 * x ** 3 - 15/384 * x ** 4 + 105/3840 * x ** 5 - 945/46080 * x ** 6 + 10395/645120 * x ** 7 - 135135/10321920 * x ** 8;// + 2027025 / 185794560 * x ** 9 - 34459425 / 3715891200 * x ** 10 + 654729075 / 81749606400 * x ** 11 - 13749310575 / 1961511552000 * x ** 12 + 316234143225 / 50128896076800 * x ** 13 - 7905853580625 / 1371195958095360 * x ** 14 + 213458046676875 / 39346408075264000 * x ** 15; 

    return sqrtAprox * sqrtPrecompute * zeros;
  }

  getD1(spot, strike, timeYear, volAdj, rate) {
    const d1 = (rate * timeYear + (volAdj ** 2) / 2 - this.lnUpper(strike / spot)) / volAdj;

    return d1;
  }
  
  // using erf function
  stdNormCDF(x) {
    return 0.5 * (1 + this.erf(x * 0.707106781186548)); // 1 / sqrt(2)
  }

  erf(x) {
    let xAbs = Math.abs(x) * Math.SQRT2;
    let c = 0;
    
    if (xAbs <= 37) {
        let e = this.exp(-xAbs * xAbs / 2);
        if (xAbs < 7.07106781186547) {
          let num = 0.0352624965998911 * xAbs ** 6 + 0.700383064443688 * xAbs ** 5 + 6.37396220353165 * xAbs ** 4 + 33.912866078383 * xAbs ** 3 + 112.079291497871 * xAbs ** 2 + 221.213596169931 * xAbs + 220.206867912376;
          // console.log("num JS:", num);
          let den = 0.0883883476483184 * xAbs ** 7 + 1.75566716318264 * xAbs ** 6 + 16.064177579207 * xAbs ** 5 + 86.7807322029461 * xAbs ** 4 + 296.564248779674 * xAbs ** 3 + 637.333633378831 * xAbs ** 2 + 793.826512519948 * xAbs + 440.413735824752;
          // console.log("denom JS:", den);
          c = e * num / den;
        } else {
            let b = xAbs + 0.65;
            b = xAbs + 4 / b;
            b = xAbs + 3 / b;
            b = xAbs + 2 / b;
            b = xAbs + 1 / b;
            c = e / b / 2.506628274631;
        }
    }
    
    return x > 0 ? 1 - 2 * c : 2 * c - 1;
  }

  // helper function used only for ln(x) calculation, used only integers
  getBaseLog(x, y) {
    return Math.log(y) / Math.log(x);
  }

  getSqrtZerosPrecompute(x) {
    if (x >= 1e4) { // 4 + 18
      if (x >= 1e6) { // 6 + 18
          return 1000;
      } else {
          return 100;
      }
    }
  
    // x is always >= 100 
    return 10;
  }
}
