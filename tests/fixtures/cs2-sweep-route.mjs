// Test-only source wrappers. Callers serve the returned strings through their
// own Playwright routes; production files on disk are never written.
function closingBrace(source,opening){
  let depth=1,quote=null,lineComment=false,blockComment=false,escaped=false;
  for(let i=opening+1;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quote){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    // The four pinned production function bodies currently have no templates
    // or regex literals. Reject a new template instead of miscounting ${...}.
    if(ch==='`')throw Error('Sweep wrapper needs a parser update for template literals');
    if(ch==='{')depth++;else if(ch==='}'&&!--depth)return i;
  }
  throw Error('Unclosed sweep instrumentation function');
}
function wrap(source,signature,name){
  if(source.split(signature).length-1!==1)throw Error('Sweep instrumentation anchor changed: '+signature);
  const opening=source.indexOf(signature)+signature.length-1,closing=closingBrace(source,opening),body=source.slice(opening+1,closing),variable='__sweepSpanStart';
  return source.slice(0,opening+1)+'const '+variable+'=performance.now();try{'+body+'}finally{window.__pointerTrace?.recordSpan?.('+JSON.stringify(name)+','+variable+',performance.now()-'+variable+');}'+source.slice(closing);
}
export function instrumentSweepModules({optimizedSource,textureSource}){
  const mapIndex='g.setIndex(new THREE.BufferAttribute(working,1).setUsage(THREE.DynamicDrawUsage));';
  if(optimizedSource.split(mapIndex).length-1!==1)throw Error('Map working-index marker anchor changed');
  optimizedSource=optimizedSource.replace(mapIndex,'window.__pointerTrace?.mapIndexArrays?.add(working);'+mapIndex);
  return{
    optimizedSource:wrap(wrap(optimizedSource,'function selection(){','selection'),'function applySelection(next){','applySelection'),
    textureSource:wrap(wrap(textureSource,'function pump(frameTimeMs){','stream.pump'),'function trim(){','stream.trim'),
  };
}
