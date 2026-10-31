import {preparePlayerAsset,hydratePlayerAsset,yieldPlayerTask} from './player-asset-format.js';
const defaultWorker=()=>new Worker(new URL('./player-asset-worker.js',import.meta.url),{type:'module',name:'player-assets'});
// One worker and one hydration job per renderer namespace. Neither actor count
// nor rapid character changes create an unbounded number of threads or tasks.
export function createPlayerAssetLoader({workerFactory=typeof Worker==='function'?defaultWorker:null,capacity=32,timeoutMs=30000,yieldTask=yieldPlayerTask,budgetMs=3}={}){
 if(!Number.isInteger(capacity)||capacity<1||capacity>64||!Number.isFinite(timeoutMs)||timeoutMs<1||!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>8)throw new RangeError('Invalid player asset queue limits');
 const queue=[];let worker=null,active=null,serial=0,timer=null,disposed=false,disabled=workerFactory?null:'Worker unavailable';
 const totals={workerJobs:0,inlineJobs:0,workerFailures:0,completed:0,rejected:0,peak:0};
 const clearTimer=()=>{if(timer!==null)clearTimeout(timer);timer=null;};
 function finish(job,error,result){if(active!==job)return;clearTimer();active=null;if(error){totals.rejected++;job.reject(error);}else{totals.completed++;job.resolve(result);}pump();}
 async function install(job,result,lane){
  try{job.stage='hydrate';const hydrated=await hydratePlayerAsset(result.packed,{yieldTask,budgetMs});if(disposed||active!==job)return;
   finish(job,null,{data:hydrated.data,verified:result.verified===true,processing:{lane,...result.metrics,...hydrated.metrics,...(lane==='inline-fallback'?{fallbackReason:disabled}:{} )}});
  }catch(error){finish(job,error);}
 }
 async function inline(job){
  totals.inlineJobs++;job.stage='inline';try{const result=await preparePlayerAsset(job.request,{yieldTask});if(disposed||active!==job)return;await install(job,result,'inline-fallback');}catch(error){finish(job,error);}
 }
 function disable(cause,current){
  if(current!==worker)return;disabled=String(cause?.message||cause||'Worker failed').slice(0,256);totals.workerFailures++;clearTimer();try{worker?.terminate();}catch{}worker=null;
  if(active?.stage==='worker')inline(active);
 }
 function ensureWorker(){
  if(worker||disabled)return worker;
  try{const current=workerFactory();worker=current;
   current.addEventListener('message',event=>{if(disposed||worker!==current||!active||event.data?.id!==active.id||active.stage!=='worker')return;const job=active,m=event.data;clearTimer();
    if(m.type==='player-asset-error'){finish(job,Error(String(m.message||'Player asset rejected').slice(0,512)));return;}
    if(m.type!=='prepared-player'){disable(Error('Invalid worker reply'),current);return;}install(job,m,'worker');
   });
   current.addEventListener('error',event=>{event.preventDefault?.();disable(Error(event.message||'Player worker failed'),current);});
   current.addEventListener('messageerror',()=>disable(Error('Player worker message decode failed'),current));
  }catch(error){disabled=String(error?.message||error).slice(0,256);totals.workerFailures++;try{worker?.terminate();}catch{}worker=null;}
  return worker;
 }
 function pump(){
  if(disposed||active||!queue.length)return;active=queue.shift();const job=active,current=ensureWorker();
  if(!current){inline(job);return;}job.stage='worker';totals.workerJobs++;
  timer=setTimeout(()=>disable(Error('Player worker timed out'),current),timeoutMs);
  try{current.postMessage({type:'prepare-player',id:job.id,request:job.request});}catch(error){disable(error,current);}
 }
 function dispose(){if(disposed)return;disposed=true;clearTimer();try{worker?.terminate();}catch{}worker=null;const jobs=[...(active?[active]:[]),...queue.splice(0)];active=null;for(const job of jobs)job.reject(Error('Player asset loader disposed'));}
 globalThis.addEventListener?.('pagehide',dispose,{once:true});
 return {load(request){if(disposed)return Promise.reject(Error('Player asset loader disposed'));if(queue.length+(active?1:0)>=capacity)return Promise.reject(Error('Player asset queue full'));
   return new Promise((resolve,reject)=>{const job={id:++serial,request:{url:request.url,id:request.id,weapon:!!request.weapon,entry:Object.fromEntries(['source','sourceSHA256','baseSourceSHA256','convertedSHA256'].filter(k=>request.entry[k]!==undefined).map(k=>[k,request.entry[k]]))},resolve,reject,stage:'queued'};const priority=job.request.weapon?queue.findIndex(j=>!j.request.weapon):-1;if(priority>=0)queue.splice(priority,0,job);else queue.push(job);totals.peak=Math.max(totals.peak,queue.length+(active?1:0));pump();});},
  diagnostics:()=>({...totals,capacity,queued:queue.length,active:active?.stage||null,workerAvailable:!!worker,disabledReason:disabled,disposed}),dispose};
}
