import bs from "black-scholes";
import { levenbergMarquardt } from 'ml-levenberg-marquardt';
import { MAX_MAJOR, STRIKE_INDEX_MULTIPLIER, STRIKE_MAX, STRIKE_MIN, VOL_FIXED } from "./BlackScholesJS.mjs";
import { mkConfig} from "export-to-csv";
import { promises as fs } from "fs";
const jsonConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

function quadraticFit([a, b]) {
  return (x) => a * x * x + b * x;
}

function cubeFit([a, b, c]) {
  return (x) => a * x ** 3 + b * x ** 2 + c * x;
}

function fourOrderFit([a, b, c, d]) {
  return (x) => a * x ** 4 + b * x ** 3 + c * x ** 2 + d * x;
}

async function readSavedLookupTable() {
  const filePath = `${jsonConfig.filename}.json`;  

  let lookupTable = await fs.readFile(filePath, 'utf8');
  lookupTable = JSON.parse(lookupTable, reviver);
  return lookupTable;
}

export async function generateLookupTable(blackScholesJS, writeToFile) {
  // we start with fixed values: spot 100, volatility 12%, rate 0%
  // what is not fixed: strike and expiration

  // read from file if exists
  try {
    const lookupTable = await readSavedLookupTable();
    if (lookupTable instanceof Map) {
      console.log("Reading lookup table from file...");
      const lookupTableSOL = getLookupTableSOL(lookupTable);
      return { lookupTable, lookupTableSOL };
    }
  } catch (error) {
      console.error("File not found, generating new lookup table...");
      console.log(error);
  }

  console.log("Generating new lookup table...");

  // first dimension is spot strike ratio, second is expiration times
  var cvsCounter = 0;
  let fileHandle;
  const filename = `${jsonConfig.filename}.json`;  
  if (writeToFile) {
    fileHandle = await fs.open(filename, "w");                         //only for recording data
  }

  const strikes = generateStrikePoints(blackScholesJS, STRIKE_MIN, STRIKE_MAX);
  const expirationSecs = generateTimePoints();

  const lookupTable = new Map();

  console.log("strikes", strikes);
  console.log("expirationSecs", expirationSecs);

  const totalCount = (strikes.length - 1) * (expirationSecs.length - 1);
  let count = 0;
  for (let i = 0; i < strikes.length - 1; i++) {
    for (let j = 0; j < expirationSecs.length - 1; j++) {
      const progress = ++count / totalCount * 100;
      if (progress % 10 === 0) console.log("Processing : ", progress.toFixed(0) + "%");

      // for each element calculate Black Scholes
      const spot = 100;
      const vol = VOL_FIXED;
      const strikeA = strikes[i];
      const strikeB = strikes[i + 1];
      const expirationYearsA = expirationSecs[j] / (365 * 24 * 60 * 60);
      const expirationYearsB = expirationSecs[j + 1] / (365 * 24 * 60 * 60);

      // NOTE: AB means strike A and expiration B
      const optionPriceAA = Math.max(0, bs.blackScholes(spot, strikeA, expirationYearsA, vol, 0, "call"));
      const optionPriceAB = Math.max(0, bs.blackScholes(spot, strikeA, expirationYearsB, vol, 0, "call"));
      const optionPriceBA = Math.max(0, bs.blackScholes(spot, strikeB, expirationYearsA, vol, 0, "call"));
      const optionPriceBB = Math.max(0, bs.blackScholes(spot, strikeB, expirationYearsB, vol, 0, "call"));

      const intrinsicPriceAA = optionPriceAA - Math.max(0, spot - strikeA);
      const intrinsicPriceAB = optionPriceAB - Math.max(0, spot - strikeA);
      const intrinsicPriceBA = optionPriceBA - Math.max(0, spot - strikeB);
      const intrinsicPriceBB = optionPriceBB - Math.max(0, spot - strikeB);
      
      let x12 = new Array(10), x34 = new Array(10), x34w = new Array(10), y1 = new Array(10), y2 = new Array(10), y3 = new Array(10), y4 = new Array(10), y3w = new Array(10), y4w = new Array(10);;
      let a1 = 0, b1 = 0, c1 = 0, a2 = 0, b2 = 0, c2 = 0;
      let a3w = 0, b3w = 0, c3w = 0, a4w = 0, b4w = 0, c4w = 0;

    
      if (writeToFile) {
        const fitPoints = 50;
        const initialValues = [0, 0];
        const initialValuesCube = [0, 0, 0];
        const initialValuesFourth = [0, 0, 0, 0];

        // time points
        // calculated as difference between intrinsic prices of AA and AT, and AB and BT
        const timeChunk  = (expirationYearsB - expirationYearsA) / fitPoints;
        for (let k = 0; k < fitPoints; k++) {
          
          const tpmTime = expirationYearsA + k * timeChunk;
      
          const optionPriceAT = Math.max(0, bs.blackScholes(spot, strikeA, tpmTime, vol, 0, "call"));
          const optionPriceBT = Math.max(0, bs.blackScholes(spot, strikeB, tpmTime, vol, 0, "call"));
          const intrinsicPriceAT = Math.max(optionPriceAT - Math.max(0, spot - strikeA));
          const intrinsicPriceBT = Math.max(optionPriceBT - Math.max(0, spot - strikeB));
      
          x12[k] = k * timeChunk / (expirationYearsB - expirationYearsA);
          y1[k] = intrinsicPriceAT - intrinsicPriceAA;
          y2[k] = intrinsicPriceBT - intrinsicPriceBA;
        }

        let resultCube = levenbergMarquardt({ x: x12, y: y1 }, cubeFit, { initialValues: initialValuesCube, maxIterations: 200, errorTolerance: 1e-10 });
        a1 = resultCube.parameterValues[0];
        b1 = resultCube.parameterValues[1];
        c1 = resultCube.parameterValues[2];

        resultCube = levenbergMarquardt({ x: x12, y: y2 }, cubeFit, { initialValues: initialValuesCube, maxIterations: 200, errorTolerance: 1e-10 });
        a2 = resultCube.parameterValues[0];
        b2 = resultCube.parameterValues[1];
        c2 = resultCube.parameterValues[2];


        // strike points
        // calculated as strike weights between AA and TA, and AB and TB, always in [0, 1]
        const strikeChunk  = (strikeB - strikeA) / fitPoints;
        for (let k = 0; k < fitPoints; k++) {
          
          const tpmStrike = strikeA + k * strikeChunk;
      
          const optionPriceTA = Math.max(0, bs.blackScholes(spot, tpmStrike, expirationYearsA, vol, 0, "call"));
          const optionPriceTB = Math.max(0, bs.blackScholes(spot, tpmStrike, expirationYearsB, vol, 0, "call"));

          const y3wtemp = (optionPriceAA - optionPriceTA) / (optionPriceAA - optionPriceBA); // strike weights are always in [0, 1]
          const y4wtemp = (optionPriceAB - optionPriceTB) / (optionPriceAB - optionPriceBB);

          x34w[k] = (k * strikeChunk) / (strikeB - strikeA);
          y3w[k] = y3wtemp ? y3wtemp : 0;
          y4w[k] = y4wtemp ? y4wtemp : 0; 
        }
        x34w[fitPoints] = 1;
        y3w[fitPoints] = 1;
        y4w[fitPoints] = 1;

        resultCube = levenbergMarquardt({ x: x34w, y: y3w }, cubeFit, { initialValues: initialValuesCube, maxIterations: 200, errorTolerance: 1e-10 });
        a3w = resultCube.parameterValues[0] ? resultCube.parameterValues[0] : 0;
        b3w = resultCube.parameterValues[1] ? resultCube.parameterValues[1] : 0;
        c3w = resultCube.parameterValues[2] ? resultCube.parameterValues[2] : 0;

        resultCube = levenbergMarquardt({ x: x34w, y: y4w }, cubeFit, { initialValues: initialValuesCube, maxIterations: 200, errorTolerance: 1e-10 });
        a4w = resultCube.parameterValues[0] ? resultCube.parameterValues[0] : 0;
        b4w = resultCube.parameterValues[1] ? resultCube.parameterValues[1] : 0;
        c4w = resultCube.parameterValues[2] ? resultCube.parameterValues[2] : 0;

        // // 4th or 5th order fit will be used for extra low time values (< 90 secs)
        // resultCube = levenbergMarquardt({ x: x34w, y: y3w }, fourOrderFit, { initialValues: initialValuesFourth, maxIterations: 200, errorTolerance: 1e-10 });
        // const a3w4 = resultCube.parameterValues[0];
        // const b3w4 = resultCube.parameterValues[1];
        // const c3w4 = resultCube.parameterValues[2];
        // const d3w4 = resultCube.parameterValues[3];

        // resultCube = levenbergMarquardt({ x: x34w, y: y4w }, fourOrderFit, { initialValues: initialValuesFourth, maxIterations: 200, errorTolerance: 1e-10 });
        // const a4w4 = resultCube.parameterValues[0];
        // const b4w4 = resultCube.parameterValues[1];
        // const c4w4 = resultCube.parameterValues[2];
        // const d4w4 = resultCube.parameterValues[3];

        if (expirationSecs[j] === 60 && strikeA === 99.95) {
          console.log("BINGO");
          console.log("x34w", x34w);
          console.log("y3w", y3w);
          console.log("y4w", y4w);
  
          // // for time interpolation
          // console.log("x12 and y1");
          // const checkArray = [];
          // for (let k = 0; k < fitPoints; k++) {
          //   const x = k * timeChunk / (expirationYearsB - expirationYearsA);
          //   checkArray.push(a1 * x ** 3 + b1 * x ** 2 + c1 * x);
          // }

          // for (let i = 0; i < fitPoints; i++) {
          //   console.log(x12[i].toFixed(2) + ",", y1[i].toFixed(6) + ",", checkArray[i].toFixed(6));
          // }
  
          // for strike interpolation
          const checkArray3w3 = [], checkArray3w4 = [], checkArray4w3 = [], checkArray4w4 = [], checkArray3wn = [], checkArray4wn = []
          for (let k = 0; k < fitPoints; k++) {
            const x = (k * strikeChunk) / (strikeB - strikeA);
            checkArray3w3.push(a3w * x ** 3 + b3w * x ** 2 + c3w * x);
            checkArray4w3.push(a4w * x ** 3 + b4w * x ** 2 + c4w * x);
          }
          console.log("Print 3 and 4")
          console.log("x34w, actual y3w, check 3w");          
          for (let i = 0; i < fitPoints; i++) {
            console.log(x34w[i].toFixed(3) + ",", y3w[i].toFixed(6) + ",", checkArray3w3[i].toFixed(6));
          }
          console.log("x34w, actual y4w, check 4w");          
          for (let i = 0; i < fitPoints; i++) {
            console.log(x34w[i].toFixed(3) + ",", y4w[i].toFixed(6) + ",", checkArray4w3[i].toFixed(6));
          }
        }
      }

      // reduce prices to 8 decimals, factors to 6 decimals
      const element = {
        intrinsicPriceAA: Math.round(intrinsicPriceAA * 1e8) / 1e8,
        intrinsicPriceBAdiff: Math.round((intrinsicPriceAA - intrinsicPriceBA) * 1e8) / 1e8,

        a1: Math.round(a1 * 1e6) / 1e6,
        b1: Math.round(b1 * 1e6) / 1e6,
        c1: Math.round(c1 * 1e6) / 1e6,
        a2diff: Math.round((a1 - a2) * 1e6) / 1e6,
        b2diff: Math.round((b1 - b2) * 1e6) / 1e6,
        c2diff: Math.round((c1 - c2) * 1e6) / 1e6,

        a3w: Math.round(a3w * 1e6) / 1e6,
        b3w: Math.round(b3w * 1e6) / 1e6,
        c3w: Math.round(c3w * 1e6) / 1e6,
        a4wdiff: Math.round((a3w - a4w) * 1e6) / 1e6,
        b4wdiff: Math.round((b3w - b4w) * 1e6) / 1e6,
        c4wdiff: Math.round((c3w - c4w) * 1e6) / 1e6,
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

  // intrinsicPriceAA [ 0 - 82.48847598 ]
  // intrinsicPriceBAdiff [ -0.45296252 - 0.47119369 ]
  // a1 [ -0.005348 - 0.011765 ]
  // b1 [ -0.23659 - 0.056593 ]
  // c1 [ 0 - 4.860914 ]
  // a2diff [ -0.000134 - 0.000207 ]
  // b2diff [ -0.00258 - 0.001524 ]
  // c2diff [ -0.025636 - 0.029092 ]
  // a3w [ -0.31261 - 8.184084 ]
  // b3w [ -14.254104 - 0.27579 ]
  // c3w [ 0 - 7.271892 ]
  // a4wdiff [ -0.016531 - 0.453166 ]
  // b4wdiff [ -0.725168 - 0.056592 ]
  // c4wdiff [ -0.014163 - 4.860915 ]

  const lookupTableSOL = new Map();
  // pack for SOL lookup table
  for (const [key, value] of lookupTable) {
    const { intrinsicPriceAA, intrinsicPriceBAdiff, a1, b1, c1, a2diff, b2diff, c2diff, a3w, b3w, c3w, a4wdiff, b4wdiff, c4wdiff } = value;
    const intrinsicPriceAABigInt = BigInt(parseInt(intrinsicPriceAA * 1e8));
    const intrinsicPriceBAdiffBigInt = BigInt(parseInt(Math.max(0, (intrinsicPriceBAdiff + 0.452963)) * 1e6)); // todo: this was 1e8, see if this is enough, still got 6 bits extra
    const a1BigInt = BigInt(parseInt(Math.max(0, (a1 + 0.005348)) * 1e6));
    const b1BigInt = BigInt(parseInt(Math.max(0, (b1 + 0.23659)) * 1e6));
    const c1BigInt = BigInt(parseInt(c1 * 1e6));

    const a2diffBigInt = BigInt(parseInt(Math.max(0, (a2diff + 0.000134)) * 1e6));
    const b2diffBigInt = BigInt(parseInt(Math.max(0, (b2diff + 0.00258)) * 1e6));
    const c2diffBigInt = BigInt(parseInt(Math.max(0, (c2diff + 0.025636)) * 1e6));

    const a3wBigInt = BigInt(parseInt(Math.max(0, (a3w + 0.31261)) * 1e5));
    const b3wBigInt = BigInt(parseInt(Math.max(0, (b3w + 14.2541)) * 1e5));
    const c3wBigInt = BigInt(parseInt(c3w * 1e5));

    const a4wdiffBigInt = BigInt(parseInt(Math.max(0, (a4wdiff + 0.01653)) * 1e5));
    const b4wdiffBigInt = BigInt(parseInt(Math.max(0, (b4wdiff + 0.72517)) * 1e5));
    const c4wdiffBigInt = BigInt(parseInt(Math.max(0, (c4wdiff + 0.01416)) * 1e5));

    // vol 12% bits packing
    // AA BAdiff: 27 + 20 = 47
    // a1 b1 c1: 15 + 15 + 23 = 53
    // a2diff b2diff c2diff: 9 + 12 + 16 = 37
    // a3w b3w c3w: 20 + 21 + 20 = 61
    // a4diff b4diff c4diff: 16 + 17 + 19 = 52
    // TOTAL: 250 bits

    if(key === 9220267) {
      console.log("intrinsicPriceAABigInt", intrinsicPriceAABigInt, intrinsicPriceAABigInt * BigInt(2 ** 223));
    }


    const elementForSOL = 
      intrinsicPriceAABigInt * BigInt(2 ** 223) +
      intrinsicPriceBAdiffBigInt * BigInt(2 ** 203) +
      a1BigInt * BigInt(2 ** 188) + 
      b1BigInt * BigInt(2 ** 173) + 
      c1BigInt * BigInt(2 ** 150) + 
      a2diffBigInt * BigInt(2 ** 141) +
      b2diffBigInt * BigInt(2 ** 129) + 
      c2diffBigInt * BigInt(2 ** 113) + 
      a3wBigInt * BigInt(2 ** 93) +
      b3wBigInt * BigInt(2 ** 72) + 
      c3wBigInt * BigInt(2 ** 52) + 
      a4wdiffBigInt * BigInt(2 ** 36) + 
      b4wdiffBigInt * BigInt(2 ** 19) + 
      c4wdiffBigInt;

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

function intToUint(value, bits, decimals) {
  const divider = 2 ** (bits - 1);
  if (Math.abs(factor) > 2147.483648) throw new Error("factor out of bounds: " + factor);

  // positive
  if (factor > 0) {
    return BigInt(parseInt(factor * 1e6));
  }

  // negative
  return BigInt(parseInt((Math.abs(factor) + 2147.483648) * 1e6)); // half the 2 ** 32
  
}

export function generateStrikePoints(blackScholesJS, startPoint, endPoint) {
  const points = [startPoint];
  
  for (let strike = startPoint; strike <= endPoint; strike += 1 / STRIKE_INDEX_MULTIPLIER) {
    const lastStrike = points[points.length - 1];
    const newStrike = blackScholesJS.getStrikeFromIndex(blackScholesJS.getIndexFromStrike(strike));
    if (lastStrike !== newStrike) {
      points.push(newStrike);
    }
  }
  points.push(endPoint); // last point

  return points;
}

export function generateTimePoints() {
  const points = [1, 2, 3, 4, 5, 6, 7];

  for (let major = 3; major < MAX_MAJOR; major++) {
    for(let minor = 0; minor < 8; minor++) {
      points.push(parseFloat(2 ** major + minor * 2 ** (major - 3)));
    }
  }
  points.push(parseFloat(2 ** MAX_MAJOR)); // last point

  // console.log("Last time point: ", points[points.length - 1]);

  return points;
}