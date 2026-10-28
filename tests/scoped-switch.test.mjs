import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {RULES} from '../public/shared.js';

function advance(g,seconds){for(let i=0;i<Math.ceil(seconds*RULES.tick);i++)g.step();}
function scopedShot(weapon,zoom){
  const g=new Game({random:()=>.5}),p=g.add('p','Scoped switch','T');g.begin();g.buy(p.id,weapon);
  advance(g,.6);g.secondary(p.id);
  if(p.zoom!==zoom){advance(g,.31);g.secondary(p.id);}
  assert.equal(p.zoom,zoom);assert.equal(g.shoot(p),true);
  assert.equal(p.zoom,90);assert.ok(p.resumeZoomAt>g.time);
  return {g,p};
}

for(const weapon of ['awp','scout'])for(const zoom of GUNS[weapon].zoom){
  test(`scope recovery: ${weapon} at FOV ${zoom} restores its scope when kept equipped`,()=>{
    const {g,p}=scopedShot(weapon,zoom);
    advance(g,GUNS[weapon].interval+.1);
    assert.equal(p.weapon,weapon);assert.equal(p.zoom,zoom);assert.equal(p.resumeZoomAt,0);
  });
  for(const waitOnPistol of [false,true])test(`scope switching: ${weapon} FOV ${zoom}, ${waitOnPistol?'wait on pistol':'quick switch back'} cancels scope recovery`,()=>{
    const {g,p}=scopedShot(weapon,zoom),oldDeadline=p.resumeZoomAt;
    assert.equal(g.equip(p.id,2),true);assert.equal(p.weapon,'glock18');
    assert.equal(p.zoom,90);assert.equal(p.resumeZoomAt,0);assert.equal(p.resumeZoom,0);
    if(waitOnPistol){advance(g,GUNS[weapon].interval+.1);assert.equal(p.zoom,90);}
    assert.equal(g.equip(p.id,1),true);assert.equal(p.weapon,weapon);assert.equal(p.zoom,90);
    advance(g,Math.max(.6,oldDeadline-g.time+.1));
    const view=g.snapshot(p.id).players.find(q=>q.id===p.id);
    assert.equal(view.zoom,90);assert.equal(view.resumeZoomAt,0);
    g.secondary(p.id);assert.equal(p.zoom,GUNS[weapon].zoom[0]);
  });
}
