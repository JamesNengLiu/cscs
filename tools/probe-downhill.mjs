import fs from 'node:fs';
import {DOWNHILL_CASES,sampleSlope} from '../tests/downhill-fixtures.mjs';
const cases=DOWNHILL_CASES.flatMap(c=>[30,60,120,144].map(hz=>sampleSlope(c,hz)));
const report={label:process.argv[2]||'current',cases};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync(`artifacts/downhill-${report.label}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(cases.map(({samples,...r})=>r),null,2));
