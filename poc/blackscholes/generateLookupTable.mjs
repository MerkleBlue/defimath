import bs from "black-scholes";
import { S_S_RATIO_MAX, S_S_RATIO_MIN, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";

export function generateLookupTable() {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike and expiration

  // first dimension is spot strike ratio
  const spotStrikeRatios = generatesStrikeSpotRatioPoints(S_S_RATIO_MIN, S_S_RATIO_MAX, S_S_RATIO_STEP); // [0.8, 0.9, 1, 1.1, 1.2];
  const expirationDays = generatePoints(EXPIRATION_MIN, EXPIRATION_MAX, EXPIRATION_STEP); // [20, 40, 60, 80, 100];

  const lookupTable = [];

  console.log("spotStrikeRatios", spotStrikeRatios);
  // console.log("expirationDays", expirationDays);

  for (let i = 0; i < spotStrikeRatios.length - 1; i++) {
    const expirations = [];
    for (let j = 0; j < expirationDays.length - 1; j++) {
      // for each element calculate Black Scholes
      const spot = 100;
      const vol = 1;  // 100%
      const strikeA = 100 / spotStrikeRatios[i];
      const strikeB = 100 / spotStrikeRatios[i + 1];
      const expirationYearsA = expirationDays[j] / 365;
      const expirationYearsB = expirationDays[j + 1] / 365;


      const optionPriceAA = bs.blackScholes(spot, strikeA, expirationYearsA, vol, 0, "call");
      const optionPriceAB = bs.blackScholes(spot, strikeA, expirationYearsB, vol, 0, "call");
      const optionPriceBA = bs.blackScholes(spot, strikeB, expirationYearsA, vol, 0, "call");
      const optionPriceBB = bs.blackScholes(spot, strikeB, expirationYearsB, vol, 0, "call");
      // console.log(`strikeA: ${strikeA.toFixed(0)} (ssRatio: ${spotStrikeRatios[i].toFixed(3)}), expirationYearsA: ${expirationYearsA * 365}, optionPriceAA: ${optionPriceAA}`);
      // console.log(`strikeA: ${strikeA.toFixed(0)} (ssRatio: ${spotStrikeRatios[i].toFixed(3)}), expirationYearsB: ${expirationYearsB * 365}, optionPriceAB: ${optionPriceAB}`);
      // console.log(`strikeB: ${strikeB.toFixed(0)} (ssRatio: ${spotStrikeRatios[i + 1].toFixed(3)}), expirationYearsA: ${expirationYearsA * 365}, optionPriceBA: ${optionPriceBA}`);
      // console.log(`strikeB: ${strikeB.toFixed(0)} (ssRatio: ${spotStrikeRatios[i + 1].toFixed(3)}), expirationYearsB: ${expirationYearsB * 365}, optionPriceBB: ${optionPriceBB}`);

      const range = {
        optionPriceAA,
        optionPriceAB,
        optionPriceBA,
        optionPriceBB
      };
      expirations.push(range);
    }
    lookupTable.push(expirations);
  }

  // console.log(lookupTable);

  return lookupTable;
}

export function generateLookupTable2(blackScholesJS) {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike and expiration

  // first dimension is spot strike ratio
  const spotStrikeRatios = generatesStrikeSpotRatioPoints(S_S_RATIO_MIN, S_S_RATIO_MAX, S_S_RATIO_STEP); // [0.8, 0.9, 1, 1.1, 1.2];
  const expirationSecs = generateTimePoints(); // [20, 40, 60, 80, 100];

  const lookupTable = new Map();

  // console.log("spotStrikeRatios", spotStrikeRatios);
  // console.log("expirationSecs", expirationSecs);

  for (let i = 0; i < spotStrikeRatios.length - 1; i++) {
    for (let j = 0; j < expirationSecs.length - 1; j++) {
      // for each element calculate Black Scholes
      const spot = 100;
      const vol = 1;  // 100%
      const strikeA = 100 / spotStrikeRatios[i];
      const strikeB = 100 / spotStrikeRatios[i + 1];
      const expirationYearsA = expirationSecs[j] / (365 * 24 * 60 * 60);
      const expirationYearsB = expirationSecs[j + 1] / (365 * 24 * 60 * 60);


      const optionPriceAA = Math.max(0, bs.blackScholes(spot, strikeA, expirationYearsA, vol, 0, "call"));
      const optionPriceAB = Math.max(0, bs.blackScholes(spot, strikeA, expirationYearsB, vol, 0, "call"));
      const optionPriceBA = Math.max(0, bs.blackScholes(spot, strikeB, expirationYearsA, vol, 0, "call"));
      const optionPriceBB = Math.max(0, bs.blackScholes(spot, strikeB, expirationYearsB, vol, 0, "call"));
      // console.log(`strikeA: ${strikeA.toFixed(0)} (ssRatio: ${spotStrikeRatios[i].toFixed(3)}), expirationYearsA: ${expirationYearsA * 365}, optionPriceAA: ${optionPriceAA}`);
      // console.log(`strikeA: ${strikeA.toFixed(0)} (ssRatio: ${spotStrikeRatios[i].toFixed(3)}), expirationYearsB: ${expirationYearsB * 365}, optionPriceAB: ${optionPriceAB}`);
      // console.log(`strikeB: ${strikeB.toFixed(0)} (ssRatio: ${spotStrikeRatios[i + 1].toFixed(3)}), expirationYearsA: ${expirationYearsA * 365}, optionPriceBA: ${optionPriceBA}`);
      // console.log(`strikeB: ${strikeB.toFixed(0)} (ssRatio: ${spotStrikeRatios[i + 1].toFixed(3)}), expirationYearsB: ${expirationYearsB * 365}, optionPriceBB: ${optionPriceBB}`);

      const range = {
        optionPriceAA,
        optionPriceAB,
        optionPriceBA,
        optionPriceBB
      };

      const index = blackScholesJS.getIndexFromSpotStrikeRatio(spotStrikeRatios[i] + 0.0000001) * 1000 + blackScholesJS.getIndexFromTime(expirationSecs[j]);
      lookupTable.set(index, range);
    }
  }

  // console.log(lookupTable);

  return lookupTable;
}

function generatesStrikeSpotRatioPoints(startPoint, endPoint, stepSize) {
  const points = [];
  const stepCount = Math.round((endPoint - startPoint) / stepSize);
  for (let i = 0; i <= stepCount; i++) {
    const point = (startPoint + stepSize * i).toFixed(6);
    points.push(parseFloat(point));
  }

  return points;
}

function generateTimePoints() {
  const points = [1, 2, 3, 4, 5, 6, 7];

  for (let major = 3; major < 32; major++) {
    for(let minor = 0; minor < 8; minor++) {
      points.push(parseFloat(2 ** major + minor * 2 ** (major - 3)));
    }
  }

  return points;
}