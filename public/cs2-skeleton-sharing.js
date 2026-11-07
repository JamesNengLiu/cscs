// SkeletonUtils clones a palette for every SkinnedMesh, even when meshes in
// one owned model use the exact same bones and inverse binds. Share only those
// identical palettes; each mesh retains its own bind matrices and geometry.
export function shareSkeletonPalettes(root){
 const palettes=[],replacements=new Map();let meshes=0,merged=0;
 const identical=(a,b)=>a.constructor===b.constructor&&a.bones.length===b.bones.length&&a.bones.every((bone,i)=>bone===b.bones[i]&&a.boneInverses[i].equals(b.boneInverses[i]));
 root.traverse(object=>{
  if(!object.isSkinnedMesh)return;const skeleton=object.skeleton;
  if(!skeleton?.bones?.length||skeleton.boneInverses?.length!==skeleton.bones.length)return;
  meshes++;if(replacements.has(skeleton)){object.skeleton=replacements.get(skeleton);return;}
  const shared=palettes.find(other=>identical(skeleton,other));
  if(shared){replacements.set(skeleton,shared);object.skeleton=shared;skeleton.dispose();merged++;}
  else{palettes.push(skeleton);replacements.set(skeleton,skeleton);}
 });
 return{meshes,palettes:palettes.length,merged};
}
