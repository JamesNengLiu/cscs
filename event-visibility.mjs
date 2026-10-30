// Route sound audiences server-side; filtering in a browser is not privacy/security.
const PERSONAL=new Set(['money','purchase','flash','damage']);
export function eventVisibleTo(event,player){
  if(!event||typeof event!=='object')return false;
  if((event.private||PERSONAL.has(event.type))&&event.id!==player?.id)return false;
  if(event.type==='sound'){
    if(event.exceptId&&event.exceptId===player?.id)return false;
    if(event.team&&event.team!==player?.team)return false;
  }
  return true;
}
