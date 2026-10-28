import {ensureCertificate} from './local-certificate.mjs';
const paths=await ensureCertificate();
process.env.WEBTRANSPORT='1';process.env.TLS_CERT=paths.cert;process.env.TLS_KEY=paths.key;process.env.PORT??='3443';
await import('../server.mjs');
