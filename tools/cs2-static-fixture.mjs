// Temporary HTTP loopback fixture, never imports Game/server or binds 3001.
import {createServer} from 'node:http';import {createReadStream} from 'node:fs';import {stat} from 'node:fs/promises';import path from 'node:path';import {once} from 'node:events';
export async function createStaticFixture(root=process.cwd()){
 const publicRoot=path.join(root,'public'),vendorRoot=path.join(root,'node_modules/three/build'),mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.gz':'application/gzip','.bin':'application/octet-stream','.gltf':'model/gltf+json','.png':'image/png','.wav':'audio/wav'};
 const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://fixture').pathname),vendor=pathname.startsWith('/vendor/'),base=vendor?vendorRoot:publicRoot,file=path.resolve(base,vendor?pathname.slice(8):'.'+pathname);if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);}catch{res.writeHead(404).end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return{url:'http://127.0.0.1:'+server.address().port,async close(){server.close();server.closeAllConnections();await once(server,'close');}};
}
