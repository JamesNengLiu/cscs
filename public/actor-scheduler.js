// Conservative view-frustum presentation scheduling only. Logical actor state,
// world position, audio and server/historical hitboxes continue at full cadence.
export function createActorScheduler(THREE){
 const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),sphere=new THREE.Sphere(new THREE.Vector3(),3);let visible=0,deferred=0,frames=0;
 return {
  begin(camera){camera.updateMatrixWorld();matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);visible=deferred=0;frames++;},
  shouldPose(player){if(!player||![player.x,player.y,player.z].every(Number.isFinite)){visible++;return true;}sphere.center.set(player.x,player.y+1,player.z);const show=frustum.intersectsSphere(sphere);if(show)visible++;else deferred++;return show;},
  diagnostics:()=>({visible,deferred,frames,safetyRadius:3,scope:'View-frustum render work only; no wall/visibility rays or audio suppression'})
 };
}
