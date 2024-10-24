import moment from "moment";
import bs from "black-scholes";
import { EXPIRATION_MAX, EXPIRATION_MIN, EXPIRATION_STEP, S_S_RATIO_MAX, S_S_RATIO_MIN, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";

const lookupTable = generateLookupTable();

export function generateLookupTable() {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike 50-200, expiration 10-100 days

  // first dimension is spot strike ratio
  const spotStrikeRatios = generatePoints(S_S_RATIO_MIN, S_S_RATIO_MAX, S_S_RATIO_STEP); // [0.8, 0.9, 1, 1.1, 1.2];
  const expirationDays = generatePoints(EXPIRATION_MIN, EXPIRATION_MAX, EXPIRATION_STEP); // [20, 40, 60, 80, 100];

  const lookupTable = [];

  console.log("spotStrikeRatios", spotStrikeRatios);
  console.log("expirationDays", expirationDays);

  for (let i = 0; i < spotStrikeRatios.length; i++) {
    const expirations = [];
    for (let j = 0; j < expirationDays.length; j++) {
      // for each element calculate Black Scholes
      const spot = 100;
      const strike = 100 / spotStrikeRatios[i];
      const expirationYears = expirationDays[j] / 365;
      const vol = 1;  // 100%
      const optionPrice = bs.blackScholes(spot, strike, expirationYears, vol, 0, "call");
      console.log(`strike: ${strike.toFixed(0)} (ssRatio: ${spotStrikeRatios[i]}), expiration: ${expirationDays[j]}, call price: ${optionPrice}`);
      expirations.push(optionPrice);
    }
    lookupTable.push(expirations);
  }

  // console.log(lookupTable);

  return lookupTable;
}

function generatePoints(startPoint, endPoint, stepSize) {
  const points = [];
  const stepCount = Math.round((endPoint - startPoint) / stepSize);
  for (let i = 0; i <= stepCount; i++) {
    const point = startPoint + stepSize * i;
    points.push(point);
  }

  return points;
}