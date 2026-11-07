// CPU world composition for the isolated walk experiment. Renderer/PVS and
// networking do not participate in collision, triggers or spawn selection.
import {createCollisionWorld} from './cs2-collision.js';
import {createMovement,LEGACY_METER_MOVEMENT_PROFILE} from './cs2-movement.js';
import {createWorldContract,sourceAnglesToView,sourcePointToMeters} from './experimental-world-contract.js';

export const PINNED_CS2_MAP_SHA1='7dc529cd65d843a2b8a98c297e79b9923dd70a5d';
const finiteVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const teams=['T','CT'];

export function createExperimentalWorld(data,{packageManifest,renderManifest,verifiedPhysicsSHA256,movementProfile=LEGACY_METER_MOVEMENT_PROFILE}={}){
 if(data?.schema!=='cs2-physics-v1'||data.units!=='metres'||packageManifest?.schema!=='cs2-physics-package-v1')throw Error('Experimental physics schema mismatch');
 const source=data.source?.mapSHA1;
 if(source!==PINNED_CS2_MAP_SHA1||packageManifest.mapSHA1!==source||renderManifest?.source?.mapSHA1!==source)throw Error('Experimental map source mismatch');
 if(data.source.coordinateMapping!==undefined&&data.source.coordinateMapping!=='(SourceY,SourceZ,SourceX)*.0254')throw Error('Experimental coordinate mapping mismatch');
 if(verifiedPhysicsSHA256!==undefined&&verifiedPhysicsSHA256!==packageManifest.sha256)throw Error('Experimental collision integrity mismatch');
 for(const [key,actual]of [['shapes',data.shapes?.length],['triggers',data.triggers?.length]])if(packageManifest[key]!==undefined&&packageManifest[key]!==actual)throw Error('Experimental package coverage mismatch: '+key);
 if(!movementProfile||movementProfile.units!=='metres'||!movementProfile.rules||!movementProfile.weapons)throw Error('Invalid experimental movement profile');
 const contract=createWorldContract({sourceSHA1:source,collisionSHA256:packageManifest.sha256,rulesVersion:movementProfile.id});
 const rules=movementProfile.rules,collision=createCollisionWorld(data,{radius:rules.radius,bodyHeight:rules.bodyHeight,crouchHeight:rules.crouchHeight,trustedCompiled:Boolean(data.compiledCollision&&verifiedPhysicsSHA256===packageManifest.sha256)}),movement=createMovement(collision,{rules,weapons:movementProfile.weapons,rulesVersion:movementProfile.id,profile:movementProfile});
 const spawns={};
 for(const team of teams){
  const originals=data.spawns?.[team];if(!Array.isArray(originals)||!originals.length||originals.length>128)throw Error('Experimental spawn coverage mismatch: '+team);
  if(packageManifest.spawns?.[team]!==undefined&&packageManifest.spawns[team]!==originals.length)throw Error('Experimental package spawn mismatch');
  spawns[team]=Object.freeze(originals.map((spawn,index)=>{
   if(!finiteVector(spawn.position)||!finiteVector(spawn.sourceOrigin)||!finiteVector(spawn.sourceAngles))throw Error('Invalid authored spawn: '+team+index);
   const original=sourcePointToMeters(spawn.sourceOrigin);if(spawn.position.some((v,k)=>Math.abs(v-original[['x','y','z'][k]])>1e-6))throw Error('Authored spawn coordinate mismatch');
   return Object.freeze({...spawn,position:Object.freeze([...spawn.position]),sourceOrigin:Object.freeze([...spawn.sourceOrigin]),sourceAngles:Object.freeze([...spawn.sourceAngles])});
  }));
 }
 Object.freeze(spawns);
 const triggers=(data.triggers||[]).map(trigger=>{
  if(!['bombsite','buyzone'].includes(trigger.kind)||trigger.kind==='bombsite'&&!['A','B'].includes(trigger.name)||trigger.team!==null&&!teams.includes(trigger.team)||!Array.isArray(trigger.shapes)||!trigger.shapes.length)throw Error('Invalid authored trigger');
  if(trigger.shapes.some(s=>!Array.isArray(s.channels)||s.channels.length))throw Error('Trigger must not join solid collision channels');
  return {descriptor:Object.freeze({id:trigger.id,kind:trigger.kind,name:trigger.name,team:trigger.team}),world:createCollisionWorld({schema:'cs2-physics-v1',units:'metres',materials:trigger.materials||[],shapes:trigger.shapes},{radius:rules.radius,bodyHeight:rules.bodyHeight,crouchHeight:rules.crouchHeight})};
 });
 function atTrigger(player,kind){if(!player||!['x','y','z'].every(k=>Number.isFinite(player[k])))return null;for(const trigger of triggers){if(trigger.descriptor.kind!==kind)continue;const hit=trigger.world.trace(player,player,movement.bodyHeight(player),{radius:rules.radius,channel:'all'});if(hit.startSolid)return trigger.descriptor;}return null;}
 function siteAt(player){return atTrigger(player,'bombsite');}
 function buyZoneAt(player,team=player?.team){if(!teams.includes(team))return false;for(const trigger of triggers){if(trigger.descriptor.kind!=='buyzone'||trigger.descriptor.team!==null&&trigger.descriptor.team!==team)continue;if(!player||!['x','y','z'].every(k=>Number.isFinite(player[k])))return false;if(trigger.world.trace(player,player,movement.bodyHeight(player),{radius:rules.radius,channel:'all'}).startSolid)return true;}return false;}
 function resolveSpawn(team,index=0,{crouch=false}={}){
  if(!teams.includes(team)||!Number.isInteger(index)||index<0||index>=spawns[team].length)throw Error('Invalid experimental spawn selection');
  const authored=spawns[team][index],anchor={x:authored.position[0],y:authored.position[1],z:authored.position[2]},height=movement.bodyHeight({crouch}),pointOptions={radius:0,channel:'player'},anchorPoint=collision.trace(anchor,anchor,0,pointOptions),reasons=[];
  for(const lift of [0,.05,.15,.3,.5]){
   const start={...anchor,y:anchor.y+lift};
   if(collision.collides(start.x,start.z,rules.radius,start.y,height)){reasons.push('blocked-body@'+lift);continue;}
   // Lifting a feet anchor must not move it through a different roof/slab.
   // A small authored ground overlap may escape its own initial solid only.
   if(lift>0){
    const path=anchorPoint.startSolid?collision.trace(start,anchor,0,pointOptions):collision.trace(anchor,start,0,pointOptions);
    if(path.startSolid||path.fraction<1&&(!anchorPoint.startSolid||path.shape!==anchorPoint.shape)){reasons.push('blocked-lift@'+lift);continue;}
   }
   const hit=collision.findSupport(start.x,start.z,start.y,{height,radius:rules.radius});
   if(!hit){reasons.push('no-support@'+lift);continue;}
   const adjustment=hit.end.y-anchor.y;
   if(adjustment< -1.8||adjustment>.5+.002){reasons.push('outside-anchor-range@'+lift);continue;}
   if(collision.collides(hit.end.x,hit.end.z,rules.radius,hit.end.y,height)){reasons.push('blocked-support@'+lift);continue;}
   return {x:hit.end.x,y:hit.end.y,z:hit.end.z,...sourceAnglesToView(authored.sourceAngles),team,crouch,grounded:true,sourceId:authored.sourceId,spawnIndex:index,anchor:{...anchor},adjustment:{x:0,y:adjustment,z:0,probeLift:lift},support:hit};
  }
  throw Error(`No safe authored ${team} spawn ${index}: ${reasons.join(', ')}`);
 }
 return Object.freeze({collision,movement,movementProfile:movement.profile,contract,spawns,siteAt,buyZoneAt,resolveSpawn,integrityVerified:verifiedPhysicsSHA256===packageManifest.sha256});
}
