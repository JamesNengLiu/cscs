// Nonblocking GPU timestamps. Never gl.finish/readPixels in the game loop.
export function createGpuTimer(gl) {
  const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending=[];let active=null,lastMs=null,lastAt=-Infinity,disposed=false;
  function clear() {if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(active);active=null;}for(const item of pending)gl.deleteQuery(item.query);pending.length=0;lastMs=null;}
  return {
    supported:!!ext,
    poll(now) {
      if(!ext||disposed||gl.isContextLost())return null;
      if(gl.getParameter(ext.GPU_DISJOINT_EXT)){clear();return null;}
      while(pending.length){const item=pending[0];
        if(!gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE)){
          if(now-item.at>1000){gl.deleteQuery(item.query);pending.shift();continue;}break;
        }
        const ns=gl.getQueryParameter(item.query,gl.QUERY_RESULT);gl.deleteQuery(item.query);pending.shift();
        if(Number.isFinite(ns)&&ns>=0){lastMs=ns/1e6;lastAt=now;}
      }
      return now-lastAt<=500?lastMs:null;
    },
    begin() {if(!ext||disposed||active||pending.length>=4||gl.isContextLost())return;active=gl.createQuery();if(active)gl.beginQuery(ext.TIME_ELAPSED_EXT,active);},
    end(now) {if(!ext||!active||disposed||gl.isContextLost())return;gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query:active,at:now});active=null;},
    dispose(){if(disposed)return;disposed=true;if(ext&&!gl.isContextLost())clear();},
  };
}
