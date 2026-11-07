// Project classic framing, using the public Source 4:3-horizontal FOV and
// right/forward/up offset conventions. No world aiming or simulation writes.
import {verticalFov} from './view-settings.js';
export const CLASSIC_VIEWMODEL_PROFILE=Object.freeze({id:'classic-browser-v1',fov:68,near:.0254,far:10,right:2.5,forward:0,up:-1.5,metresPerSourceUnit:.0254});
export function viewmodelVerticalFov(aspect,{profile=CLASSIC_VIEWMODEL_PROFILE,adsAmount=0,adsFov=profile.fov}={}){
 const t=Math.max(0,Math.min(1,Number(adsAmount)||0)),fov=profile.fov+(adsFov-profile.fov)*t;return verticalFov(fov,aspect);
}
export function createViewmodelCamera(THREE,worldCamera,{profile=CLASSIC_VIEWMODEL_PROFILE}={}){
 const camera=new THREE.PerspectiveCamera(viewmodelVerticalFov(worldCamera.aspect,{profile}),worldCamera.aspect,profile.near,profile.far);camera.name='cs2-native-viewmodel-camera';camera.layers.set(1);worldCamera.add(camera);
 return{camera,sync({adsAmount=0,adsFov=profile.fov}={}){const fov=viewmodelVerticalFov(worldCamera.aspect,{profile,adsAmount,adsFov});if(camera.aspect!==worldCamera.aspect||camera.fov!==fov){camera.aspect=worldCamera.aspect;camera.fov=fov;camera.updateProjectionMatrix();}camera.updateWorldMatrix(true,false);},diagnostics:()=>({profile:profile.id,fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,matrix:camera.projectionMatrix.elements.slice(),referenceHorizontalFov:profile.fov,offsetSourceUnits:{right:profile.right,forward:profile.forward,up:profile.up}})};
}
export function applyClassicViewmodelPose(group,{hand='right',motion={},adsAmount=0,profile=CLASSIC_VIEWMODEL_PROFILE}={}){
 const side=hand==='left'?-1:1,weight=1-Math.max(0,Math.min(1,adsAmount)),unit=profile.metresPerSourceUnit;
 // The legacy outer origin cancels the native content's fixed basis only;
 // presentation offsets move both hands and the gun as one assembly.
 group.scale.x=side;group.position.set(side*(.25+profile.right*unit*weight+(motion.side||0)),-.24+profile.up*unit*weight+(motion.y||0),-.42-profile.forward*unit*weight);group.rotation.x=0;group.rotation.z=motion.roll||0;
}
export function formatViewmodelAttachment(point,worldCamera,viewmodelCamera,target){
 target.copy(point);worldCamera.worldToLocal(target);const world=worldCamera.projectionMatrix.elements,view=viewmodelCamera.projectionMatrix.elements;target.x*=view[0]/world[0];target.y*=view[5]/world[5];return worldCamera.localToWorld(target);
}
