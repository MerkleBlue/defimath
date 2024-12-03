import bs from "black-scholes";
import { levenbergMarquardt } from 'ml-levenberg-marquardt';
import { STRIKE_MAX, STRIKE_MIN, STRIKE_STEP } from "./BlackScholesJS.mjs";
import { mkConfig} from "export-to-csv";
import { promises as fs } from "fs";
const jsonConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

function quadraticFit([a, b]) {
  return (x) => a * x * x + b * x;
}

async function readSavedLookupTable() {
  const filePath = `${jsonConfig.filename}.json`;  

  let lookupTable = await fs.readFile(filePath, 'utf8');
  lookupTable = JSON.parse(lookupTable, reviver);
  return lookupTable;
}

export async function generateLookupTable(blackScholesJS, writeToFile) {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike and expiration

  // // read from file if exists
  // try {
  //   const lookupTable = await readSavedLookupTable();
  //   if (lookupTable instanceof Map) {
  //     console.log("Reading lookup table from file...");
  //     const lookupTableSOL = getLookupTableSOL(lookupTable);
  //     return { lookupTable, lookupTableSOL };
  //   }
  // } catch (error) {
  //     console.error("File not found, generating new lookup table...");
  // }

  console.log("Generating new lookup table...");

  // first dimension is spot strike ratio, second is expiration times
  var cvsCounter = 0;
  let fileHandle;
  const filename = `${jsonConfig.filename}.json`;  
  if (writeToFile) {
    fileHandle = await fs.open(filename, "w");                         //only for recording data
  }

  const strikes = generateStrikePoints(STRIKE_MIN, STRIKE_MAX, STRIKE_STEP);
  const expirationSecs = generateTimePoints();

  const lookupTable = new Map();

  console.log("strikes", strikes);
  console.log("expirationSecs", expirationSecs);

  for (let i = 0; i < strikes.length - 1; i++) {
    const row = [];
    for (let j = 0; j < expirationSecs.length - 1; j++) {
      // for each element calculate Black Scholes
      const spot = 100;
      const vol = 1;  // 100%
      const strikeA = strikes[i];
      const strikeB = strikes[i + 1];
      const expirationYearsA = expirationSecs[j] / (365 * 24 * 60 * 60);
      const expirationYearsB = expirationSecs[j + 1] / (365 * 24 * 60 * 60);

      const optionPriceAA = Math.max(0, bs.blackScholes(spot, strikeA, expirationYearsA, vol, 0, "call"));
      const optionPriceAB = Math.max(0, bs.blackScholes(spot, strikeA, expirationYearsB, vol, 0, "call"));
      const optionPriceBA = Math.max(0, bs.blackScholes(spot, strikeB, expirationYearsA, vol, 0, "call"));
      const optionPriceBB = Math.max(0, bs.blackScholes(spot, strikeB, expirationYearsB, vol, 0, "call"));

      const intrinsicPriceAA = optionPriceAA - Math.max(0, spot - strikeA);
      const intrinsicPriceAB = optionPriceAB - Math.max(0, spot - strikeA);

      
      let x12 = new Array(10), x34 = new Array(10), y1 = new Array(10), y2 = new Array(10), y3 = new Array(10), y4 = new Array(10);
      let a1 = 0, b1 = 0, a3 = 0, b3 = 0, a4 = 0, b4 = 0;
    
      if (writeToFile) {
        const fitPoints = 50;
        const initialValues = [0, 0];

        // time points
        const timeChunk  = (expirationYearsB - expirationYearsA) / fitPoints;
        for (let k = 0; k < fitPoints; k++) {
          
          const tpmTime = expirationYearsA + k * timeChunk;
      
          const PriceAA = Math.max(0, bs.blackScholes(spot, strikeA, tpmTime, vol, 0, "call"));
      
          x12[k] = k * timeChunk / (expirationYearsB - expirationYearsA);
          y1[k] = PriceAA - optionPriceAA;
          // y2[k] = PriceBA - optionPriceBA;

          if (strikes[i] === 101 && expirationSecs[j] === 1048576) {
            console.log(PriceAA);
          }
        }
        // if (strikes[i] === 101 && expirationSecs[j] === 1048576) {
        //   x12.push(fitPoints * timeChunk);
        //   y1.push(optionPriceAB - optionPriceAA);
        // }

        let result = levenbergMarquardt({ x: x12, y: y1 }, quadraticFit, { initialValues, maxIterations: 200, errorTolerance: 1e-10 });
        a1 = result.parameterValues[0];
        b1 = result.parameterValues[1];

        // result = levenbergMarquardt({ x: x12, y: y2 }, quadraticFit, { initialValues, maxIterations: 200, errorTolerance: 1e-10 });
        // a2 = result.parameterValues[0];
        // b2 = result.parameterValues[1];

        // strike points
        const strikeChunk  = (strikeB - strikeA) / fitPoints;
        for (let k = 0; k < fitPoints; k++) {
          
          const tpmStrike = strikeA + k * strikeChunk;
      
          const PriceTA = Math.max(0, bs.blackScholes(spot, tpmStrike, expirationYearsA, vol, 0, "call"));
          const PriceTB = Math.max(0, bs.blackScholes(spot, tpmStrike, expirationYearsB, vol, 0, "call"));
          const intrinsicPriceTA = PriceTA - Math.max(0, spot - tpmStrike);
          const intrinsicPriceTB = PriceTB - Math.max(0, spot - tpmStrike);

          // record intrinsic price difference between TA and AA, and TB and AB
          x34[k] = k * strikeChunk;
          y3[k] = intrinsicPriceTA - intrinsicPriceAA;
          y4[k] = intrinsicPriceTB - intrinsicPriceAB;
        }

        result = levenbergMarquardt({ x: x34, y: y3 }, quadraticFit, { initialValues, maxIterations: 200, errorTolerance: 1e-10 });
        a3 = result.parameterValues[0];
        b3 = result.parameterValues[1];

        if (strikes[i] === 99 && expirationSecs[j] === 2304) {
          console.log("bingo cell");
          console.log(result);

          // for time interpolation
          console.log("x12 and y1");
          const checkArray = [];
          for (let k = 0; k < fitPoints; k++) {
            const x = k * timeChunk / (expirationYearsB - expirationYearsA);
            checkArray.push(a1 * x * x + b1 * x);
          }

          for (let i = 0; i < fitPoints; i++) {
            console.log(x12[i].toFixed(2) + ",", y1[i].toFixed(6) + ",", checkArray[i].toFixed(6));
          }

          // for strike interpolation
          console.log("x34 and y3");
          const checkArray3 = [];
          for (let k = 0; k < fitPoints; k++) {
            const x = k * strikeChunk;
            checkArray3.push(a3 * x * x + b3 * x);
          }
          for (let i = 0; i < fitPoints; i++) {
            console.log(x34[i].toFixed(2) + ",", y3[i].toFixed(6) + ",", checkArray3[i].toFixed(6));
          }
        }

        result = levenbergMarquardt({ x: x34, y: y4 }, quadraticFit, { initialValues, maxIterations: 200, errorTolerance: 1e-10 });
        a4 = result.parameterValues[0];
        b4 = result.parameterValues[1];

        // NOTE:
        // with 10 fitPoints, 100 iterations, and default errorTolerance:
        //     Avg error: 0.00140628%, Max error: 0.01834267%
        // with 50 fitPoints, 200 iterations, and errorTolerance: 1e-10: 
        //     Avg error: 0.00011560%, Max error: 0.00065469%
        // with 100 fitPoints, 200 iterations, and errorTolerance: 1e-10: 
        //     Avg error: 0.00011520%, Max error: 0.00063081%%
      }

      const element = {
        optionPriceAA,
        optionPriceAB,
        optionPriceBA,
        optionPriceBB,
        a1,
        b1,
        a3,
        b3,
        a4,
        b4
      };
      cvsCounter++;

      // pack for JS lookup table
      const index = blackScholesJS.getIndexFromStrike(strikes[i] + 0.0000001) * 1000 + blackScholesJS.getIndexFromTime(expirationSecs[j]);
      lookupTable.set(index, element);
    }
  }

  if (writeToFile) {
    await fs.appendFile(filename, JSON.stringify(lookupTable, replacer)+ '\n');
    await fileHandle.close();
  }

  // create lookupTable for Solidity
  const lookupTableSOL = getLookupTableSOL(lookupTable);

  return { lookupTable, lookupTableSOL };
}

function getLookupTableSOL(lookupTable) {
  const lookupTableSOL = new Map();
  // pack for SOL lookup table
  for (const [key, value] of lookupTable) {
    const { optionPriceAA, a1, b1, a3, b3, a4, b4 } = value;
    const optionPriceAABigInt = BigInt(parseInt(optionPriceAA * 1e17));
    const a1BigInt = intToUint32(a1);
    const b1BigInt = intToUint32(b1);
    const a3BigInt = intToUint32(a3);
    const b3BigInt = intToUint32(b3);
    const a4BigInt = intToUint32(a4);
    const b4BigInt = intToUint32(b4);
    const elementForSOL = optionPriceAABigInt * BigInt(2 ** 192) + a1BigInt * BigInt(2 ** 160) + b1BigInt * BigInt(2 ** 128) + a3BigInt * BigInt(2 ** 96) + b3BigInt * BigInt(2 ** 64) + a4BigInt * BigInt(2 ** 32) + b4BigInt;
    lookupTableSOL.set(key, elementForSOL);
  }

  return lookupTableSOL;
}

function replacer(key, value) {
  if(value instanceof Map) {
    return {
      dataType: 'Map',
      value: Array.from(value.entries()), // or with spread: value: [...value]
    };
  } else {
    return value;
  }
}

function reviver(key, value) {
  if(typeof value === 'object' && value !== null) {
    if (value.dataType === 'Map') {
      return new Map(value.value);
    }
  }
  return value;
}

function intToUint32(factor) {
  if (Math.abs(factor) > 2147.483648) throw new Error("factor out of bounds: " + factor);

  // positive
  if (factor > 0) {
    return BigInt(parseInt(factor * 1e6));
  }

  // negative
  return BigInt(parseInt((Math.abs(factor) + 2147.483648) * 1e6)); // half the 2 ** 32
  
}

function generateStrikePoints(startPoint, endPoint, stepSize) {
  const points = [];
  const stepCount = Math.round((endPoint - startPoint) / stepSize);
  for (let i = 0; i <= stepCount; i++) {
    const point = (startPoint + stepSize * i).toFixed(6);
    points.push(parseFloat(point));
  }

  return points;
}

export function generateTimePoints() {
  const points = [1, 2, 3, 4, 5, 6, 7];

  for (let major = 3; major < 32; major++) {
    for(let minor = 0; minor < 8; minor++) {
      points.push(parseFloat(2 ** major + minor * 2 ** (major - 3)));
    }
  }

  return points;
}