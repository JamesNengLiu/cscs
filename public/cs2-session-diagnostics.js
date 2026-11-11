// Opt-in observations only. No game state, clocks or inputs are changed here.
export const CS2_SESSION_COLUMNS=Object.freeze([
  'nowMs','wallMs','inputYaw','inputPitch',
  'cameraX','cameraY','cameraZ','cameraYaw','cameraPitch',
  'localX','localY','localZ','velocityX','velocityY','velocityZ',
  'physicsFraction','pendingInputs','inputSeq','ackInputSeq',
  'predictedTick','authoritativeTick','correctionX','correctionY','correctionZ',
  'cpuMs','gpuMs','gpuSampleId','mouseEvents','mouseDX','mouseDY',
  'lastMouseReceivedMs','lastMouseTimestamp',
]);

const SCHEMA='cs2-session-diagnostics-v1',AFTER_LIMIT=240;
const WINDOW_SCOPE='Bounded local numeric observations; frames retain recent accepted active samples across pause/resume. Each cycle freezes the pre-pause window and first 240 post-resume samples. GPU values can repeat: gpuSampleId identifies distinct completed queries. Not physical input-to-display latency.';
const INVALID=Symbol('invalid metadata'),OMIT=Symbol('undefined JSON member');
const MAX_METADATA_DEPTH=16,MAX_METADATA_NODES=4096,MAX_METADATA_CHARS=32768;

function boundedInteger(value,min,max,name){
  if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${name} exceeds diagnostic bounds`);
  return value;
}

// Copy JSON data without executing getters/toJSON or retaining caller objects.
// Undefined object members are omitted; array holes and nonfinite numbers use
// JSON's null representation. Invalid/oversized events are dropped atomically.
function copyMetadata(value){
  let nodes=0,chars=0;
  const ancestors=new Set();
  function text(value){chars+=value.length;if(chars>MAX_METADATA_CHARS)throw INVALID;return value;}
  function copy(value,depth){
    if(++nodes>MAX_METADATA_NODES||depth>MAX_METADATA_DEPTH)throw INVALID;
    if(value===undefined)return OMIT;
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(typeof value==='string')return text(value);
    if(typeof value!=='object'||ancestors.has(value))throw INVALID;
    ancestors.add(value);
    let result;
    if(Array.isArray(value)){
      const length=value.length;
      if(!Number.isSafeInteger(length)||length>MAX_METADATA_NODES)throw INVALID;
      result=[];
      for(let i=0;i<length;i++){
        const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
        if(descriptor&&!Object.hasOwn(descriptor,'value'))throw INVALID;
        const member=copy(descriptor?.value,depth+1);
        result.push(member===OMIT?null:member);
      }
    }else{
      const prototype=Object.getPrototypeOf(value);
      if(prototype!==Object.prototype&&prototype!==null)throw INVALID;
      result={};
      for(const key of Reflect.ownKeys(value)){
        const descriptor=Object.getOwnPropertyDescriptor(value,key);
        if(!descriptor?.enumerable)continue;
        if(typeof key!=='string'||!Object.hasOwn(descriptor,'value'))throw INVALID;
        text(key);
        const member=copy(descriptor.value,depth+1);
        if(member!==OMIT)Object.defineProperty(result,key,{value:member,enumerable:true,writable:true,configurable:true});
      }
    }
    ancestors.delete(value);
    return result;
  }
  try{return value===undefined?null:copy(value,0);}catch{return INVALID;}
}

function exportRows(buffer,count,width){
  const rows=[];
  for(let row=0;row<count;row++){
    const values=[];
    for(let column=0;column<width;column++){
      const value=buffer[row*width+column];values.push(Number.isFinite(value)?value:null);
    }
    rows.push(values);
  }
  return rows;
}

export function createCS2SessionDiagnostics({enabled=false,capacity=900,eventCapacity=12,cycleCapacity=2}={}){
  boundedInteger(capacity,1,3600,'capacity');
  boundedInteger(eventCapacity,0,64,'eventCapacity');
  boundedInteger(cycleCapacity,0,2,'cycleCapacity');
  const on=Boolean(enabled);
  if(!on)return Object.freeze({
    enabled:false,
    sample(){return false;},note(){return false;},pause(){return false;},resume(){return false;},
    snapshot(){return {enabled:false,schema:SCHEMA,columns:[...CS2_SESSION_COLUMNS],frames:[],notes:[],cycles:[],windowScope:WINDOW_SCOPE};},
  });

  const width=CS2_SESSION_COLUMNS.length,ring=new Float64Array(capacity*width),scratch=new Float64Array(width);
  let cursor=0,count=0,frameSequence=0,noteSequence=0,cycleSequence=0,paused=false,pausedCycle=null,collectAfter=null;
  const notes=[],cycles=[];
  function append(type,metadata){
    if(!eventCapacity)return;
    notes.push({id:++noteSequence,type,frameSequence,metadata});
    if(notes.length>eventCapacity)notes.shift();
  }
  function frozenFrames(){
    const buffer=new Float64Array(count*width),start=count===capacity?cursor:0;
    for(let row=0;row<count;row++){
      const from=((start+row)%capacity)*width,to=row*width;
      for(let column=0;column<width;column++)buffer[to+column]=ring[from+column];
    }
    return {buffer,count};
  }
  function eventPoint(metadata){return {frameSequence,metadata};}
  function exportPoint(point){return point?{frameSequence:point.frameSequence,metadata:copyMetadata(point.metadata)}:null;}
  return Object.freeze({
    enabled:true,
    sample(row){
      if(paused)return false;
      try{
        if(!(row instanceof Float64Array)||row.length!==width)return false;
        // Validate/copy before touching any retained frame or after-window.
        for(let column=0;column<width;column++){
          const value=row[column];if(typeof value!=='number')return false;
          scratch[column]=Number.isFinite(value)?value:NaN;
        }
      }catch{return false;}
      ring.set(scratch,cursor*width);cursor=(cursor+1)%capacity;count=Math.min(capacity,count+1);frameSequence++;
      if(collectAfter){
        collectAfter.after.set(scratch,collectAfter.afterCount*width);collectAfter.afterCount++;
        if(collectAfter.afterCount===AFTER_LIMIT)collectAfter=null;
      }
      return true;
    },
    note(type,metadata){
      if(!eventCapacity||typeof type!=='string'||!type.length||type.length>128)return false;
      const owned=copyMetadata(metadata);if(owned===INVALID)return false;
      append(type,owned);return true;
    },
    pause(metadata){
      if(paused)return false;
      const owned=copyMetadata(metadata);if(owned===INVALID)return false;
      collectAfter=null;paused=true;
      if(cycleCapacity){
        pausedCycle={id:++cycleSequence,pause:eventPoint(owned),resume:null,before:frozenFrames(),after:null,afterCount:0};
        cycles.push(pausedCycle);if(cycles.length>cycleCapacity)cycles.shift();
      }
      append('pause',owned);return true;
    },
    resume(metadata){
      const owned=copyMetadata(metadata);if(owned===INVALID)return false;
      if(paused){
        paused=false;
        if(pausedCycle){pausedCycle.resume=eventPoint(owned);pausedCycle.after=new Float64Array(AFTER_LIMIT*width);collectAfter=pausedCycle;pausedCycle=null;}
      }
      // Initial/redundant resume is observable, but never invents a cycle or
      // restarts the first-240 collector belonging to an earlier real pause.
      append('resume',owned);return true;
    },
    snapshot(){
      const live=frozenFrames();
      return {enabled:true,schema:SCHEMA,columns:[...CS2_SESSION_COLUMNS],frames:exportRows(live.buffer,live.count,width),
        notes:notes.map(note=>({id:note.id,type:note.type,frameSequence:note.frameSequence,metadata:copyMetadata(note.metadata)})),
        cycles:cycles.map(cycle=>({id:cycle.id,pause:exportPoint(cycle.pause),resume:exportPoint(cycle.resume),before:exportRows(cycle.before.buffer,cycle.before.count,width),after:cycle.after?exportRows(cycle.after,cycle.afterCount,width):[],afterLimit:AFTER_LIMIT,afterComplete:cycle.afterCount===AFTER_LIMIT})),
        windowScope:WINDOW_SCOPE};
    },
  });
}
