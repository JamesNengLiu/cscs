export const PITCH_LIMIT=89*Math.PI/180;
// GoldSrc zoom values describe horizontal FOV at 4:3. Widescreen expands horizontally.
export function verticalFov(fov,aspect=4/3){
  const horizontal=Math.max(10,Math.min(90,Number(fov)||90));
  return 2*Math.atan(Math.tan(horizontal*Math.PI/360)/Math.min(4/3,Math.max(.25,aspect)))*180/Math.PI;
}
