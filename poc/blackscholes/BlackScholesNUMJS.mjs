import { levenbergMarquardt } from 'ml-levenberg-marquardt';

export const SECONDS_IN_YEAR = 31536000;

// limits
export const MIN_SPOT = 0.000001;             // 1 milionth of a $
export const MAX_SPOT = 1e15;                 // 1 quadrillion $
export const MAX_STRIKE_SPOT_RATIO = 5;  
export const MAX_EXPIRATION = 63072000;       // 2 years
export const MAX_VOLATILITY = 4;              // 400% volatility
export const MAX_RATE = 4;                    // 400% risk-free rate

export const E_TO_0_03125 = 1.031743407499103;          // e ^ 0.03125
export const E = 2.7182818284590452354;                 // e
export const E_TO_32 = 78962960182680.695160978022635;  // e ^ 32

const log = false;

function quadraticFit([a, b]) {
  return (x) => a * x * x + b * x;
}

function cubeFit([a, b, c]) {
  return (x) => a * x ** 3 + b * x ** 2 + c * x;
}

export class BlackScholesNUMJS {
  

  getCallOptionPrice(spot, strike, timeSec, vol, rate) {
    if (spot < MIN_SPOT) throw new Error("SpotLowerBoundError");
    if (spot > MAX_SPOT) throw new Error("SpotUpperBoundError");
    if (spot * MAX_STRIKE_SPOT_RATIO < strike) throw new Error("StrikeUpperBoundError");
    if (strike * MAX_STRIKE_SPOT_RATIO < spot) throw new Error("StrikeLowerBoundError");
    if (timeSec > MAX_EXPIRATION) throw new Error("TimeToExpiryUpperBoundError");
    if (rate > MAX_RATE) throw new Error("RateUpperBoundError");

    // handle expired option 
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

    log && console.log("JS volAdj:", scaledVol);
    log && console.log("JS d1:", d1);
    log && console.log("JS d2:", d2);
    log && console.log("JS discountedStrike:", discountedStrike);

    const spotNd1 = spot * this.stdNormCDF(d1);                                // spot * N(d1)
    const strikeNd2 = discountedStrike * this.stdNormCDF(d2);                  // strike * N(d2)

    if (spotNd1 > strikeNd2) {
        return spotNd1 - strikeNd2;
    }

    return 0;
  };

  getPutOptionPrice(spot, strike, timeSec, vol, rate) {
    if (spot < MIN_SPOT) throw new Error("SpotLowerBoundError");
    if (spot > MAX_SPOT) throw new Error("SpotUpperBoundError");
    if (spot * MAX_STRIKE_SPOT_RATIO < strike) throw new Error("StrikeUpperBoundError");
    if (strike * MAX_STRIKE_SPOT_RATIO < spot) throw new Error("StrikeLowerBoundError");
    if (timeSec > MAX_EXPIRATION) throw new Error("TimeToExpiryUpperBoundError");
    if (rate > MAX_RATE) throw new Error("RateUpperBoundError");

    // handle expired option 
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

  // x: [-50, 50]
  exp(x) {
    if (x >= 0) {
      return this.expPositive(x);
    }

    return 1 / this.expPositive(-x);
  };

  // x: [0, 50]
  expPositive(x) {
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

  ln(x) {
    if (x >= 1) {
      return this.lnUpper(x);
    }

    return -this.lnUpper(1 / x)
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
      // todo: always reduce x to < 1 (if x is 5 then: return -exp(1/5))
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

  // erf maximum error: 1.5×10−7 - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions
  erf(z) {
    // console.log("JS z:", z);
    // Approximation of error function
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    // console.log("JS t:", t);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    
    const poly = a1 * t + a2 * t ** 2 + a3 * t ** 3 + a4 * t ** 4 + a5 * t ** 5;
    // console.log("JS poly:", poly);
    const approx = 1 - poly * this.exp(-z * z);
    // console.log("JS approx:", approx);
    
    return z >= 0 ? approx : -approx;
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

  erfCody(z) {

    z = Decimal(z);
    const sign = z.lt(0) ? Decimal('-1') : Decimal('1');
    z = z.abs();
    if (z.lte(Decimal('0.5'))) {
        const z2 = z.mul(z);
        return sign.mul(Decimal('1.12837916709551257389615890312')).mul(z).mul(Decimal('1').sub(z2.div(Decimal('3'))).add(z2.mul(z2).div(Decimal('10'))).sub(z2.mul(z2).mul(z2).div(Decimal('42'))));
    } else if (z.lte(Decimal('4.0'))) {
        const z2 = z.mul(z);
        const expNegZ2 = Decimal.exp(z2.neg());
        const t = Decimal('1').div(Decimal('1').add(Decimal('0.3275911').mul(z)));
        const p = Decimal('0.2548295925').mul(t)
            .plus(Decimal('-0.284496736').mul(t.mul(t)))
            .plus(Decimal('1.421413741').mul(t.mul(t).mul(t)))
            .plus(Decimal('-1.453152027').mul(t.mul(t).mul(t).mul(t)))
            .plus(Decimal('1.061405429').mul(t.mul(t).mul(t).mul(t).mul(t)));
        return sign.mul(Decimal('1').sub(expNegZ2.mul(p)));
    } else {
        const z2 = z.mul(z);
        const expNegZ2 = Decimal.exp(z2.neg());
        const zInv = Decimal('1').div(z);
        const p = Decimal('1').plus(zInv.mul(Decimal('0.278393').plus(zInv.mul(Decimal('0.230389').plus(zInv.mul(Decimal('0.000972').plus(zInv.mul('0.078108'))))))));
        const q = Decimal('1').plus(zInv.mul(Decimal('0.568861').plus(zInv.mul(Decimal('0.114419').plus(zInv.mul(Decimal('0.008763').plus(zInv.mul('0.000326'))))))));
        return sign.mul(Decimal('1').sub(expNegZ2.div(Decimal.sqrt(Decimal.acos(-1))).mul(z).mul(p).div(q)));
    }
  }

  // Optional: Standard Normal CDF using erf
  stdNormCDFCody(z) {
    console.log("Precision:", Decimal.precision);
    console.log("erf(0.0) =", this.erfCody(Decimal('0.0')));
    console.log("erf(0.1) =", this.erfCody(0.1));
    console.log("erf(0.2) =", this.erfCody(0.2));
    console.log("erf(0.3) =", this.erfCody(0.3));
    console.log("erf(0.4) =", this.erfCody(0.4));
    console.log("erf(0.5) =", this.erfCody(0.5));
    console.log("erf(1.0) =", this.erfCody(Decimal('1.0')));
    console.log("erf(2.0) =", this.erfCody(2.0));
    console.log("erf(4.0) =", this.erfCody(4.0));
    console.log("erf(5.0) =", this.erfCody(5.0));

    console.log("erf(Decimal('1.0')) =", this.erfCody(Decimal('1.0')).toString());
      return 0.5 * (1 + this.erfCody(z / Math.sqrt(2)));
  }

  errorCorectionLinear(x) {
    if (x > 0 && x <= 0.045) {
      return x / 0.045 * 1394 * 1e-10;
    }

    return 0;
  }

  interpolate(x1, y1) {
    const initialValuesCube = [0, 0, 0];
    let resultCube = levenbergMarquardt({ x: x1, y: y1 }, cubeFit, { initialValues: initialValuesCube, maxIterations: 200, errorTolerance: 1e-10 });
    const a = resultCube.parameterValues[0];
    const b = resultCube.parameterValues[1];
    const c = resultCube.parameterValues[2];

    return { a, b, c };
  }


}
