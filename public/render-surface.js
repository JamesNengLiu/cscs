// Keep the allocated WebGL backbuffer during automatic scale changes. Rendering
// uses its lower-left viewport; the fixed, clipped canvas maps that viewport to
// the same CSS screen rectangle. No copy pass, extra texture or render target.
export function createRenderSurface(renderer,canvas,{width,height,ratio}){
  let w=Math.max(1,Math.floor(width)),h=Math.max(1,Math.floor(height)),capacity=ratio,scale=ratio;
  const style=canvas.style;Object.assign(style,{position:'fixed',left:'0px',bottom:'0px',top:'auto'});
  function apply(){
    const vw=Math.max(1,Math.floor(w*scale)),vh=Math.max(1,Math.floor(h*scale));
    renderer.setViewport(0,0,vw/capacity,vh/capacity);
    renderer.setScissor(0,0,vw/capacity,vh/capacity);renderer.setScissorTest(true);
    style.width=`${w*canvas.width/vw}px`;style.height=`${h*canvas.height/vh}px`;
    canvas.dataset.renderRatio=String(scale);
  }
  renderer.setPixelRatio(capacity);renderer.setSize(w,h,false);apply();
  return {
    get ratio(){return scale;},get capacityRatio(){return capacity;},
    setRatio(value,{allowGrowth=false}={}){
      if(!Number.isFinite(value)||value<=0)return false;
      if(value>capacity){if(!allowGrowth)return false;capacity=value;renderer.setPixelRatio(capacity);}
      if(value===scale)return false;scale=value;apply();return true;
    },
    resize(width,height){w=Math.max(1,Math.floor(width));h=Math.max(1,Math.floor(height));renderer.setSize(w,h,false);apply();},
    diagnostics:()=>({ratio:scale,capacityRatio:capacity,viewport:{width:Math.max(1,Math.floor(w*scale)),height:Math.max(1,Math.floor(h*scale))},backbuffer:{width:canvas.width,height:canvas.height},scope:'Viewport scaling with a reused backbuffer; DOM HUD and camera aspect stay in CSS screen coordinates'})
  };
}
