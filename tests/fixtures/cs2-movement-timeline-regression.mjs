import assert from 'node:assert/strict';

// Browser-only helper. It holds a contiguous window, not one redundant batch.
// Reliable weapon operations are observed and always forwarded immediately.
export function installMovementFaultProbe(socket, clock=()=>performance.now()){
 const original=socket.send.bind(socket),events=[],held=[];let timer=null,pauseUntil=0,armed=false;
 const inputTypes=new Set(['inputBatch','inputCritical','input']);
 const describe=m=>({type:m.type,privatePredictionTickOnWire:(m.commands||[]).some(c=>Object.hasOwn(c,'predictionTick')),round:m.round??m.commands?.[0]?.round??null,seqMin:m.commands?.length?Math.min(...m.commands.map(c=>c.seq)):null,seqMax:m.commands?.length?Math.max(...m.commands.map(c=>c.seq)):null});
 const flush=()=>{if(!pauseUntil&&!held.length)return;if(timer)clearTimeout(timer);timer=null;const at=clock();pauseUntil=0;events.push({kind:'fault-flush',at,held:held.length});for(const row of held.splice(0)){events.push({kind:'send-after-hold',at,queuedAt:row.at,...describe(row.m)});original(row.m);}};
 socket.send=payload=>{const m=typeof payload==='string'?JSON.parse(payload):payload,at=clock();if(inputTypes.has(m.type)&&pauseUntil>at){held.push({m:structuredClone(m),at});events.push({kind:'hold-input',at,...describe(m)});return;}if(pauseUntil&&at>=pauseUntil)flush();events.push({kind:inputTypes.has(m.type)?'send-input':'send-reliable',at,...describe(m)});return original(payload);};
 return{events,arm(ms=60){if(armed)throw Error('Only one fault per probe is allowed');if(!Number.isFinite(ms)||ms<50||ms>100)throw Error('Expected a bounded single movement-input pause');armed=true;pauseUntil=clock()+ms;events.push({kind:'fault-start',at:clock(),plannedEnd:pauseUntil,durationMs:ms});timer=setTimeout(flush,ms);},dispose(){if(timer)clearTimeout(timer);if(held.length)flush();socket.send=original;},snapshot(){return{armed,pauseUntil,held:held.length,events:events.map(e=>({...e}))};}};
}

const max=v=>v.length?Math.max(...v):0;
export function summarizeMovementTimeline({ticks,frames,playerId,fault,dt=1/60,gravity=800*.0254}){
 const rows=ticks.map(t=>({tick:t.tick,time:t.time,round:t.round,...t.players.find(p=>p.id===playerId)})).filter(p=>p.id===playerId),sameRound=rows.slice(1).flatMap((row,i)=>row.round===rows[i].round?[{before:rows[i],after:row}]:[]);
 const ackBackwards=sameRound.filter(q=>q.after.ackInputSeq<q.before.ackInputSeq),ackStalls=sameRound.filter(q=>q.after.ackInputSeq===q.before.ackInputSeq),air=sameRound.filter(q=>!q.before.grounded&&!q.after.grounded),airStalls=air.filter(q=>q.after.ackInputSeq===q.before.ackInputSeq);
 const gravityResidual=air.map(q=>({tick:q.after.tick,ackAdvanced:q.after.ackAdvanced,beforeVy:q.before.vy,afterVy:q.after.vy,gravityResidual:q.after.vy-q.before.vy+gravity*dt}));
 const correction=frames.map(f=>f.lastCorrection).filter(Number.isFinite),visualCorrection=frames.map(f=>Math.hypot(f.visualCorrection?.x||0,f.visualCorrection?.y||0,f.visualCorrection?.z||0));
 const holds=fault?.events?.filter(e=>e.kind==='hold-input')??[],starts=fault?.events?.filter(e=>e.kind==='fault-start')??[],flushes=fault?.events?.filter(e=>e.kind==='fault-flush')??[];
 return{ticks:rows.length,ackBackwards:ackBackwards.length,ackStallTicks:ackStalls.length,airTicks:air.length,airStallTicks:airStalls.length,gravityResidual,maxGravityResidual:Math.max(0,...gravityResidual.map(v=>Math.abs(v.gravityResidual))),maxCorrection:max(correction),maxVisualCorrection:max(visualCorrection),fault:{starts:starts.length,flushes:flushes.length,heldMessages:holds.length,privatePredictionTickOnWire:(fault?.events||[]).filter(e=>e.privatePredictionTickOnWire).length,firstHeldSeq:holds[0]?.seqMin??null,lastHeldSeq:holds.at(-1)?.seqMax??null,actualHoldMs:starts.length&&flushes.length?flushes[0].at-starts[0].at:null},scope:'Headless actual world/transport functional evidence. Ack stalls alone do not mean paused physics; gravity residual requires excluding contacts. No physical frame-rate or input-latency claim.'};
}

export function assertTimelineSafety(summary,{faultExpected=false}={}){
 assert.equal(summary.ackBackwards,0,'ACK must never run backwards within a round');assert.equal(summary.fault.privatePredictionTickOnWire,0,'Local movement-clock annotations must never leak into input wire payloads');assert.ok(summary.ticks>=60,'Retain at least one second of real authority ticks');assert.ok(summary.airTicks>0,'The air-strafe case must actually leave the ground');
 if(faultExpected){assert.equal(summary.fault.starts,1);assert.equal(summary.fault.flushes,1);assert.ok(summary.fault.heldMessages>=2,'A redundant batch sequence must actually be held');assert.ok(summary.fault.actualHoldMs>=50&&summary.fault.actualHoldMs<150,'The measured single pause must remain bounded');}
}

export async function runAwpFireDoubleQProtection({page,server,inputDelayMs=0}){
 const g=server.game,id=await page.evaluate(()=>window.lanStrike.getId()),p=g.players.get(id);assert.ok(p);const events=[],nativeEmit=g.emit;g.emit=function(e){if(e.type==='shot'&&e.id===id)events.push({...e});return nativeEmit.call(this,e);};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  for(const code of ['Space','KeyW','KeyA','KeyD'])await page.keyboard.up(code);await page.evaluate(()=>{window.cs2Automation.fire(false);window.cs2Automation.setKeys([]);});
  g.begin();g.phase='live';g.endAt=g.buyEndAt=g.time+10000;p.money=16000;if(!p.inventory.awp)g.buy(id,'awp');g.equip(id,'awp');g.drops=[];server.broadcastState();
  if(!await page.evaluate(()=>document.pointerLockElement===document.querySelector('#game'))){await page.locator('#resumeButton').click();await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game'));}
  await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.weapon==='awp'&&d.weaponModel.id==='awp'&&!d.weaponModel.loading&&d.weaponModel.sequence==='idle';},undefined,{timeout:15000});
  await page.keyboard.press('Digit3');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weapon==='knife');await page.keyboard.press('Digit1');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.weapon==='awp'&&d.weaponModel.id==='awp'&&!d.weaponModel.loading&&d.weaponModel.sequence==='idle';},undefined,{timeout:15000});
  const ready=Date.now()+5000;while(g.time<p.nextAttackAt&&Date.now()<ready)await sleep(10);assert.ok(g.time>=p.nextAttackAt,'AWP deploy must finish before protection shot');
  await page.mouse.click(960,418,{button:'right'});await page.waitForFunction(()=>{const s=window.lanStrike,p=s.getState()?.players.find(p=>p.id===s.getId());return p?.weapon==='awp'&&p.zoom<90;},undefined,{timeout:5000});
  const ammoBefore=p.ammo,before=await page.evaluate(()=>({predicted:window.lanStrike.getDiagnostics().shotFeedback.predicted,diagnostics:window.lanStrike.getDiagnostics()}));await page.evaluate(()=>window.__yellow.resetFault());if(inputDelayMs)await page.evaluate(ms=>window.__yellow.fault.arm(ms),inputDelayMs);
  await page.mouse.down({button:'left'});await page.waitForFunction(n=>window.lanStrike.getDiagnostics().shotFeedback.predicted>n,before.predicted,{timeout:3000});await page.mouse.up({button:'left'});await page.keyboard.press('KeyQ');await sleep(15);await page.keyboard.press('KeyQ');
  const shotCount=()=>new Set(events.filter(e=>typeof e.shotId==='string'&&e.shotId).map(e=>e.shotId)).size;const deadline=Date.now()+5000;while(Date.now()<deadline&&(shotCount()!==1||p.weapon!=='awp'||p.ammo!==ammoBefore-1))await sleep(10);await sleep(100);
  const after=await page.evaluate(()=>({diagnostics:window.lanStrike.getDiagnostics(),fault:window.__yellow.fault.snapshot()})),result={ammoBefore,ammoAfter:p.ammo,weapon:p.weapon,zoom:p.zoom,previousWeapon:p.previousWeapon,shotCount:shotCount(),segmentCount:events.length,distinctShotIds:shotCount(),shots:events,before,after,scope:'Actual authority shot/ammo and reliable double-Q after local prediction. Trusted browser keys, synthetic isolated single player; no physical display claim.'};
  server.__awpProtectionEvidence=result;assert.ok(events.every(e=>typeof e.shotId==='string'&&e.shotId),'All penetration segments retain a real shot identity');assert.equal(shotCount(),1,'Scoped AWP fire before Q/Q must produce exactly one authoritative shot');assert.equal(result.distinctShotIds,1);assert.equal(p.ammo,ammoBefore-1,'Scoped AWP fire must consume exactly one round');assert.equal(p.weapon,'awp','Both reliable Q operations must complete');assert.equal(p.previousWeapon,'knife');assert.equal(p.zoom,90,'Quick switching must not silently re-scope AWP');return result;
 }finally{g.emit=nativeEmit;await page.mouse.up({button:'left'}).catch(()=>{});for(const code of ['Space','KeyW','KeyA','KeyD'])await page.keyboard.up(code).catch(()=>{});}
}

export function assertMovementClockSamples(frames){
 const samples=frames.filter(f=>f.movementTimeline?.version===1);assert.ok(samples.length>20,'Candidate must actually exercise the movement timeline replay');const strategies={};let covered=0,neutral=0,edgeFrames=0,physicalFrames=0,unanchoredFrames=0;
 for(const f of samples){const t=f.movementTimeline;assert.ok(Number.isSafeInteger(t.authoritativeTick));assert.ok(Number.isSafeInteger(t.predictedTick));assert.ok(t.predictedTick>=t.authoritativeTick);if(t.strategy==='edge-replay'){assert.ok(['jump','stance','walk'].includes(t.edge));assert.equal(t.physicalReplayEndTick,t.authoritativeTick+t.replayedTicks);edgeFrames++;}else if(t.strategy==='unanchored-replay'){
  // Provisional labels between a clock reset and the first applied-command
  // anchor replay every pending sample in order.
  assert.equal(t.edge,null);assert.equal(t.coveredCommands,0);assert.equal(t.physicalReplayEndTick,t.authoritativeTick+t.replayedTicks);unanchoredFrames++;}else{assert.equal(t.strategy,'physical-time');assert.equal(t.replayedTicks,t.predictedTick-t.authoritativeTick);physicalFrames++;}assert.ok(t.replayedTicks<=128);assert.ok(t.clockTick>=t.serverTick);assert.equal(f.localMovementTick,t.clockTick,'The displayed local pose must represent the current movement-clock tick');for(const c of f.pendingSamples){assert.ok(c.seq>f.authority.ackInputSeq,'Only real command ACKs retire combat/input commands');assert.ok(Number.isSafeInteger(c.predictionTick),'Local immutable samples retain their movement tick');}covered=Math.max(covered,t.coveredCommands);neutral+=t.neutralTicks||0;strategies[t.strategy||'unknown']=(strategies[t.strategy||'unknown']||0)+1;}
 assert.ok(physicalFrames>20,'Edge protection cannot replace the physical-time fix');
 return{samples:samples.length,physicalFrames,edgeFrames,unanchoredFrames,maxCoveredUnackedCommands:covered,sumReportedNeutralReplayTicks:neutral,scope:'Per-frame invariant checks; edge frames deliberately retain the preexisting unacknowledged jump/stance prediction. Repeated snapshots can report the same replay interval, so summed ticks are not unique physics ticks.'};
}

// Counterfactual only: the old replay starts from the exact same received
// authority and normalized unacked commands as this candidate reconciliation.
// It does not reproduce an entire closed-loop old-client session.
export function summarizeReconcileShadows(rows){
 const stats=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),q=p=>sorted.length?sorted[Math.ceil((sorted.length-1)*p)]:null;return{samples:sorted.length,mean:sorted.length?sorted.reduce((sum,v)=>sum+v,0)/sorted.length:null,p50:q(.5),p95:q(.95),max:sorted.at(-1)??null};};
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),velocity=(a,b)=>Math.hypot(a.vx-b.vx,a.vy-b.vy,a.vz-b.vz);
 const strategies=Object.fromEntries([...new Set(rows.map(r=>r.timeline.strategy||'fallback'))].map(strategy=>{const selected=rows.filter(r=>(r.timeline.strategy||'fallback')===strategy),air=selected.filter(r=>!r.authority.grounded&&!r.candidate.grounded&&!r.legacyShadow.grounded&&!r.pending.some(c=>c.input.jump));return[strategy,{rows:selected.length,candidateVsLegacyPosition:stats(selected.map(r=>distance(r.candidate,r.legacyShadow))),candidateVsLegacyVelocity:stats(selected.map(r=>velocity(r.candidate,r.legacyShadow))),candidateVsPriorLocal:stats(selected.map(r=>distance(r.candidate,r.priorLocal))),legacyVsPriorLocal:stats(selected.map(r=>distance(r.legacyShadow,r.priorLocal))),oldReplayedMinusCandidateTicks:stats(selected.map(r=>r.oldOrderedSequences.length-r.timeline.replayedTicks)),pureAirRows:air.length,pureAirVerticalVelocityDelta:stats(air.map(r=>r.candidate.vy-r.legacyShadow.vy)),pureAirExtraGravityResidual:stats(air.map(r=>(r.candidate.vy-r.legacyShadow.vy)-(r.oldOrderedSequences.length-r.timeline.replayedTicks)*(800*.0254/60)))}];}));
 return{rows:rows.length,strategies,scope:'Same-authority/same-pending-input counterfactual replay; pure-air residual still requires contact review. This shadow is observational and never replaces runtime state, command ACKs or weapon state. It is not a separate closed-loop old-client run.'};
}
