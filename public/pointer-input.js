// Raw input is requested through the browser API; DPI is never inferred from it.
export function createPointerInput(element,{now=()=>performance.now()}={}){
 let inflight=false,pending=null,mode='not-requested',failure=null,events=0,countsX=0,countsY=0,maxDelta=0;
 async function perform(raw){
   inflight=true;failure=null;
   try{
    let result,rawOptionRead=false;
    try{result=raw?element.requestPointerLock({get unadjustedMovement(){rawOptionRead=true;return true;}}):element.requestPointerLock();if(result?.then)await result;mode=raw?(result?.then&&rawOptionRead?'raw-accepted':'raw-requested-unconfirmed'):'adjusted';}
    catch(error){if(!raw||!['NotSupportedError','TypeError'].includes(error?.name))throw error;result=element.requestPointerLock();if(result?.then)await result;mode='adjusted-fallback';}
    return true;
   }catch(error){mode='failed';failure={name:error?.name||'Error',at:now()};return false;}
   finally{inflight=false;}
  }
 return {get inflight(){return inflight;},request(raw=false){if(!pending)pending=perform(raw).finally(()=>{pending=null;});return pending;},
  observe(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return false;events++;countsX+=x;countsY+=y;maxDelta=Math.max(maxDelta,Math.abs(x),Math.abs(y));return true;},
  resetCounts(){events=countsX=countsY=maxDelta=0;},
  diagnostics:()=>({mode,inflight,failure:failure?.name||null,events,countsX,countsY,maxDelta,scope:'Browser request status and relative counts; physical DPI/OS acceleration are not measured'}),
  status(){return { 'not-requested':'尚未捕获鼠标', 'raw-accepted':'浏览器已接受原始输入请求','raw-requested-unconfirmed':'已请求原始输入；旧接口无法确认','adjusted':'普通相对输入','adjusted-fallback':'平台不支持原始输入，已回退普通输入','failed':'鼠标捕获失败'}[mode];}
 };
}
export function mouseCalibration(radiansPerCount,dpi=0){
 const counts=Number.isFinite(radiansPerCount)&&radiansPerCount>0?Math.PI*2/radiansPerCount:null;
 return {countsPerTurn:counts,cmPerTurn:counts&&Number.isFinite(dpi)&&dpi>0?counts/dpi*2.54:null};
}
