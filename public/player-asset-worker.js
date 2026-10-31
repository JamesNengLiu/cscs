import {preparePlayerAsset,playerTransferList} from './player-asset-format.js';
// The page owns one bounded request queue; a worker handles only its active job.
globalThis.onmessage=async event=>{
 const message=event.data;if(message?.type!=='prepare-player'||!Number.isSafeInteger(message.id))return;
 try{const result=await preparePlayerAsset(message.request);globalThis.postMessage({type:'prepared-player',id:message.id,...result},playerTransferList(result.packed));}
 catch(error){globalThis.postMessage({type:'player-asset-error',id:message.id,message:String(error?.message||error).slice(0,512)});}
};
