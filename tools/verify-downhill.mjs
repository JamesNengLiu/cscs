import fs from 'node:fs';
import {DOWNHILL_CASES} from '../tests/downhill-fixtures.mjs';
import {simulateDownhill} from '../tests/downhill-network.mjs';
const cases=DOWNHILL_CASES.flatMap(c=>[true,false].map(legacy=>simulateDownhill(c,{hz:60,latency:.02,legacy})));
const report={scope:'Deterministic local simulation of actual Game.step, map hulls, 60Hz prediction, 15Hz snapshots, 20ms one-way message delay. Not physical Wi-Fi testing.',cases};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/downhill-network-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(cases.map(({samples,...r})=>r),null,2));
