// Test-response instrumentation only. It observes the actual frame body in
// either scheduling mode and does not patch RAF, MessageChannel or production
// exports. Callers supply fixed test expressions, never network/RPC input.
export function instrumentCS2FrameBody(source,{before,after}={}){
 if(typeof source!=='string'||typeof before!=='string'||typeof after!=='string')throw new TypeError('Frame observation requires source and fixed test hooks');
 const entry='function frame(now){if(stopped)return;',token='__cs2ObservedFrame';
 if(source.includes(token)||source.split(entry).length!==2)throw Error('CS2 frame entry is absent, ambiguous or already instrumented');
 const exits=['\n}\nframeScheduler.request();','\n}\nrafId=requestAnimationFrame(frame);'].filter(marker=>source.includes(marker));
 if(exits.length!==1||source.split(exits[0]).length!==2)throw Error('CS2 frame exit anchor changed');
 const end=exits[0];
 return source.replace(entry,entry+`const ${token}=(${before});try{`).replace(end,`\n}finally{${after}}`+end);
}
