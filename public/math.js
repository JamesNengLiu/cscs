export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function direction(yaw,pitch){return {x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)};}
export function rayBox(o,d,b){let lo=0,hi=200;for(const k of ['x','y','z']){
  if(Math.abs(d[k])<1e-9){if(o[k]<b[k+'1']||o[k]>b[k+'2'])return Infinity;}
  else {let a=(b[k+'1']-o[k])/d[k],c=(b[k+'2']-o[k])/d[k];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(lo>hi)return Infinity;}}
  return lo;
}
export function rayTriangle(o,d,t){const [a,b,c]=t,ex=b[0]-a[0],ey=b[1]-a[1],ez=b[2]-a[2],fx=c[0]-a[0],fy=c[1]-a[1],fz=c[2]-a[2];
  const px=d.y*fz-d.z*fy,py=d.z*fx-d.x*fz,pz=d.x*fy-d.y*fx,det=ex*px+ey*py+ez*pz;
  if(Math.abs(det)<1e-9)return Infinity;const inv=1/det,tx=o.x-a[0],ty=o.y-a[1],tz=o.z-a[2],u=(tx*px+ty*py+tz*pz)*inv;if(u<0||u>1)return Infinity;
  const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,v=(d.x*qx+d.y*qy+d.z*qz)*inv;if(v<0||u+v>1)return Infinity;
  const hit=(fx*qx+fy*qy+fz*qz)*inv;return hit>=.00001&&hit<=200?hit:Infinity;
}
