import {createGameAudio} from './cs2-audio-engine.js';
export function createCS2GameAudio({package:pack,...options}={}){
 if(pack?.schema!=='cscs.cs2.audio.v1')throw Error('Original CS2 audio manifest required');
 const fetcher=options.fetcher||globalThis.fetch,allowedSounds=new Set(Object.values(pack.sounds).map(s=>s.url));let nativeLoads=0,legacyLoads=0,nativeEvents=0,missingEvents=0;
 const shotEventNames=new Set(Object.values(pack.weaponEvents||{}).flatMap(events=>Object.entries(events).filter(([key])=>/SINGLE|BURST/.test(key)).map(([,event])=>String(event.event).toLowerCase())));
 const audio=createGameAudio({...options,allowedSounds,preloadNames:[...Object.keys(pack.legacy||{}),'radio/ctwin.wav','radio/terwin.wav'],resolveSound:name=>{const native=allowedSounds.has(name)?name:pack.legacy?.[name];if(native){nativeLoads++;return native;}legacyLoads++;return '/assets/sounds/'+name;},fetcher}),diagnostics=audio.diagnostics;
 return{...audio,nativeEvent(name,opts={}){if(shotEventNames.has(String(name).toLowerCase()))return Promise.resolve(false);const event=pack.events?.[String(name).toLowerCase()],urls=event?.urls||[];if(!urls.length){missingEvents++;return Promise.resolve(false);}nativeEvents++;return audio.play(urls[0],{volume:1,entityId:'local-viewmodel',channel:'item',priority:10,...opts});},diagnostics:()=>({...diagnostics(),source:'cs2-native-with-explicit-legacy-fallback',nativeMappedNames:Object.keys(pack.legacy||{}).length,nativeLoads,legacyLoads,nativeEvents,missingEvents,limitations:pack.limitations})};
}
