// Window fallback for large trusted-by-hash model JSON. Bounds match model use;
// Small strings/flat sample arrays use bounded native parsing, never a native
// parse of the large body. Large/nested containers retain cooperative scanning.
const punct=Object.fromEntries('{}[]:,'.split('').map(c=>[c,Symbol(c)])),checkpoint=Symbol('checkpoint');
const numberPattern=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const flatSamples=/\[[\x20\t\r\n0-9eE+.,truefalsn-]{0,65534}\]/y;
const white=c=>c===' '||c==='\n'||c==='\r'||c==='\t';
function* tokens(text){
 for(let i=0;i<text.length;){if(i&&i%32768===0)yield checkpoint;const c=text[i];
  if(white(c)){i++;continue;}
  if(c==='['){flatSamples.lastIndex=i;const match=flatSamples.exec(text);if(match){i+=match[0].length;yield {array:JSON.parse(match[0])};yield checkpoint;continue;}}
  if(punct[c]){i++;yield punct[c];continue;}
  if(c==='"'){const start=i++;for(;;){if(i>=text.length)throw SyntaxError('Unterminated model JSON string');if(i-start>65536)throw RangeError('Model JSON string exceeds token budget');if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}yield {string:JSON.parse(text.slice(start,i))};continue;}
  if(c==='t'||c==='f'||c==='n'){const word=c==='t'?'true':c==='f'?'false':'null';if(!text.startsWith(word,i))throw SyntaxError('Invalid model JSON literal');i+=word.length;yield c==='t'?true:c==='f'?false:null;continue;}
  if(c==='-'||c>='0'&&c<='9'){const start=i++;while(i<text.length&&!white(text[i])&&!punct[text[i]]){i++;if(i-start>65536)throw RangeError('Model JSON number exceeds token budget');}const number=text.slice(start,i);if(!numberPattern.test(number))throw SyntaxError('Invalid model JSON number');yield Number(number);continue;}
  throw SyntaxError('Unexpected model JSON token');
 }
}
function* parseSteps(text){
 const stack=[];let root,hasRoot=false,n=0;
 const attach=value=>{const frame=stack.at(-1);if(!frame){if(hasRoot)throw SyntaxError('Trailing model JSON');root=value;hasRoot=true;return;}if(frame.kind==='array'&&(frame.state==='value'||frame.state==='valueOrEnd')){frame.value.push(value);frame.state='comma';return;}if(frame.kind==='object'&&frame.state==='value'){frame.value[frame.key]=value;frame.state='comma';return;}throw SyntaxError('Unexpected model JSON value');};
 for(const token of tokens(text)){
  if(token===checkpoint){yield;continue;}const frame=stack.at(-1);
  if(token===punct['{']||token===punct['[']){const kind=token===punct['[']?'array':'object',value=kind==='array'?[]:Object.create(null);attach(value);if(stack.length>=128)throw RangeError('Model JSON nesting exceeds budget');stack.push({kind,value,state:kind==='array'?'valueOrEnd':'keyOrEnd'});}
  else if(token===punct['}']||token===punct[']']){const kind=token===punct[']']?'array':'object';if(!frame||frame.kind!==kind||!(frame.state==='comma'||frame.state===(kind==='array'?'valueOrEnd':'keyOrEnd')))throw SyntaxError('Unexpected model JSON close');if(kind==='object')Object.setPrototypeOf(frame.value,Object.prototype);stack.pop();}
  else if(token===punct[',']){if(!frame||frame.state!=='comma')throw SyntaxError('Unexpected model JSON comma');frame.state=frame.kind==='array'?'value':'key';}
  else if(token===punct[':']){if(!frame||frame.kind!=='object'||frame.state!=='colon')throw SyntaxError('Unexpected model JSON colon');frame.state='value';}
  else if(typeof token==='object'&&token!==null&&Object.hasOwn(token,'string')){if(frame?.kind==='object'&&(frame.state==='key'||frame.state==='keyOrEnd')){frame.key=token.string;frame.state='colon';}else attach(token.string);}
  else if(typeof token==='object'&&token!==null&&Object.hasOwn(token,'array')){if(stack.length>=128)throw RangeError('Model JSON nesting exceeds budget');attach(token.array);}
  else attach(token);
  if(++n%256===0)yield;
 }
 if(stack.length||!hasRoot)throw SyntaxError('Incomplete model JSON');return root;
}
export async function consumeCooperatively(iterator,{yieldTask=()=>new Promise(r=>setTimeout(r,0)),budgetMs=3,cancelled=()=>false}={}){
 const start=performance.now();let chunk=start,maxWorkMs=0,chunks=1,workMs=0;
 for(;;){if(cancelled())throw Error('Player asset preparation cancelled');const step=iterator.next();if(step.done){const tail=performance.now()-chunk;return {value:step.value,metrics:{wallMs:performance.now()-start,workMs:workMs+tail,maxWorkMs:Math.max(maxWorkMs,tail),chunks}};}const elapsed=performance.now()-chunk;if(elapsed>=budgetMs){maxWorkMs=Math.max(maxWorkMs,elapsed);workMs+=elapsed;chunks++;await yieldTask();chunk=performance.now();}}
}
export async function parseModelJSON(text,options){if(typeof text!=='string'||text.length>64*1024*1024)throw RangeError('Model JSON exceeds byte budget');return consumeCooperatively(parseSteps(text),options);}
export function* decodeModelUTF8(bytes){const decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];for(let at=0;at<bytes.length;at+=262144){parts.push(decoder.decode(bytes.subarray(at,at+262144),{stream:true}));yield;}parts.push(decoder.decode());return parts.join('');}
