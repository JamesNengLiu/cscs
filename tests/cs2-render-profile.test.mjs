import test from 'node:test';
import assert from 'node:assert/strict';
import {createResolutionController} from '../public/render-budget.js';
import {createCS2ResolutionController,cs2RenderProfileFromSearch} from '../public/cs2-render-profile.js';

test('baseline preserves shared-controller decisions and state through cadence and pressure changes',()=>{
  for(const maxRatio of [.5,1,1.5,2]){
    const baseline=createResolutionController(maxRatio),experiment=createCS2ResolutionController(maxRatio);
    for(let i=1;i<=2400;i++){
      if(i===900){baseline.setTarget('120');experiment.setTarget('120');}
      if(i===1600){baseline.setQuality('sharp');experiment.setQuality('sharp');}
      if(i===1800){baseline.setQuality('auto');experiment.setQuality('auto');}
      const pressure=i>=300&&i<750,ms=pressure?27:1000/75,now=i*14,gpu=pressure?22:3;
      const options={cpuMs:pressure?15:3,gpuSampleId:i,gpuSubmittedAt:now-14,gpuRatio:baseline.ratio};
      assert.equal(experiment.sample(ms,now,gpu,options),baseline.sample(ms,now,gpu,options));
      const {presentationAB,...diagnostics}=experiment.diagnostics();
      assert.deepEqual(diagnostics,baseline.diagnostics());
      assert.equal(presentationAB.profile,'baseline');
      assert.equal(experiment.ratio,baseline.ratio);
    }
  }
});

test('headroom caps pixels while preserving low-DPR ratios and actual GPU sample attribution',()=>{
  for(const maxRatio of [.5,1,2]){
    const resolution=createCS2ResolutionController(maxRatio,{profile:'headroom'});
    assert.equal(resolution.ratio,Math.min(maxRatio,.75));
    for(let i=1;i<=600;i++){
      resolution.sample(1000/75,i*1000/75,2,{cpuMs:2,gpuSampleId:i,gpuSubmittedAt:(i-1)*1000/75,gpuRatio:resolution.ratio});
      assert.ok(resolution.ratio<=Math.min(maxRatio,.75));
    }
    assert.equal(resolution.diagnostics().cadenceCalibrated,true);
    assert.equal(resolution.targetHz,75);
    assert.notEqual(resolution.diagnostics().classification,'gpu-unavailable');
  }
});

test('switching profiles preserves preferences and resets measurements without persisting a new default',()=>{
  const resolution=createCS2ResolutionController(2);
  resolution.setQuality('sharp');resolution.setTarget('144');
  assert.equal(resolution.ratio,1.25);
  assert.equal(resolution.setProfile('headroom'),true);
  assert.equal(resolution.ratio,.75);
  assert.equal(resolution.quality,'sharp');assert.equal(resolution.target,'144');
  assert.equal(resolution.setProfile('headroom'),false);
  assert.equal(resolution.setProfile('unknown'),false);
  assert.equal(resolution.setProfile('baseline'),true);
  assert.equal(resolution.ratio,1.25);
  assert.equal(resolution.quality,'sharp');assert.equal(resolution.target,'144');
});

test('only an explicit headroom URL selects the experimental profile',()=>{
  for(const search of ['', '?camera=responsive','?present=unknown','?present=baseline'])assert.equal(cs2RenderProfileFromSearch(search),'baseline');
  assert.equal(cs2RenderProfileFromSearch('?present=headroom&camera=baseline'),'headroom');
});

test('returning to baseline retains its learned refresh budget even without fresh headroom',()=>{
  const resolution=createCS2ResolutionController(1);
  for(let i=1;i<=120;i++)resolution.sample(1000/75,i*1000/75,2,{cpuMs:2,gpuSampleId:i,gpuSubmittedAt:(i-1)*1000/75,gpuRatio:1});
  assert.equal(resolution.targetHz,75);
  assert.equal(resolution.diagnostics().cadenceCalibrated,true);
  resolution.setProfile('headroom');
  resolution.setProfile('baseline');
  assert.equal(resolution.targetHz,75);
  assert.equal(resolution.diagnostics().cadenceCalibrated,true);
  for(let i=121;i<=300;i++)resolution.sample(1000/75,i*1000/75,10,{cpuMs:10,gpuSampleId:i,gpuSubmittedAt:(i-1)*1000/75,gpuRatio:resolution.ratio});
  assert.equal(resolution.targetHz,75);
});
