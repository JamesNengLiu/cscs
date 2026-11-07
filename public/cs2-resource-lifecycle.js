// Call only for an owned clone/tree. Shallow SkinnedMesh warm representatives
// borrow their source skeleton; those dispose ONLY their own instance buffers.
export function disposeOwnedSkeletons(root,seen=new Set()){
 root?.traverse?.(object=>{const skeleton=object.isSkinnedMesh&&object.skeleton;if(skeleton&&!seen.has(skeleton)){seen.add(skeleton);skeleton.dispose();}});return seen;
}
export function disposeTemporaryInstances(objects){for(const object of objects)if(object.isInstancedMesh)object.dispose();}
