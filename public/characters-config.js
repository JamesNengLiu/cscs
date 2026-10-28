// Cosmetic presets only. Team, money, hitboxes and weapon rules do not depend on appearance.
const teams={T:['terror','leet','arctic','guerilla'],CT:['urban','gsg9','sas','gign']};
export const CHARACTER_PRESETS=Object.freeze([
  ...teams.T.map(base=>Object.freeze({id:base+'_trump',base,team:'T',face:'trump',label:`T · ${base} / 特朗普面部（自定义）`})),
  ...Object.entries(teams).flatMap(([team,ids])=>ids.map(base=>Object.freeze({id:base,base,team,face:'original',label:`${team} · ${base} / CS 原版人物`})))
]);
export const CHARACTER_BY_ID=Object.freeze(Object.assign(Object.create(null),Object.fromEntries(CHARACTER_PRESETS.map(p=>[p.id,p]))));
export const DEFAULT_CHARACTER=Object.freeze({T:'terror_trump',CT:'urban'});
export function selectCharacter(team,id){return typeof id==='string'&&Object.hasOwn(CHARACTER_BY_ID,id)&&CHARACTER_BY_ID[id].team===team?id:DEFAULT_CHARACTER[team];}
