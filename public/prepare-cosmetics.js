// Begin preparing optional resources before connection, without awaiting/gating
// inputs. New cosmetics stay hidden if the driver has not finished compiling.
export async function prepareCosmetics(THREE,renderer,camera,scene,{objects=[],textures=[]}={}){
 try{
  const group=new THREE.Group(),view=camera.clone(false);view.layers.enableAll();
  for(const texture of textures)renderer.initTexture(texture);
  for(const source of objects){const object=source.clone(true);object.visible=true;object.frustumCulled=false;if(object.isInstancedMesh)object.count=Math.max(1,object.count);group.add(object);}
  await renderer.compileAsync(group,view,scene);return true;
 }catch{return false;}
}
