// Parse and compile byte-verified physics away from the render thread. Large
// geometry/object BVHs never structured-clone back; only a transferable packed
// acceleration buffer and small shape metadata cross the worker boundary.
import {compileCollisionData} from './cs2-collision.js';
self.onmessage=event=>{
 try{
  const {bytes}=event.data||{};
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>128*1024*1024)throw Error('碰撞数据超出解析预算');
  const at=performance.now(),source=JSON.parse(new TextDecoder().decode(bytes));
  if(source?.schema!=='cs2-physics-v1'||!Array.isArray(source.shapes)||source.shapes.length>100000)throw Error('碰撞数据格式不受支持');
  const parseMs=performance.now()-at,compileAt=performance.now(),data=compileCollisionData(source);
  self.postMessage({data,parseMs,compileMs:performance.now()-compileAt,compiledBytes:data.compiledCollision.bytes},[data.compiledCollision.buffer]);
 }catch(error){self.postMessage({error:error.message||'碰撞数据解析失败'});}
};
