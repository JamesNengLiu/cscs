import fs from 'node:fs';
import {RULES,trace,isGrounded,supportHeight,collides} from '../public/shared.js';
import {DOWNHILL_CASES,sampleSlope} from '../tests/downhill-fixtures.mjs';
const r=JSON.parse(fs.readFileSync('artifacts/downhill-before.json')).cases.find(c=>c.name==='A-long ramp'&&c.hz===60),p=r.samples.at(-1);
console.log('STUCK',JSON.stringify({p,ground:isGrounded(p),collides:collides(p.x,p.z,RULES.radius,p.y),down:trace(p,{...p,y:p.y-.49},RULES.bodyHeight),forward:trace(p,{...p,z:p.z+.1},RULES.bodyHeight),pointfloor:supportHeight(p.x,p.z,p.y+.1)},null,2));
for(const x of [34.4,35.2,36]){const c={...DOWNHILL_CASES[1],start:[x,2,-64.8]};try{const {samples,...summary}=sampleSlope(c);console.log('NEIGHBOR',JSON.stringify({x,...summary}));}catch(e){console.log('ERROR',x,e.message);}}
