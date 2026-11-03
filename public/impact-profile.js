// Original presentation recipes. Never change the authoritative impact/ray.
const profiles={
 concrete:{kind:'stone',dust:5,chips:8,sparks:0,tint:0xb9a589,shape:[1,.65,.4]},
 wood:{kind:'wood',dust:3,chips:10,sparks:0,tint:0x91704b,shape:[1.8,.22,.25]},
 metal:{kind:'metal',dust:0,chips:3,sparks:8,tint:0x8b9093,shape:[.7,.5,.35]},
 glass:{kind:'glass',dust:1,chips:12,sparks:0,tint:0xa9c1c3,shape:[1.5,.7,.13]},
 dirt:{kind:'dirt',dust:7,chips:5,sparks:0,tint:0x938068,shape:[.7,.7,.6]}
};
for(const p of Object.values(profiles)){Object.freeze(p.shape);Object.freeze(p);}
export function impactProfile(material){return profiles[material==='vent'||material==='grate'?'metal':material==='tile'?'concrete':material==='computer'?'glass':material]||profiles.concrete;}
export function cosmeticRandom(identity){let seed=2166136261;for(const c of String(identity).slice(0,256))seed=Math.imul(seed^c.charCodeAt(0),16777619);return ()=>{seed=Math.imul(seed,1664525)+1013904223|0;return (seed>>>0)/4294967296;};}
