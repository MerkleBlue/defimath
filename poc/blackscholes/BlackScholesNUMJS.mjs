import { blackScholesWrapped } from "../../test/BlackScholesDUO.test.mjs";

// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 0.12;
export const MAX_MAJOR = 34;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// strike price +-5x from spot price
export const STRIKE_MIN = 20;                 // 20;
export const STRIKE_MAX = 500;                // 500;
export const STRIKE_INDEX_MULTIPLIER = 100;

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

  constructor(lookupTable) {
    this.lookupTable = lookupTable;
  }

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
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

    // step 2: calculate strike scaled
    const future = this.getFuturePrice(spot, rate, timeToExpirySec);
    const strikeScaled = (strike / future) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    log && console.log("volRatio:", volRatio);
    log && console.log("timeToExpirySec * (volRatio * volRatio):", timeToExpirySec * (volRatio * volRatio));
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio); //Math.floor(timeToExpirySec * (volRatio * volRatio));
    // console.log("timeToExpiryScaled (not rounded)", timeToExpirySec * (volRatio * volRatio));
    // console.log("strikeScaled", strikeScaled, "timeToExpirySecScaled", timeToExpirySecScaled, timeToExpirySec);

    // handle when time is 0
    if (timeToExpirySecScaled === 0) {
      return Math.max(0, spot - strike);
    }

    // step 4: interpolate price

    // if (strikeScaled >= 99 && strikeScaled <= 100.05 && timeToExpirySecScaled < 480) {
    //   console.log("Curved interpolation");

    //   const finalPrice = this.interpolatePrice3(strikeScaled, timeToExpirySecScaled);

    //   // finally, scale the price back to the original spot
    //   return finalPrice * spotScale;
    // }


    const finalPrice = this.interpolatePrice3(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
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
    const discountedStrike = this.getDiscountedStrikePrice(strike, rate, timeToExpirySec);
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

  getFuturePrice(spot, timeToExpirySec, rate) {
    const E_TO_005 = 1.051271096376024; // e ^ 0.05
    let exp1 = 1;

    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    let x = rate * timeToExpiryYears;
    if (x >= 0.05) {
      const exponent = Math.floor(x / 0.05);
      x = x - exponent * 0.05;
      exp1 = E_TO_005 ** exponent;
    }

    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const exp2 = (numerator / denominator);

    const futurePrice = spot * exp1 * exp2; // using e ^ (a + b) = e ^ a * e ^ b

    return futurePrice;
  };

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

  getDiscountedStrikePrice(strike, timeToExpirySec, rate) {
    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const x = rate * timeToExpiryYears;
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const discountedStrikePrice = strike * (denominator / numerator);

    return discountedStrikePrice;
  };
}