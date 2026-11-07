// Explicit isolated launcher. Does not start/stop the existing v1.0 service.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureCertificate} from './local-certificate.mjs';
import {createExperimentalServer} from '../cs2-server.mjs';
export async function startCS2Secure({port=3001,host='127.0.0.1'}={}){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),paths=await ensureCertificate(path.join(root,'.local/cs2/certificate'));
 return createExperimentalServer({port,host,tls:{cert:await readFile(paths.cert),key:await readFile(paths.key)},webtransport:true,presentation:'native',gameOptions:{weaponProfile:'cs2',hitRecovery:process.env.HIT_RECOVERY_PROFILE||'baseline'}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=await startCS2Secure({port:Number(process.env.PORT||3001),host:process.env.HOST||'127.0.0.1'});
 console.log('CS2 独立实验版：https://localhost:'+server.address().port+'/（HTTPS / QUIC；现有3001被占用时不会替换或停止它）');
 const close=()=>server.close().then(()=>process.exit(0));process.once('SIGINT',close);process.once('SIGTERM',close);
}
