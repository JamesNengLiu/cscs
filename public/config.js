import {GUNS} from './arsenal.js';
import {ECONOMY} from './economy.js';
// Horizontal movement/recoil remain prototype tuning; jump/duck references: docs/cs16-sources.md.
// Hull dimensions follow BSP's original 32x32x72 / 32x32x36 hulls at 40 units per browser unit.
export const RULES=Object.freeze({tick:60,maxPlayers:10,teamSize:5,radius:.4,eye:1.6,
  speed:5,walkSpeed:2.8,crouchSpeed:2.1,groundAcceleration:38,brake:20,counterBrake:52,
  airAcceleration:7,gravity:800/40,jumpSpeed:Math.sqrt(2*800*45)/40,stepHeight:.45,bodyHeight:1.8,crouchHeight:.9,
  freezeSeconds:ECONOMY.freezeSeconds,roundSeconds:ECONOMY.roundSeconds,bombSeconds:ECONOMY.bombSeconds,plantSeconds:3,defuseSeconds:ECONOMY.defuseSeconds,defuseKitSeconds:ECONOMY.defuseKitSeconds});
export const WEAPONS=Object.freeze({
  rifle:{name:'步枪 · 原型调校',clip:30,reserve:90,interval:.11,damage:34,head:2.8,reload:2.2,spread:.0025,moveSpread:.034,airSpread:.075,heatSpread:.0014,recovery:.22},
  sniper:{name:'狙击步枪',clip:5,reserve:20,interval:1.25,damage:100,head:2,reload:3,spread:.001,moveSpread:.065,airSpread:.12,heatSpread:.001,recovery:.4},
  pistol:{name:'手枪',clip:12,reserve:48,interval:.25,damage:24,head:3,reload:1.5,spread:.006,moveSpread:.025,airSpread:.06,heatSpread:.001,recovery:.18},
  ...GUNS,
  ...Object.fromEntries([['knife','Knife',3],['hegrenade','HE Grenade',4],['flashbang','Flashbang',4],['smokegrenade','Smoke Grenade',4],['c4','C4',5]].map(([id,name,slot])=>[id,{id,name,slot,clip:0,reserve:0,interval:.4,damage:0,head:1,reload:0,spread:0,moveSpread:0,airSpread:0,heatSpread:0,recovery:.2,maxSpeed:id==='c4'?250:250}]))
});
// Repeatable rise and lateral drift make short bursts and manual compensation testable.
// Values are yaw/pitch radians, NOT an original Counter-Strike recoil pattern.
export const RIFLE_PATTERN=[
  [0,0],[.001,.005],[-.002,.012],[.003,.021],[.005,.032],[.008,.044],[.012,.055],
  [.018,.065],[.025,.073],[.031,.08],[.035,.085],[.032,.09],[.024,.094],
  [.013,.097],[0,.1],[-.012,.103],[-.024,.105],[-.034,.107],[-.039,.109],
  [-.035,.111],[-.024,.113],[-.01,.115],[.007,.117],[.024,.119],[.036,.12],
  [.041,.12],[.032,.121],[.016,.121],[-.003,.122],[-.02,.122]
];
