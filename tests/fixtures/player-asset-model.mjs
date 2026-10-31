// Small original numerical fixture; no imported geometry or animation content.
export const FIXTURE_PLAYER_SHA='a'.repeat(64);
export function playerAssetFixture(id='terror'){
 const tracks=(offset=0)=>[[{values:[-32768,offset,32767],positionHold:[0]},null,null,null,null,{values:[0,1,2]}],[null,null,null,null,null,null]];
 const blends=Array.from({length:9},(_,i)=>tracks(i));
 return {schema:'goldsrc-player-v1',metadata:{id,source:'original-mdl',sourceSHA256:FIXTURE_PLAYER_SHA},bones:[{name:'Bip01',parent:-1,value:[0,0,0,0,0,0],scale:[.001,1,1,1,1,.1],controllers:[-1,-1,-1,-1,-1,-1]},{name:'Bip01 Head',parent:0,value:[0,0,40,0,0,0],scale:[1,1,1,1,1,1],controllers:[-1,-1,-1,-1,-1,-1]}],controllers:[],textures:[{file:'texture-0.png',width:2,height:2,flags:0}],skins:[[0]],bodyparts:[{base:1,models:[{}]}],attachments:[{bone:1,origin:[1,2,3]}],meshes:[{bodypart:0,model:0,skinref:0,positions:[.123456789012345,0,-36,40,40,-36,40,0,4],normals:[1,0,0,1,0,0,1,0,0],vertexBones:[0,1,1],normalBones:[0,1,1],uvPixels:[0,0,2,0,0,2],indices:[0,1,2]}],sequences:[{name:'ref_aim_ak47',fps:30,flags:1,frames:3,blendCount:9,tracks:structuredClone(blends[0]),blendTracks:blends},{name:'jump',fps:30,flags:0,frames:3,blendCount:1,tracks:tracks()}]};
}
