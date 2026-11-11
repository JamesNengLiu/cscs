// Pure CPU diagnostics contracts. No browser, service, map asset or local capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CS2_SESSION_COLUMNS,createCS2SessionDiagnostics} from '../public/cs2-session-diagnostics.js';

const WIDTH=32;
const EXPECTED_COLUMNS=[
 'nowMs','wallMs','inputYaw','inputPitch',
 'cameraX','cameraY','cameraZ','cameraYaw','cameraPitch',
 'localX','localY','localZ','velocityX','velocityY','velocityZ',
 'physicsFraction','pendingInputs','inputSeq','ackInputSeq',
 'predictedTick','authoritativeTick','correctionX','correctionY','correctionZ',
 'cpuMs','gpuMs','gpuSampleId','mouseEvents','mouseDX','mouseDY',
 'lastMouseReceivedMs','lastMouseTimestamp',
];
const create=options=>createCS2SessionDiagnostics({enabled:true,...options});
const row=n=>Float64Array.from({length:WIDTH},(_,i)=>n+i/100);
const first=frames=>frames.map(frame=>frame[0]);
function accept(diagnostics,...values){for(const value of values)assert.equal(diagnostics.sample(row(value)),true);}
function poison(){return new Proxy({},{get(){throw new Error('must not read disabled input');},getPrototypeOf(){throw new Error('must not inspect disabled input');},ownKeys(){throw new Error('must not enumerate disabled input');}});}
function nested(depth){let value={value:1};for(let i=0;i<depth;i++)value={next:value};return value;}

test('schema exposes 32 unique frozen scalar columns and independent snapshot columns',()=>{
 assert.equal(CS2_SESSION_COLUMNS.length,WIDTH);
 assert.deepEqual(CS2_SESSION_COLUMNS,EXPECTED_COLUMNS);
 assert.equal(new Set(CS2_SESSION_COLUMNS).size,WIDTH);
 assert.ok(CS2_SESSION_COLUMNS.every(column=>typeof column==='string'&&column.length>0));
 assert.equal(Object.isFrozen(CS2_SESSION_COLUMNS),true);
 const diagnostics=create(),snapshot=diagnostics.snapshot();
 assert.equal(snapshot.enabled,true);
 assert.equal(snapshot.schema,'cs2-session-diagnostics-v1');
 assert.deepEqual(snapshot.columns,[...CS2_SESSION_COLUMNS]);
 assert.ok(Object.hasOwn(snapshot,'windowScope'));
 assert.notStrictEqual(snapshot.columns,CS2_SESSION_COLUMNS);
 snapshot.columns[0]='caller-mutated-column';
 assert.deepEqual(diagnostics.snapshot().columns,[...CS2_SESSION_COLUMNS]);
});

test('default disabled mode returns false before reading any row or event metadata',()=>{
 const diagnostics=createCS2SessionDiagnostics(),input=poison();
 assert.equal(diagnostics.enabled,false);
 assert.equal(diagnostics.sample(input),false);
 assert.equal(diagnostics.note(input,input),false);
 assert.equal(diagnostics.pause(input),false);
 assert.equal(diagnostics.resume(input),false);
 const snapshot=diagnostics.snapshot();
 assert.equal(snapshot.enabled,false);
 assert.deepEqual(snapshot.frames,[]);
 assert.deepEqual(snapshot.notes,[]);
 assert.deepEqual(snapshot.cycles,[]);
});

for(const [option,invalid]of [
 ['capacity',[-1,0,1.5,3601,NaN,Infinity,'3',null]],
 ['eventCapacity',[-1,1.5,65,NaN,Infinity,'3',null]],
 ['cycleCapacity',[-1,1.5,3,NaN,Infinity,'1',null]],
])test(`${option} rejects invalid bounds even while collection is disabled`,()=>{
 for(const value of invalid)assert.throws(()=>createCS2SessionDiagnostics({[option]:value}),RangeError,`${option}=${String(value)}`);
});

test('documented capacity endpoints are accepted and the maximum live window stays bounded',()=>{
 for(const options of [{capacity:1,eventCapacity:0,cycleCapacity:0},{capacity:3600,eventCapacity:64,cycleCapacity:2}])assert.doesNotThrow(()=>create(options));
 const diagnostics=create({capacity:3600});
 for(let n=1;n<=3602;n++)accept(diagnostics,n);
 const frames=diagnostics.snapshot().frames;
 assert.equal(frames.length,3600);
 assert.equal(frames[0][0],3);
 assert.equal(frames.at(-1)[0],3602);
});

test('default live window keeps the latest 900 accepted frames in chronological order',()=>{
 const diagnostics=create();
 for(let n=1;n<=905;n++)accept(diagnostics,n);
 assert.deepEqual(first(diagnostics.snapshot().frames),Array.from({length:900},(_,i)=>i+6));
});

test('small live windows wrap repeatedly without reordering or retaining caller row storage',()=>{
 const diagnostics=create({capacity:3}),scratch=row(1);
 assert.equal(diagnostics.sample(scratch),true);
 scratch.fill(999);
 assert.deepEqual(diagnostics.snapshot().frames,[Array.from(row(1))]);
 for(let n=2;n<=12;n++){scratch.set(row(n));assert.equal(diagnostics.sample(scratch),true);}
 scratch.fill(-999);
 assert.deepEqual(diagnostics.snapshot().frames,[10,11,12].map(n=>Array.from(row(n))));
});

test('nonfinite numeric cells are exported as null without changing finite cells',()=>{
 const diagnostics=create(),sample=row(7);
 sample[1]=NaN;sample[2]=Infinity;sample[3]=-Infinity;sample[4]=-0;
 assert.equal(diagnostics.sample(sample),true);
 const frame=diagnostics.snapshot().frames[0];
 assert.equal(frame.length,WIDTH);
 assert.equal(frame[0],7);
 assert.deepEqual(frame.slice(1,4),[null,null,null]);
 assert.equal(Object.is(frame[4],-0),true);
 assert.equal(frame[5],7.05);
 assert.doesNotThrow(()=>JSON.stringify(diagnostics.snapshot()));
});

test('note window keeps chronological bounded events at the accepted frame sequence',()=>{
 const diagnostics=create({capacity:2,eventCapacity:3});
 accept(diagnostics,1);
 assert.equal(diagnostics.note('first',{order:1}),true);
 accept(diagnostics,2);
 assert.equal(diagnostics.note('second',{order:2}),true);
 accept(diagnostics,3);
 assert.equal(diagnostics.note('third',{order:3}),true);
 assert.equal(diagnostics.note('fourth',{order:4}),true);
 const snapshot=diagnostics.snapshot();
 assert.deepEqual(first(snapshot.frames),[2,3]);
 assert.deepEqual(snapshot.notes.map(note=>note.type),['second','third','fourth']);
 assert.deepEqual(snapshot.notes.map(note=>note.frameSequence),[2,3,3]);
 assert.deepEqual(snapshot.notes.map(note=>note.metadata.order),[2,3,4]);
 assert.ok(snapshot.notes[0].id<snapshot.notes[1].id&&snapshot.notes[1].id<snapshot.notes[2].id);
});

test('metadata follows JSON undefined and nonfinite semantics and is copied on acceptance',()=>{
 const diagnostics=create(),metadata={label:'safe',drop:undefined,nested:{finite:3,nonfinite:Infinity},array:[undefined,,NaN,null,{value:4}]};
 assert.equal(diagnostics.note('metadata',metadata),true);
 metadata.label='changed';metadata.nested.finite=99;metadata.array[4].value=99;
 assert.deepEqual(diagnostics.snapshot().notes[0].metadata,{label:'safe',nested:{finite:3,nonfinite:null},array:[null,null,null,null,{value:4}]});
});

test('rejected metadata cannot execute accessors or alter accepted notes and cycles',()=>{
 const diagnostics=create();accept(diagnostics,1);
 assert.equal(diagnostics.note('kept',{safe:{value:1}}),true);
 const before=diagnostics.snapshot();
 let reads=0;
 const accessor={};Object.defineProperty(accessor,'danger',{enumerable:true,get(){reads++;throw new Error('accessor executed');}});
 const arrayAccessor=[];Object.defineProperty(arrayAccessor,0,{enumerable:true,get(){reads++;return 1;}});
 const cycle={};cycle.self=cycle;
 const invalid=[{fn(){}},{big:1n},accessor,{nested:accessor},{array:arrayAccessor},cycle,{date:new Date(0)},{map:new Map([['a',1]])}];
 for(const metadata of invalid){
  assert.equal(diagnostics.note('rejected',metadata),false);
  assert.equal(diagnostics.pause(metadata),false);
  assert.equal(diagnostics.resume(metadata),false);
  assert.deepEqual(diagnostics.snapshot(),before);
 }
 assert.equal(reads,0);
});

test('metadata depth, node count, and combined key/string size are bounded',()=>{
 const diagnostics=create({eventCapacity:64});
 for(const metadata of [nested(15),Array(4095).fill(1),{a:'x'.repeat(32767)}])assert.equal(diagnostics.note('within-budget',metadata),true);
 const before=diagnostics.snapshot();
 for(const metadata of [nested(16),Array(4096).fill(1),{a:'x'.repeat(32768)},{['k'.repeat(32769)]:1}]){
  assert.equal(diagnostics.note('over-budget',metadata),false);
  assert.deepEqual(diagnostics.snapshot(),before);
 }
});

test('sparse array holes count as exported null nodes toward the shared metadata budget',()=>{
 const diagnostics=create();
 assert.equal(diagnostics.note('within-budget',{values:Array(4000)}),true);
 const before=diagnostics.snapshot();
 assert.deepEqual(before.notes[0].metadata.values,Array(4000).fill(null));
 assert.equal(diagnostics.note('over-budget',{values:[Array(3000),Array(3000)]}),false);
 assert.deepEqual(diagnostics.snapshot(),before);
});

test('pause freezes the most recent accepted window while retaining the live ring',()=>{
 const diagnostics=create({capacity:3}),metadata={reason:'menu',nested:{value:1}};
 accept(diagnostics,1,2,3,4);
 assert.equal(diagnostics.pause(metadata),true);
 metadata.nested.value=99;
 const paused=diagnostics.snapshot();
 assert.deepEqual(first(paused.frames),[2,3,4]);
 assert.equal(paused.cycles.length,1);
 assert.deepEqual(first(paused.cycles[0].before),[2,3,4]);
 assert.deepEqual(paused.cycles[0].pause,{frameSequence:4,metadata:{reason:'menu',nested:{value:1}}});
 assert.equal(paused.cycles[0].resume,null);
 assert.deepEqual(paused.cycles[0].after,[]);
 assert.equal(paused.cycles[0].afterLimit,240);
 assert.equal(diagnostics.sample(poison()),false);
 assert.equal(diagnostics.sample(row(5)),false);
 assert.deepEqual(diagnostics.snapshot(),paused);
});

test('repeated pause keeps the first boundary, metadata, and single pause note',()=>{
 const diagnostics=create({capacity:2});accept(diagnostics,1,2,3);
 assert.equal(diagnostics.pause({reason:'first'}),true);
 const firstPause=diagnostics.snapshot();
 assert.equal(diagnostics.pause({reason:'repeat'}),false);
 assert.equal(diagnostics.pause(poison()),false);
 assert.deepEqual(diagnostics.snapshot(),firstPause);
 assert.equal(firstPause.notes.filter(note=>note.type==='pause').length,1);
});

test('initial resume writes a note without manufacturing a pause cycle',()=>{
 const diagnostics=create();
 assert.equal(diagnostics.resume({reason:'initial-lock'}),true);
 accept(diagnostics,1);
 assert.equal(diagnostics.resume({reason:'redundant-lock'}),true);
 const snapshot=diagnostics.snapshot();
 assert.deepEqual(snapshot.cycles,[]);
 assert.deepEqual(snapshot.notes.map(note=>[note.type,note.frameSequence]),[['resume',0],['resume',1]]);
});

test('repeated resume notes do not overwrite a cycle boundary or restart its after capture',()=>{
 const diagnostics=create({capacity:3});accept(diagnostics,1,2,3,4);
 diagnostics.pause({reason:'pause'});
 assert.equal(diagnostics.resume({reason:'first-resume'}),true);
 accept(diagnostics,5,6);
 assert.equal(diagnostics.resume({reason:'repeat-resume'}),true);
 accept(diagnostics,7);
 const snapshot=diagnostics.snapshot(),cycle=snapshot.cycles[0];
 assert.deepEqual(cycle.resume,{frameSequence:4,metadata:{reason:'first-resume'}});
 assert.deepEqual(first(cycle.before),[2,3,4]);
 assert.deepEqual(first(cycle.after),[5,6,7]);
 assert.deepEqual(first(snapshot.frames),[5,6,7]);
 assert.deepEqual(snapshot.notes.map(note=>note.type),['pause','resume','resume']);
 assert.deepEqual(snapshot.notes.map(note=>note.frameSequence),[4,4,6]);
});

test('after capture contains the first 240 accepted resumed frames despite a smaller live window',()=>{
 const diagnostics=create({capacity:2});accept(diagnostics,1,2);
 diagnostics.pause({reason:'menu'});diagnostics.resume({reason:'lock'});
 for(let n=3;n<=241;n++)accept(diagnostics,n);
 let cycle=diagnostics.snapshot().cycles[0];
 assert.equal(cycle.after.length,239);
 assert.equal(cycle.afterComplete,false);
 accept(diagnostics,242);
 cycle=diagnostics.snapshot().cycles[0];
 assert.equal(cycle.afterComplete,true);
 assert.equal(cycle.after.length,240);
 for(let n=243;n<=260;n++)accept(diagnostics,n);
 const snapshot=diagnostics.snapshot();
 assert.deepEqual(first(snapshot.cycles[0].after),Array.from({length:240},(_,i)=>i+3));
 assert.deepEqual(first(snapshot.frames),[259,260]);
});

test('a new pause stops the old after window and starts a new continuous before/resume chain',()=>{
 const diagnostics=create({capacity:3});accept(diagnostics,1,2,3);
 diagnostics.pause({name:'one'});diagnostics.resume({name:'one-resume'});accept(diagnostics,4,5);
 diagnostics.pause({name:'two'});
 let snapshot=diagnostics.snapshot();
 assert.equal(snapshot.cycles.length,2);
 assert.deepEqual(first(snapshot.cycles[0].after),[4,5]);
 assert.deepEqual(first(snapshot.cycles[1].before),[3,4,5]);
 assert.equal(snapshot.cycles[1].resume,null);
 assert.equal(diagnostics.sample(row(99)),false);
 diagnostics.resume({name:'two-resume'});accept(diagnostics,6,7);
 snapshot=diagnostics.snapshot();
 assert.deepEqual(first(snapshot.cycles[0].after),[4,5]);
 assert.deepEqual(first(snapshot.cycles[1].after),[6,7]);
 assert.deepEqual(first(snapshot.frames),[5,6,7]);
 assert.ok(snapshot.cycles[0].id<snapshot.cycles[1].id);
});

for(const cycleCapacity of [1,2])test(`cycleCapacity ${cycleCapacity} evicts oldest cycles independently of the live ring`,()=>{
 const diagnostics=create({capacity:2,cycleCapacity,eventCapacity:0});
 for(let n=1;n<=4;n++){
  accept(diagnostics,n);
  assert.equal(diagnostics.pause({boundary:n}),true);
  assert.equal(diagnostics.resume({boundary:n}),true);
 }
 accept(diagnostics,5);
 const snapshot=diagnostics.snapshot();
 assert.equal(snapshot.cycles.length,cycleCapacity);
 assert.deepEqual(snapshot.cycles.map(cycle=>cycle.pause.metadata.boundary),Array.from({length:cycleCapacity},(_,i)=>5-cycleCapacity+i));
 assert.deepEqual(first(snapshot.frames),[4,5]);
 assert.deepEqual(snapshot.notes,[]);
 assert.deepEqual(first(snapshot.cycles.at(-1).after),[5]);
});

test('zero event and cycle capacity preserve pause/resume collection state without retaining records',()=>{
 const diagnostics=create({capacity:1,eventCapacity:0,cycleCapacity:0});accept(diagnostics,1);
 assert.equal(diagnostics.note('unretained',{a:1}),false);
 assert.equal(diagnostics.pause({a:2}),true);
 assert.equal(diagnostics.sample(row(2)),false);
 assert.equal(diagnostics.resume({a:3}),true);
 accept(diagnostics,3);
 const snapshot=diagnostics.snapshot();
 assert.deepEqual(first(snapshot.frames),[3]);
 assert.deepEqual(snapshot.notes,[]);
 assert.deepEqual(snapshot.cycles,[]);
});

test('invalid rows and throwing row access leave both live history and in-progress after capture intact',()=>{
 const diagnostics=create({capacity:3});accept(diagnostics,1,2);
 diagnostics.pause({reason:'pause'});diagnostics.resume({reason:'resume'});accept(diagnostics,3);
 const before=diagnostics.snapshot();
 class ThrowingLength extends Float64Array{get length(){throw new Error('row length failed');}}
 const throwingIndex=new Proxy(row(4),{get(target,key){if(key===String(WIDTH-1))throw new Error('last row cell failed');return Reflect.get(target,key,target);}});
 const nonnumericIndex=new Proxy(row(4),{get(target,key){return key===String(WIDTH-1)?'4':Reflect.get(target,key,target);}});
 const invalid=[null,undefined,{},Array(WIDTH).fill(4),new Float32Array(WIDTH),new Float64Array(WIDTH-1),new Float64Array(WIDTH+1),new ThrowingLength(WIDTH),throwingIndex,nonnumericIndex,poison()];
 for(const sample of invalid){assert.equal(diagnostics.sample(sample),false);assert.deepEqual(diagnostics.snapshot(),before);}
 accept(diagnostics,4);
 const snapshot=diagnostics.snapshot();
 assert.deepEqual(first(snapshot.frames),[2,3,4]);
 assert.deepEqual(first(snapshot.cycles[0].after),[3,4]);
 assert.equal(diagnostics.note('sequence-check',{valid:true}),true);
 assert.equal(diagnostics.snapshot().notes.at(-1).frameSequence,4);
});

test('every exported snapshot owns its frames, notes, cycle rows, and boundary metadata',()=>{
 const diagnostics=create({capacity:2});accept(diagnostics,1,2);
 const pauseMetadata={nested:{reason:'menu'}},resumeMetadata={nested:{reason:'lock'}};
 diagnostics.pause(pauseMetadata);diagnostics.resume(resumeMetadata);accept(diagnostics,3);
 diagnostics.note('extra',{nested:{value:4}});
 pauseMetadata.nested.reason='changed';resumeMetadata.nested.reason='changed';
 const expected=diagnostics.snapshot(),caller=diagnostics.snapshot();
 caller.frames[0][0]=-1;caller.frames.push([999]);
 caller.notes[0].metadata.nested.reason='caller';caller.notes.at(-1).metadata.nested.value=-4;
 caller.cycles[0].before[0][0]=-2;caller.cycles[0].after[0][0]=-3;
 caller.cycles[0].pause.metadata.nested.reason='caller';caller.cycles[0].resume.metadata.nested.reason='caller';
 caller.cycles.push({id:'caller'});caller.notes.length=0;caller.columns.length=0;
 assert.deepEqual(diagnostics.snapshot(),expected);
 accept(diagnostics,4);
 assert.deepEqual(first(expected.cycles[0].after),[3]);
 assert.deepEqual(first(diagnostics.snapshot().cycles[0].after),[3,4]);
});
