// The exporter scales only the channel selected by the compiled lightmap
// signature. Keep this evidence instead of inferring a channel from its number.
export function identifyLightmapCoordinate(current,original,scale=1.14283965){
 const matches=[];
 for(const [name,attribute]of Object.entries(current)){
  if(!name.startsWith('TEXCOORD_')||attribute.width!==2)continue;
  const prior=original[name];if(!prior||prior.count!==attribute.count)throw Error('UV reference coverage mismatch');
  let changed=false,scaled=true;
  for(let i=0;i<Math.min(16,attribute.count);i++)for(let k=0;k<2;k++){
   const a=prior.get(i,k),b=attribute.get(i,k);changed ||= Math.abs(a-b)>1e-5;scaled &&= Math.abs(a*scale-b)<2e-6;
  }
  if(changed&&scaled)matches.push(name);
 }
 if(matches.length>1)throw Error('Ambiguous authored lightmap channel');
 return matches[0]??null;
}
export function textureCoordinateName(flags){return flags.F_FORCE_UV2===1?'TEXCOORD_1':'TEXCOORD_0';}
