const crypto = globalThis.crypto || require('crypto').webcrypto;

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(keyData, msg) {
  const enc = new TextEncoder();
  const keyBuf = typeof keyData === 'string' ? enc.encode(keyData) : keyData;
  const key = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', key, enc.encode(msg));
}

async function hmacHex(keyData, msg) {
  const sig = await hmac(keyData, msg);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signBytePlusRequest(method, urlStr, bodyStr, ak, sk) {
  const url = new URL(urlStr);
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'ap-southeast-1';
  const service = 'ark';

  const payloadHash = await sha256Hex(bodyStr || '');

  const canonicalHeaders = `content-type:application/json\nhost:${url.host}\nx-content-sha256:${payloadHash}\nx-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = `${method}\n${url.pathname}\n${url.search.slice(1)}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const kDate = await hmac(sk, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'request');

  const signature = await hmacHex(kSigning, stringToSign);
  const authorization = `${algorithm} Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/json',
    'X-Date': amzDate,
    'X-Content-Sha256': payloadHash,
    'Authorization': authorization
  };
}

const AK = process.env.BYTEPLUS_ACCESS_KEY_ID;
const SK = process.env.BYTEPLUS_SECRET_ACCESS_KEY;

if (!AK || !SK) {
  throw new Error('Set BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY before running this script.');
}

async function test() {
  const listBody = JSON.stringify({
    ProjectName: "HKBAIZE005",
    Filter: { GroupType: "AIGC" },
    PageNumber: 1,
    PageSize: 1
  });
  const listHeaders = await signBytePlusRequest('POST', 'https://open.ap-southeast-1.byteplusapi.com/?Action=ListAssetGroups&Version=2024-01-01', listBody, AK, SK);
  const listRes = await fetch('https://open.ap-southeast-1.byteplusapi.com/?Action=ListAssetGroups&Version=2024-01-01', { method: 'POST', headers: listHeaders, body: listBody });
  const listData = await listRes.json();
  console.log("ListData:", listData);
}
test();
