// Shared recoil stream only. World bullet spread and hit decisions remain server-owned.
export function recoilRandom(seed,ordinal,weapon,fallback=Math.random){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||!Number.isSafeInteger(ordinal)||ordinal<1)return fallback;
  let word=(seed^Math.imul(ordinal,0x9e3779b9))>>>0;
  for(const c of String(weapon))word=Math.imul(word^c.charCodeAt(0),16777619)>>>0;
  return ()=>{word=(word+0x6d2b79f5)>>>0;let x=Math.imul(word^(word>>>15),word|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};
}
