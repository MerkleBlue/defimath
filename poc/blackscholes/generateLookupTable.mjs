import bs from "black-scholes";
import { levenbergMarquardt } from 'ml-levenberg-marquardt';
import { S_S_RATIO_MAX, S_S_RATIO_MIN, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { promises as fs } from "fs";
const csvConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

function quadraticFit([a, b]) {
  return (x) => a * x * x + b * x;
}

export async function generateLookupTable(blackScholesJS, writeToFile) {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike and expiration

  console.log("Generating lookup table...");

  // first dimension is spot strike ratio, second is expiration times
  var cvsCounter = 0;
  let fileHandle;
  const filename = `${csvConfig.filename}.csv`;  
  if (writeToFile) {
    fileHandle = await fs.open(filename, "w");                         //only for recording data
  }

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

      const ssratioati = spotStrikeRatios[i];
      const exdays = expirationYearsA * 365;
      
      let x1 = new Array(10), y1 = new Array(10), y2 = new Array(10);
      let a1 = 0, b1 = 0, a2 = 0, b2 = 0;
    
      if (writeToFile) {
        const fitPoints = 50;
        const timeChunk  = (expirationYearsB - expirationYearsA) / fitPoints;
        for (let k = 0; k < fitPoints; k++) {
          
          const tpmTime = expirationYearsA + k * timeChunk;
      
          const PriceAA = Math.max(0, bs.blackScholes(spot, strikeA, tpmTime, vol, 0, "call"));
          const PriceBA = Math.max(0, bs.blackScholes(spot, strikeB, tpmTime, vol, 0, "call"));
      
          x1[k] = k * timeChunk;
          y1[k] = PriceAA - optionPriceAA;
          y2[k] = PriceBA - optionPriceBA;
        }

        // with 10 fitPoints, 100 iterations, and default errorTolerance:
        //     Avg error: 0.00140628%, Max error: 0.01834267%
        // with 50 fitPoints, 200 iterations, and errorTolerance: 1e-10: 
        //     Avg error: 0.00011560%, Max error: 0.00065469%
        // with 100 fitPoints, 200 iterations, and errorTolerance: 1e-10: 
        //     Avg error: 0.00011520%, Max error: 0.00063081%%

        const initialValues = [0, 0];
        // let result = levenbergMarquardt({ x: x1, y: y1 }, quadraticFit, { initialValues });
        let result = levenbergMarquardt({ x: x1, y: y1 }, quadraticFit, { initialValues, maxIterations: 200, errorTolerance: 1e-10 });
        a1 = result.parameterValues[0];
        b1 = result.parameterValues[1];

        // result = levenbergMarquardt({ x: x1, y: y2 }, quadraticFit, { initialValues });
        result = levenbergMarquardt({ x: x1, y: y2 }, quadraticFit, { initialValues, maxIterations: 200, errorTolerance: 1e-10 });
        a2 = result.parameterValues[0];
        b2 = result.parameterValues[1];
      }

      const element = {
        optionPriceAA,
        optionPriceAB,
        optionPriceBA,
        optionPriceBB,
        ssratioati,
        exdays,
        a1,
        b1,
        a2,
        b2
      };
      cvsCounter ++;

      // pack for JS lookup table
      const index = blackScholesJS.getIndexFromSpotStrikeRatio(spotStrikeRatios[i] + 0.0000001) * 1000 + blackScholesJS.getIndexFromTime(expirationSecs[j]);
      lookupTable.set(index, element);

      // pack for SOL lookup table
      const optionPriceAABigInt = BigInt(parseInt(optionPriceAA * 1e17));
      const optionPriceABBigInt = BigInt(parseInt(optionPriceAB * 1e17));
      const optionPriceBABigInt = BigInt(parseInt(optionPriceBA * 1e17));
      const optionPriceBBBigInt = BigInt(parseInt(optionPriceBB * 1e17));
      const elementForSOL = optionPriceAABigInt * BigInt(2 ** 192) + optionPriceABBigInt * BigInt(2 ** 128) + optionPriceBABigInt * BigInt(2 ** 64) + optionPriceBBBigInt;
      row.push( { index, element: elementForSOL, a1, b1, a2, b2, optionPriceAA, optionPriceAB } );
    }
    rows.push(row);
  }

  if (writeToFile) {
    await fileHandle.close();
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