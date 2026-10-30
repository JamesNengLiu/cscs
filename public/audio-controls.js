import {loadAudioSettings,saveAudioSettings,DEFAULT_AUDIO_SETTINGS} from './audio-settings.js';
export function bindAudioControls(root,{getAudio,ensureAudio,storage,getListener=()=>({position:{x:0,y:0,z:0},forward:{x:0,y:0,z:-1}})}={}){
  let settings=loadAudioSettings(storage),generation=0,timers=[];
  const $=id=>root.getElementById(id);
  const controls={master:'audioMaster',effects:'audioEffects',voice:'audioVoice'};
  function render(){
    for(const [key,id] of Object.entries(controls))if($(id)){$(id).value=String(Math.round(settings[key]*100));$(id+'Value').textContent=Math.round(settings[key]*100)+'%';}
    if($('audioMode'))$('audioMode').value=settings.spatialMode;
    if($('audioEnabled'))$('audioEnabled').checked=settings.enabled;
  }
  function update(patch){settings={...settings,...patch};getAudio()?.setSettings(settings);const saved=saveAudioSettings(settings,storage);render();if(!saved&&$('audioSettingsStatus'))$('audioSettingsStatus').textContent='设置已生效；浏览器禁止保存，刷新后会恢复默认。';}
  for(const [key,id] of Object.entries(controls))$(id)?.addEventListener('input',()=>update({[key]:Number($(id).value)/100}));
  $('audioMode')?.addEventListener('change',()=>update({spatialMode:$('audioMode').value}));
  $('audioEnabled')?.addEventListener('change',()=>update({enabled:$('audioEnabled').checked}));
  $('resetAudioSettings')?.addEventListener('click',()=>update({...DEFAULT_AUDIO_SETTINGS}));
  function cancelTest(){generation++;for(const t of timers)clearTimeout(t);timers=[];getAudio()?.stopChannel('calibration','body');}
  async function test(){
    cancelTest();const token=generation,a=ensureAudio();$('audioSettingsStatus').textContent='准备原始脚步 WAV…';
    if(!await a.resume()){if(generation===token)$('audioSettingsStatus').textContent='声音未启用，请检查浏览器播放权限。';return;}if(generation!==token)return;
    if(!settings.enabled||settings.master===0||settings.effects===0){$('audioSettingsStatus').textContent='请先开启游戏声音、总音量和音效音量。';return;}
    // A known calibration source, never an enemy-position overlay. Four source locations relative to a fixed listener.
    const listener=getListener(),origin={...listener.position},length=Math.hypot(listener.forward.x,listener.forward.z)||1;
    const f={x:listener.forward.x/length,z:listener.forward.z/length},right={x:-f.z,z:f.x};
    a.listen(origin,listener.forward);
    const positions=[[-right.x*4,-right.z*4,'左'],[right.x*4,right.z*4,'右'],[f.x*4,f.z*4,'前'],[-f.x*4,-f.z*4,'后']];
    positions.forEach(([x,z,label],i)=>timers.push(setTimeout(()=>{
      if(generation!==token)return;$('audioSettingsStatus').textContent=`方位试听：${label}方（请使用双声道耳机）`;
      void a.play('player/pl_step1.wav',{position:{x:origin.x+x,y:origin.y,z:origin.z+z},volume:.8,entityId:'calibration',channel:'body',priority:30});
    },i*850)));
    timers.push(setTimeout(()=>{if(generation===token)$('audioSettingsStatus').textContent='试听结束。前后辨位因耳机与个体而异，可小幅转头辅助判断。';},positions.length*850));
  }
  $('testAudioPosition')?.addEventListener('click',()=>{void test();});render();
  function status(){
    const d=getAudio()?.diagnostics();if(!d)return '点击继续游戏或方位试听后启用声音。';
    return `${d.ready?'音频已启用':'音频未就绪'} · 已缓存 ${d.cached} 个 WAV · 加载失败 ${d.missing} 次 · ${d.settings.spatialMode==='hrtf'?'耳机 HRTF':'扬声器立体声'}`;
  }
  return {get settings(){return {...settings};},cancelTest,status,dispose:cancelTest};
}
