// Browser-test only: actual native rAF samples are retained separately from the
// synthetic high-rate submission clock. Never imported by production modules.
export function installFrameClock({hz}){
 const native=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window),queue=new Map();let sequence=0,next=null,last=null,handle,running=true;
 const audit={kind:'synthetic-submission',targetHz:hz,nativeIntervals:[],ticks:0,maxBatch:0};window.cameraTestClock=audit;
 window.requestAnimationFrame=cb=>{const id=++sequence;queue.set(id,cb);return id;};window.cancelAnimationFrame=id=>queue.delete(id);
 function pump(t){if(!running)return;handle=native(pump);if(last!==null){audit.nativeIntervals.push(t-last);if(audit.nativeIntervals.length>2000)audit.nativeIntervals.shift();}last=t;next??=t;let count=0;
  while(next<=t+.1&&count<4){const callbacks=[...queue.values()];queue.clear();const at=next;next+=1000/hz;count++;audit.ticks++;for(const cb of callbacks){try{cb(at);}catch(e){setTimeout(()=>{throw e;},0);}}}audit.maxBatch=Math.max(audit.maxBatch,count);
 }handle=native(pump);addEventListener('pagehide',()=>{running=false;cancel(handle);queue.clear();},{once:true});
}
export function installUncapturedPointerLock(){
 // Allows visible GPU/cadence tests without capturing the user's physical mouse.
 let locked=false,element=null;Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>locked?element:null});
 HTMLCanvasElement.prototype.requestPointerLock=function(){element=this;locked=true;document.dispatchEvent(new Event('pointerlockchange'));return Promise.resolve();};
 document.exitPointerLock=()=>{locked=false;document.dispatchEvent(new Event('pointerlockchange'));};
}
