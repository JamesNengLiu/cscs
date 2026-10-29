import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrenade, stepGrenades, GRENADE_LIMITS} from '../grenades.mjs';
import {trace, supportHeight, collides, eyeHeight, bodyHeight} from '../public/shared.js';
import {flashOpacity} from '../public/effects.js';

// Fixtures are in the shipped BSP's B courtyard, not a mocked infinite floor.
function player(id, team='CT', x=-38, z=-56, extra={}) {
  const p = {id,team,x,z,y:supportHeight(x,z,3),yaw:Math.PI/2,pitch:0,vx:0,vy:0,vz:0,
    alive:true,hp:100,armour:0,helmet:false,flashUntil:0,flashAmount:0,crouch:false,...extra};
  assert.equal(collides(p.x,p.z,.4,p.y,bodyHeight(p)),false,`valid BSP player ${id}`);
  return p;
}
const owner = () => player('owner','T',-50,-53);
function game(...players) {
  return {time:0,players:new Map(players.map(p => [p.id,p])),projectiles:[],smokes:[],events:[],hits:[],
    emit(e) { this.events.push({...e,time:this.time}); },
    damage(p,amount,killer,options) { this.hits.push({p,amount,killer,options}); }};
}
function tick(g, dt=1/60) { g.time+=dt; stepGrenades(g,dt); }
function advance(g, seconds, hz=120) {
  const end=g.time+seconds;
  while(g.time<end-1e-9) tick(g,Math.min(1/hz,end-g.time));
}
function placed(g, kind, at, extra={}) {
  const p=createGrenade(g.players.get('owner'),kind,g.time);
  assert.ok(p);
  Object.assign(p,at,{vx:0,vy:0,vz:0},extra);
  assert.equal(trace(p,p).startSolid,false,'grenade fixture is in empty BSP space');
  g.projectiles.push(p);
  return p;
}
function detonate(g, kind, at) {
  placed(g,kind,at,{detonateAt:g.time});
  stepGrenades(g,0);
  return g.events.find(e => e.type==='explosion');
}
const blast={x:-40,y:.9,z:-56};

test('throw: unique server ids, eye clearance, original angle/speed, inherited velocity and fuse', () => {
  const p=player('owner','T',-40,-56,{yaw:0});
  const a=createGrenade(p,'hegrenade',12), b=createGrenade(p,'flashbang',12);
  assert.notEqual(a.id,b.id);
  assert.equal(a.ownerId,p.id); assert.equal(a.team,'T'); assert.equal(a.detonateAt,13.5);
  assert.ok(Math.abs(Math.hypot(a.vx,a.vy,a.vz)-600/40)<1e-10);
  assert.ok(Math.abs(a.vy-Math.sin(Math.PI/18)*15)<1e-10);
  assert.ok(Math.abs(a.z-(p.z-Math.cos(Math.PI/18)*.4))<1e-10);
  assert.ok(Math.abs(a.y-(p.y+eyeHeight(p)+Math.sin(Math.PI/18)*.4))<1e-10);
  const moving=createGrenade({...p,vx:2,vy:1,vz:3},'hegrenade',12);
  assert.equal(moving.vx-a.vx,2); assert.equal(moving.vy-a.vy,1); assert.equal(moving.vz-a.vz,3);
  const up=createGrenade({...p,pitch:Math.PI/2},'hegrenade',0);
  assert.ok(Math.abs(up.vy-750/40)<1e-10);
  const secondary=createGrenade(p,'hegrenade',12,true);
  assert.deepEqual([secondary.vx,secondary.vy,secondary.vz],[a.vx,a.vy,a.vz]);
});

test('throw: safe against original object brush and crouched eye uses shared height', () => {
  const p=player('owner','T',-42.001,-63.6,{yaw:-Math.PI/2});
  for(const crouch of [false,true]) {
    p.crouch=crouch;
    const q=createGrenade(p,'smokegrenade',0);
    const eye={x:p.x,y:p.y+eyeHeight(p),z:p.z};
    assert.ok(q); assert.equal(trace(eye,q).fraction,1); assert.equal(trace(q,q).startSolid,false);
    assert.ok(q.x < -41.6);
  }
});

test('HE: radial falloff, radius cutoff, self damage, friendly fire off and armour callback', () => {
  const self=player('owner','T',-40,-53), near=player('near'), far=player('far','CT',-34,-56);
  const outside=player('outside','CT',-29,-56), ally=player('ally','T',-40,-49);
  const g=game(self,near,far,outside,ally);
  near.armour=100; near.helmet=true;
  detonate(g,'hegrenade',blast);
  assert.deepEqual(g.hits.map(h=>h.p.id).sort(),['far','near','owner']);
  const n=g.hits.find(h=>h.p===near), f=g.hits.find(h=>h.p===far);
  assert.ok(n.amount>f.amount && f.amount>0);
  const d=Math.hypot(near.x-blast.x,near.y+bodyHeight(near)/2-(blast.y+.025),near.z-blast.z);
  assert.ok(Math.abs(n.amount-100*(1-d/(350/40)))<1e-9);
  assert.deepEqual(n.options,{kind:'hegrenade',hitgroup:'chest',blast:true,armourRatio:1});
  assert.equal(n.killer,self);
  // Recording callback intentionally does not apply damage: module must not bypass it.
  assert.equal(near.hp,100); assert.equal(near.armour,100); assert.equal(self.hp,100);
  assert.equal(g.projectiles.length,0);
  stepGrenades(g,0); assert.equal(g.events.filter(e=>e.type==='explosion').length,1);
});

test('HE: game damage policy alone applies armour; friendly fire requires explicit true', () => {
  const ally=player('ally','T'), g=game(owner(),ally);
  g.friendlyFire=true;
  ally.armour=100;
  g.damage=function(p,amount,killer,options) {
    this.hits.push({p,amount,killer,options});
    p.hp-=amount*.5; p.armour-=amount*.25;
  };
  detonate(g,'hegrenade',blast);
  assert.equal(g.hits.length,1);
  assert.equal(ally.hp,100-g.hits[0].amount*.5);
  assert.equal(ally.armour,100-g.hits[0].amount*.25);
});

for (const [name,at,target,model] of [
  ['breakable brush',{x:-42.4,y:1,z:-63.6},[-39.2,-63.6],31],
  ['world wall',{x:-47,y:1.7,z:-59},[-41,-59],0],
]) {
  for(const kind of ['hegrenade','flashbang']) test(`${kind}: ${name} occludes the effect`, () => {
    const p=player('target','CT',...target), g=game(owner(),p);
    const hit=trace(at,{x:p.x,y:p.y+(kind==='flashbang'?eyeHeight(p):bodyHeight(p)/2),z:p.z});
    assert.equal(hit.model,model); assert.ok(hit.fraction<1);
    detonate(g,kind,at);
    assert.ok(!g.hits.some(h=>h.p===p));
    assert.equal(p.flashAmount,0); assert.equal(p.flashUntil,0);
    assert.ok(!g.events.some(e=>e.type==='flash' && e.id===p.id));
  });
}

function flashAt(target, at={x:-40,y:1.6,z:-56}) {
  const g=game(owner(),target); g.time=10;
  detonate(g,'flashbang',at);
  return {g,event:g.events.find(e=>e.type==='flash' && e.id===target.id)};
}
test('flash: front/back facing and distance affect exposure, using server expiry time', () => {
  const front=flashAt(player('front')), back=flashAt(player('back','CT',-38,-56,{yaw:-Math.PI/2}));
  const far=flashAt(player('far','CT',-34,-56));
  assert.ok(front.event && back.event && far.event);
  assert.equal(front.event.amount,1); assert.equal(back.event.amount,200/255);
  assert.ok(front.event.duration>back.event.duration);
  assert.ok(front.event.duration>far.event.duration);
  assert.ok(front.event.fade>far.event.fade);
  assert.equal(front.g.players.get('front').flashUntil,10+front.event.duration);
  assert.ok(front.event.duration<=4);assert.ok(back.event.duration<=1.5);
  assert.ok(front.event.duration-front.event.fade<=1);
  assert.equal(front.g.players.get('front').flashFade,front.event.fade);
  const until=10+front.event.duration;
  assert.equal(flashOpacity(until,1,10+.4,front.event.fade),1);
  assert.ok(flashOpacity(until,1,12,front.event.fade)<.8);
  const p=front.g.players.get('front');
  front.g.time=p.flashUntil; stepGrenades(front.g,0);
  assert.equal(p.flashAmount,0); assert.equal(p.flashUntil,0);assert.equal(p.flashFade,0);
});

test('flash: full pitch determines facing and outside radius has no effect', () => {
  const high={x:-38,y:6,z:-56};
  const up=flashAt(player('up','CT',-38,-56,{pitch:Math.PI/2}),high);
  const down=flashAt(player('down','CT',-38,-56,{pitch:-Math.PI/2}),high);
  assert.equal(up.event.amount,1); assert.equal(down.event.amount,200/255);
  const outside=flashAt(player('outside'),{x:0,y:10,z:-56});
  assert.equal(outside.event,undefined);
});

test('flash: owner and allies are affected regardless of friendly fire; events are private and minimal', () => {
  const self=player('owner','T',-40,-56,{yaw:-Math.PI/2}), ally=player('ally','T',-38,-53,{yaw:0});
  const g=game(self,ally); g.time=7;
  detonate(g,'flashbang',{x:-38,y:1.6,z:-56});
  assert.ok(self.flashAmount>0 && ally.flashAmount>0);
  const flashes=g.events.filter(e=>e.type==='flash');
  assert.deepEqual(flashes.map(e=>e.id).sort(),['ally','owner']);
  for(const e of flashes) {
    assert.equal(e.private,true);
    assert.deepEqual(Object.keys(e).sort(),['amount','duration','fade','id','private','time','type']);
  }
  for(const e of g.events) assert.ok(Object.values(e).every(v=>v===null || typeof v!=='object'));
});

test('flash: intervening authoritative player hull occludes; dead bodies do not', () => {
  const target=player('target','CT',-34,-56), blocker=player('blocker','T',-38,-56), g=game(owner(),target,blocker);
  detonate(g,'flashbang',{x:-40,y:1.6,z:-56});
  assert.equal(target.flashUntil,0);
  blocker.alive=false;
  detonate(g,'flashbang',{x:-40,y:1.6,z:-56});
  assert.ok(target.flashUntil>0);
});

test('flash: weak later flash never shortens active expiry or lowers amount', () => {
  const target=player('target'), {g}=flashAt(target);
  const until=target.flashUntil;
  g.time+=1; target.yaw=-Math.PI/2;
  detonate(g,'flashbang',{x:-40,y:1.6,z:-56});
  assert.ok(target.flashUntil>=until); assert.equal(target.flashAmount,1);
});

test('physics: swept object brush collision bounces without tunnelling at high speed', () => {
  const g=game(owner()), p=placed(g,'hegrenade',{x:-42.4,y:1.6,z:-63.6},{vx:50});
  tick(g,.03);
  assert.equal(g.projectiles.length,1); assert.ok(p.bounces>0); assert.ok(p.vx<0);
  assert.ok(p.x < -41.6); assert.equal(trace(p,p).startSolid,false);
});

test('physics: swept body collision cannot tunnel; owner is ignored for flight', () => {
  const target=player('body','CT',-40,-56), g=game(owner(),target);
  const p=placed(g,'hegrenade',{x:-42,y:1.2,z:-56},{vx:50});
  tick(g,.08);
  assert.ok(p.bounces>0 && p.vx<0 && p.x < target.x-.4);
  const self=player('owner','T',-40,-56), own=game(self);
  const q=placed(own,'hegrenade',{x:self.x,y:self.y+1.2,z:self.z},{vx:20});
  tick(own,.05);
  assert.equal(own.projectiles.length,1); assert.equal(q.bounces,0); assert.ok(q.x>self.x+.8);
});

test('physics: exact body boundary bounces inward travel and permits outward travel', () => {
  for(const vx of [-10,10]) {
    const target=player('body','CT',-40,-56), g=game(owner(),target);
    const p=placed(g,'hegrenade',{x:target.x-.4,y:1.2,z:target.z},{vx});
    tick(g,1/120);
    assert.equal(g.projectiles.length,1);
    assert.ok(p.vx<0); assert.ok(p.x < target.x-.4);
    assert.equal(p.bounces,vx>0 ? 1 : 0);
  }
});

for(const kind of ['hegrenade','flashbang']) test(`${kind}: fuse bursts in flight exactly once`, () => {
  const g=game(owner());
  placed(g,kind,{x:-40,y:5,z:-56});
  advance(g,1.49);
  assert.equal(g.events.filter(e=>e.type==='explosion'||e.type==='flash').length,0); assert.equal(g.projectiles.length,1);
  advance(g,.01);
  const e=g.events.find(e=>e.type==='explosion');
  assert.ok(e); assert.ok(e.y>0.1); assert.equal(g.projectiles.length,0);
  advance(g,1); assert.equal(g.events.filter(e=>e.type==='explosion').length,1);
});

test('smoke: waits past fuse while airborne, settles, emits bounded volume then expires', () => {
  const g=game(owner()), p=placed(g,'smokegrenade',{x:-40,y:5,z:-56});
  advance(g,1.5);
  assert.equal(g.smokes.length,0); assert.equal(g.projectiles.length,1);
  assert.ok(p.y>.1);
  advance(g,5);
  assert.equal(g.projectiles.length,0); assert.equal(g.smokes.length,1);
  const s=g.smokes[0];
  assert.equal(s.id,p.id); assert.equal(s.radius,GRENADE_LIMITS.smokeRadius);
  assert.equal(s.endAt-s.bornAt,GRENADE_LIMITS.smokeSeconds);
  assert.ok(s.y>=0 && s.y<.1);
  assert.equal(g.events.filter(e=>e.type==='explosion').length,1);
  g.time=s.endAt; stepGrenades(g,0); assert.equal(g.smokes.length,0);
});

test('physics: fixed substeps agree at 30, 60, 120 Hz and repeat calls do not move twice', () => {
  const outcomes=[30,60,120].map(hz=>{
    const g=game(owner()), p=placed(g,'hegrenade',{x:-40,y:5,z:-56},{vx:3,vz:1,vy:2});
    advance(g,.5,hz);
    const before=[p.x,p.y,p.z]; stepGrenades(g,1/hz);
    assert.deepEqual([p.x,p.y,p.z],before);
    return before;
  });
  for(const result of outcomes) result.forEach((v,i)=>assert.ok(Math.abs(v-outcomes[0][i])<1e-9));
});

test('bounds: stale and nonfinite projectiles are discarded, queues capped, huge delta bounded', () => {
  const g=game(owner());
  for(let i=0;i<GRENADE_LIMITS.active+5;i++) placed(g,'smokegrenade',{x:-40,y:5,z:-56});
  stepGrenades(g,0); assert.equal(g.projectiles.length,GRENADE_LIMITS.active);
  g.projectiles[0].vx=Infinity; g.projectiles[1].x=NaN;
  stepGrenades(g,0); assert.equal(g.projectiles.length,GRENADE_LIMITS.active-2);
  g.time=GRENADE_LIMITS.ttl; stepGrenades(g,1e9);
  assert.equal(g.projectiles.length,0); assert.equal(g.smokes.length,0); assert.equal(g.events.length,0);
  const q=placed(g,'smokegrenade',{x:-40,y:5,z:-56},{vx:10});
  g.time+=2; stepGrenades(g,1e9);
  assert.ok(q.x<=-37.5+1e-9); assert.equal(g.smokes.length,0);
  g.smokes=Array.from({length:100},(_,i)=>({id:`s${i}`,x:-40,y:0,z:-56,bornAt:g.time,endAt:g.time+20,radius:4}));
  stepGrenades(g,0); assert.equal(g.smokes.length,GRENADE_LIMITS.smokes);
  g.smokes[0].endAt=Infinity; g.smokes[1].radius=NaN;
  stepGrenades(g,0); assert.equal(g.smokes.length,GRENADE_LIMITS.smokes-2);
});

test('input: reject invalid identity, kind, position or time; sanitize nonfinite aim and velocity', () => {
  const p=owner();
  for(const invalid of [null,{}, {...p,x:NaN},{...p,z:Infinity},{...p,y:1e100},{...p,alive:false},{...p,id:''}]) {
    assert.equal(createGrenade(invalid,'hegrenade',0),null);
  }
  assert.equal(createGrenade(p,'__proto__',0),null);
  for(const now of [NaN,Infinity,-1]) assert.equal(createGrenade(p,'hegrenade',now),null);
  const q=createGrenade({...p,yaw:NaN,pitch:Infinity,vx:NaN,vy:Infinity,vz:-Infinity},'hegrenade',0);
  assert.ok(q); for(const k of ['x','y','z','vx','vy','vz']) assert.ok(Number.isFinite(q[k]));
  const huge=createGrenade({...p,yaw:Number.MAX_VALUE,recoilYaw:Number.MAX_VALUE,vx:Number.MAX_VALUE},'hegrenade',0);
  assert.ok(Number.isFinite(huge.vx)); assert.ok(Math.hypot(huge.vx,huge.vy,huge.vz)<=50+1e-9);
  const g=game(p); g.projectiles=[q];
  const before=JSON.stringify(q);
  for(const dt of [NaN,Infinity,-1]) stepGrenades(g,dt);
  assert.equal(JSON.stringify(q),before);
  g.time=NaN; stepGrenades(g,1); assert.equal(JSON.stringify(q),before);
});

test('authority: dead/invalid targets and client-shaped hit claims cannot add victims', () => {
  const dead=player('dead','CT',-38,-56,{alive:false}), real=player('real','CT',-34,-56);
  const g=game(owner(),dead,real);
  g.players.set('invalid',{id:'invalid',alive:true,x:NaN,y:0,z:0});
  const p=placed(g,'hegrenade',blast,{detonateAt:0,targets:['dead','invalid'],hit:{id:'dead',damage:9999}});
  stepGrenades(g,0);
  assert.deepEqual(g.hits.map(h=>h.p.id),['real']);
  assert.ok(!('targets' in g.events[0]) && !('hit' in g.events[0]));
  assert.equal(g.projectiles.includes(p),false);
});
