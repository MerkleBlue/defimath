import bs from "black-scholes";
import { S_S_RATIO_MAX, S_S_RATIO_MIN, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";

export function generateLookupTable(blackScholesJS) {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike and expiration

  // first dimension is spot strike ratio, second is expiration times
  const spotStrikeRatios = generatesStrikeSpotRatioPoints(S_S_RATIO_MIN, S_S_RATIO_MAX, S_S_RATIO_STEP);
  const expirationSecs = generateTimePoints();

  const lookupTable = new Map();
  const rows = [];

  // console.log("spotStrikeRatios", spotStrikeRatios);
  // console.log("expirationSecs", expirationSecs);

  for (let i = 0; i < spotStrikeRatios.length - 1; i++) {
    const row = [];
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

      const element = {
        optionPriceAA,
        optionPriceAB,
        optionPriceBA,
        optionPriceBB
      };

      // pack for JS lookup table
      const index = blackScholesJS.getIndexFromSpotStrikeRatio(spotStrikeRatios[i] + 0.0000001) * 1000 + blackScholesJS.getIndexFromTime(expirationSecs[j]);
      lookupTable.set(index, element);

      // pack for SOL lookup table
      // const elementForSOL = (parseInt(optionPriceAA * 1e17)).toString(); //  + (parseInt(optionPriceAB * 1e17)).toString() + (parseInt(optionPriceBA * 1e17)).toString() + (parseInt(optionPriceBB * 1e17)).toString();

      const optionPriceAABigInt = BigInt(parseInt(optionPriceAA * 1e17));
      const optionPriceABBigInt = BigInt(parseInt(optionPriceAB * 1e17));
      const optionPriceBABigInt = BigInt(parseInt(optionPriceBA * 1e17));
      const optionPriceBBBigInt = BigInt(parseInt(optionPriceBB * 1e17));
      const elementForSOL = optionPriceAABigInt * BigInt(2 ** 192) + optionPriceABBigInt * BigInt(2 ** 128) + optionPriceBABigInt * BigInt(2 ** 64) + optionPriceBBBigInt;
      row.push( { index, element: elementForSOL } );
    }
    rows.push(row);
  }

  // console.log(lookupTable);

  return { lookupTable, rows };
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