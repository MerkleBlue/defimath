// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// strike price +-5x from spot price
export const STRIKE_MIN = 20; // 20;
export const STRIKE_MAX = 500; // 500;

export class BlackScholesJS {

  constructor(lookupTable) {
    this.lookupTable = lookupTable;
  }

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate strike scaled
    const future = this.getFuturePrice(spot, rate, timeToExpirySec);
    const strikeScaled = (strike / future) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = Math.round(timeToExpirySec * (volRatio * volRatio));

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceQuadratic(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
  };

  getPutOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate future and spot-strike ratio
    const discountedStrike = this.getDiscountedStrikePrice(strike, rate, timeToExpirySec);
    const strikeScaled = (discountedStrike / spot) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceQuadratic(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    const callPrice = finalPrice * spotScale;

    return callPrice + discountedStrike - spot;
  };

  // NOTE: rate: 20% and time: 1 year gives max error of 0.000045%
  // same for rate: 10% and time: 2 years
  // So basically, if rate * years < 0.2, we are good, if not, use other method maybe?
  getFuturePrice(spot, timeToExpirySec, rate) {

    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const x = rate * timeToExpiryYears;
    if (x <= 0.2) {
      // we use Pade approximation for exp(x)
      // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
      const numerator = (x + 3) ** 2 + 3;
      const denominator = (x - 3) ** 2 + 3;
      const futurePrice = spot * (numerator / denominator);

      return futurePrice;
    }

    // todo: implement other method, this method gives error when x > 0.2
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const futurePrice = spot * (numerator / denominator);

    return futurePrice;
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

  interpolatePriceQuadratic(strikeScaled, timeToExpirySecScaled) {
    // todo: handle 0 time and 0 strike

    const log = false;

    // step 1) get the specific cell
    const strikeIndex = this.getIndexFromStrike(strikeScaled);
    const timeToExpiryIndex = this.getIndexFromTime(timeToExpirySecScaled);

    const cell = this.lookupTable.get(strikeIndex * 1000 + timeToExpiryIndex);
    log && console.log("strikeIndex:", strikeIndex);
    log && console.log("timeToExpiryIndex:", timeToExpiryIndex);
    log && console.log("cell", cell);

    // step 2) calculate the time delta and weight
    const timeToExpiryFromIndex = this.getTimeFromIndex(timeToExpiryIndex);
    const expirationStep = 2 ** (Math.floor(timeToExpiryIndex / 10) - 3);
    const timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) / expirationStep;
    log && console.log("timeToExpiryFromIndex:", timeToExpiryFromIndex);
    log && console.log("expirationStep:", expirationStep);
    log && console.log("timeToExpiryWeight: %d", timeToExpiryWeight);

    // step 3) calculate the strike delta
    const deltaStrike = strikeScaled - this.getStrikeFromIndex(strikeIndex);
    const strikeStep = this.getStrikeStepAndBoundary(strikeScaled).step;
    const strikeWeight = deltaStrike / strikeStep;
    log && console.log("strikeScaled", strikeScaled, "strikeFromIndex:", this.getStrikeFromIndex(strikeIndex));
    log && console.log("deltaStrike:", deltaStrike);
    log && console.log("strikeWeight:", strikeWeight);

    // step 4) interpolate the price using quadratic interpolation

    const interpolatedPrice1 = cell.a1 * (timeToExpiryWeight ** 3) + cell.b1 * (timeToExpiryWeight ** 2) + cell.c1 * timeToExpiryWeight;
    const interpolatedPrice2 = cell.a2 * (timeToExpiryWeight ** 3) + cell.b2 * (timeToExpiryWeight ** 2) + cell.c2 * timeToExpiryWeight;

    const interpolatedPrice3 = cell.a3 * (deltaStrike ** 3) + cell.b3 * (deltaStrike ** 2) + cell.c3 * deltaStrike;
    const interpolatedPrice4 = cell.a4 * (deltaStrike ** 3) + cell.b4 * (deltaStrike ** 2) + cell.c4 * deltaStrike;

    const interpolatedStrikeWeight3w = cell.a3w * (strikeWeight ** 3) + cell.b3w * (strikeWeight ** 2) + cell.c3w * strikeWeight;
    const interpolatedStrikeWeight4w = cell.a4w * (strikeWeight ** 3) + cell.b4w * (strikeWeight ** 2) + cell.c4w * strikeWeight;

    log && console.log("interpolatedPrice1", interpolatedPrice1);
    log && console.log("interpolatedPrice2", interpolatedPrice2);
    log && console.log("interpolatedPrice3", interpolatedPrice3);
    log && console.log("interpolatedPrice4", interpolatedPrice4);
    log && console.log("interpolatedStrikeWeight3w", interpolatedStrikeWeight3w);
    log && console.log("interpolatedStrikeWeight4w", interpolatedStrikeWeight4w);
    const interpolatedStrikeWeightw = interpolatedStrikeWeight3w + timeToExpiryWeight * (interpolatedStrikeWeight4w - interpolatedStrikeWeight3w)
    log && console.log("interpolatedStrikeWeightw", interpolatedStrikeWeightw);

    // step 5) calculate the final price
    const extrinsicPriceAA = Math.max(0, 100 - this.getStrikeFromIndex(strikeIndex));
    const extrinsicPriceTA = Math.max(0, 100 - strikeScaled);
    const extrinsicPriceBA = Math.max(0, 100 - this.getStrikeFromIndex(strikeIndex) - strikeStep);
    // console.log("extrinsicPriceAA", extrinsicPriceAA);
    // // console.log("extrinsicPriceTA", extrinsicPriceTA)
    // console.log("extrinsicPriceBA", extrinsicPriceBA);

    const optionPriceAA = extrinsicPriceAA + cell.intrinsicPriceAA;
    const optionPriceAT = extrinsicPriceAA + cell.intrinsicPriceAA + interpolatedPrice1;
    const optionPriceAB = extrinsicPriceAA + cell.intrinsicPriceAB;
    const optionPriceBA = extrinsicPriceBA + cell.intrinsicPriceBA;
    const optionPriceBT = extrinsicPriceBA + cell.intrinsicPriceBA + interpolatedPrice2;
    const optionPriceBB = extrinsicPriceBA + cell.intrinsicPriceBB;
    log && console.log("-----------------")
    log && console.log("optionPriceAT", optionPriceAT, "ok");
    log && console.log("optionPriceBT", optionPriceBT, "ok");
    // console.log("optionPriceAB", optionPriceAB);
    log && console.log("optionPriceAA", optionPriceAA);
    log && console.log("optionPriceBA", optionPriceBA);
    // console.log("optionPriceBB", optionPriceBB);

    let interpolatedStrikeWeight = strikeWeight;
    // if (Math.abs(interpolatedPrice3) > 0.00001)
    // const strikeWeightA = -interpolatedPrice3 / (cell.intrinsicPriceAA - cell.intrinsicPriceBA);
    // console.log("strikeWeightA", strikeWeightA);
    if (Math.abs(interpolatedPrice3) > 0.0001 && Math.abs(interpolatedPrice4) > 0.0001) {
      const strikeWeightA = -interpolatedPrice3 / (cell.intrinsicPriceAA - cell.intrinsicPriceBA);
      const strikeWeightB = -interpolatedPrice4 / (cell.intrinsicPriceAB - cell.intrinsicPriceBB);
      interpolatedStrikeWeight = strikeWeightA + timeToExpiryWeight * (strikeWeightB - strikeWeightA)
      log && console.log("strikeWeightA", strikeWeightA);
      log && console.log("strikeWeightB", strikeWeightB);
    }



    const finalPrice2 = optionPriceAT - interpolatedStrikeWeight * (optionPriceAT - optionPriceBT);
    log && console.log("interpolatedStrikeWeight", interpolatedStrikeWeight);
    log && console.log("finalPrice2", finalPrice2);


    const finalPrice3 = optionPriceAT + interpolatedStrikeWeightw * (optionPriceAT - optionPriceBT);


    // OLD
    // const interpolatedPriceTime = interpolatedPrice1 + strikeWeight * (interpolatedPrice2 - interpolatedPrice1);
    // const interpolatedPriceStrike = interpolatedPrice3 + timeToExpiryWeight * (interpolatedPrice4 - interpolatedPrice3);
    // console.log("interpolatedPriceTime", interpolatedPriceTime);
    // console.log("interpolatedPriceStrike", interpolatedPriceStrike);

    // // const finalPrice = cell.optionPriceAA + interpolatedPrice1 + interpolatedPriceStrike;
    // const finalPrice = optionPriceAT + interpolatedPriceStrike;

    // console.log("finalPrice", finalPrice);

    return finalPrice3;
  }

  getIndexFromTime(timeToExpirySec) {
    if (timeToExpirySec < 8) {
      return timeToExpirySec;
    }

    const major = this.findMajor(timeToExpirySec);
    const minor = this.findMinor(timeToExpirySec, major);

    return major * 10 + minor;
  }

  getTimeFromIndex(index) {
    const major = Math.floor(index / 10);
    const minor = index % 10;

    if (major < 3) {
      return minor;
    }

    return 2 ** major + 2 ** (major - 3) * minor;
  }

  getIndexFromStrike(strike) {
    // tested
    // strike 200 - 800 => max abs error < $0.002595 step 0.4, 60s - 4y
    // strike 800 - 1050 => max abs error < $0.005226 step 0.2, 60s - 4y
    // strike 1050 - 1200 => max abs error < $0.002816 step 0.5, 60s - 4y
    // strike 1200 - 2000 => max abs error < $0.002999 step 1, 60s - 4y
    // strike 2000 - 5000 => max abs error < $0.005805 step 4, 60s - 4y

    // $0.002106, $0.000757, $0.001112, $0.001955, $0.005535 with cube interpolation
    // $0.000212, $0.003459, $0.000942, $0.000912, $0.001722 with cube, using 1, 2 and 3, 461 strike points

    // $0.000545, $0.001411, $0.000486, $0.000912, $0.001722, cube,  516 strike points
    // $0.000545, $0.001411, $0.002613,            $0.001722,
    // $0.000545, $0.001411, $0.000486, $0.016727, $0.001722, cube, 515 strike points
    // $0.000545, $0.001411, $0.000486, $0.000565, $0.001722, cube, 526 strike points, commit
    // $0., $0.000113, $0.000059, $0.000060, $0.000061, cube, 526 strike points, 
    
    const { step, boundary } = this.getStrikeStepAndBoundary(strike);

    const rest = strike - boundary;
    return Math.round(boundary * 10 + Math.floor(rest / step) * step * 10);
  }

  getStrikeStepAndBoundary(strike) {
    if (strike < 90) {
      return { step: 0.5, boundary: 20 };
    }

    if (strike < 110) {
      return { step: 0.1, boundary: 90 };
    }

    if (strike < 130) {
      return { step: 0.5, boundary: 110 };
    }

    if (strike < 200) {
      return { step: 1, boundary: 130 };
    }

    return { step: 4, boundary: 200 };
  }

  getStrikeFromIndex(index) {
    // since 0.1 is the smallest step, we can just return the index / 10
    return index / 10;
  }

  findMajor(value) {
    let min = 2;
    let max = 32;
    let result = -1;

    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      const power = 2 ** mid;

      if (power <= value) {
          result = mid;    // mid is a valid candidate
          min = mid + 1;   // search for a larger power
      } else {
          max = mid - 1;   // search for a smaller power
      }
    }

    return result;
  }

  findMinor(value, power) {
    // console.log(value - 2 ** power);
    return Math.floor((value - 2 ** power) / (2 ** (power - 3)));
  }
}