// Best-effort idle-only shader/texture preparation; never gates player input.
export function createPresentationWarmup(THREE,renderer,scene,camera,{canRun=()=>true,
  schedule=fn=>globalThis.requestIdleCallback?requestIdleCallback(fn,{timeout:500}):setTimeout(fn,0),
  cancel=id=>globalThis.cancelIdleCallback?cancelIdleCallback(id):clearTimeout(id),capacity=64}={}){
  const queue=[],queued=new WeakSet(),done=new WeakSet(),warmCamera=camera.clone(false);warmCamera.layers.enableAll();
  let scheduled=null,running=false,disposed=false,uploaded=0,compiled=0,skipped=0,errors=0,peak=0;
  function resume(){if(disposed||running||scheduled!==null||!queue.length||!canRun())return;scheduled=schedule(run);}
  async function run(deadline){scheduled=null;if(disposed||!canRun())return;running=true;const started=performance.now();
    try{do{const job=queue.shift();if(!job)break;for(const object of job.objects)queued.delete(object);
      if(!job.valid()){skipped++;continue;}
      try{if(job.texture){renderer.initTexture(job.objects[0]);uploaded++;}
        else{const group=new THREE.Group();for(const object of job.objects)group.add(object.clone(true));warmCamera.copy(camera,false);warmCamera.layers.enableAll();await renderer.compileAsync(group,warmCamera,scene);compiled++;}
        for(const object of job.objects)done.add(object);
      }catch{errors++;}
    }while(!disposed&&canRun()&&queue.length&&performance.now()-started<4&&(!deadline?.timeRemaining||deadline.timeRemaining()>1));
    }finally{running=false;resume();}
  }
  return {enqueue(resources){if(disposed||!resources)return;const valid=resources.valid||(()=>true);
      for(let i=queue.length-1;i>=0;i--)if(!queue[i].valid()){for(const object of queue[i].objects)queued.delete(object);queue.splice(i,1);skipped++;}
      for(const [texture,list]of [[false,resources.objects||[]],[true,resources.textures||[]]]){
        const objects=[...new Set(list)].filter(object=>object&&!done.has(object)&&!queued.has(object));
        for(const batch of texture?objects.map(object=>[object]):objects.length?[objects]:[]){if(queue.length>=capacity){skipped++;continue;}for(const object of batch)queued.add(object);queue.push({objects:batch,texture,valid});}
      }
      peak=Math.max(peak,queue.length);resume();},resume,
    diagnostics:()=>({queued:queue.length,running,uploaded,compiled,skipped,errors,peak,capacity}),
    dispose(){if(disposed)return;disposed=true;if(scheduled!==null)cancel(scheduled);scheduled=null;queue.length=0;},
  };
}
