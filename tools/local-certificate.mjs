import {mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function ensureCertificate(directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'../.local')){
  await mkdir(directory,{recursive:true,mode:0o700});const cert=path.join(directory,'wt-cert.pem'),key=path.join(directory,'wt-key.pem');
  const ips=[...new Set(['127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal).map(a=>a.address)])];
  if(!process.argv.includes('--renew')&&existsSync(cert)&&existsSync(key)){const x=new X509Certificate(await readFile(cert));if(Date.parse(x.validTo)-Date.now()>86400000&&ips.every(ip=>x.checkIP(ip)))return {cert,key};}
  // Local-only ECDSA certificate; <=14 day validity is required for browser certificate pinning.
  const config=path.join(directory,'openssl.cnf');await writeFile(config,`[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=LAN Strike local test\n[ext]\nsubjectAltName=@alt\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n[alt]\nDNS.1=localhost\n${ips.map((ip,i)=>`IP.${i+1}=${ip}`).join('\n')}\n`);
  execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-pkeyopt','ec_param_enc:named_curve','-nodes','-keyout',key,'-out',cert,'-days','13','-config',config],{stdio:['ignore','ignore','pipe']});await chmod(key,0o600);return {cert,key};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await ensureCertificate();console.log('Local test certificate generated/reused:',result.cert);console.log('Private key remains local; no system trust store was modified.');}
