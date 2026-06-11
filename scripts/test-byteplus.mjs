import crypto from 'crypto';

async function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function hmac(keyData, msg) {
  return crypto.createHmac('sha256', keyData).update(msg).digest();
}

async function hmacHex(keyData, msg) {
  return crypto.createHmac('sha256', keyData).update(msg).digest('hex');
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
  const body = JSON.stringify({
    Filter: { GroupType: "AIGC" },
    PageNumber: 1,
    PageSize: 10
  });
  const headers = await signBytePlusRequest('POST', 'https://open.ap-southeast-1.byteplusapi.com/?Action=ListAssetGroups&Version=2024-01-01', body, AK, SK);
  const res = await fetch('https://open.ap-southeast-1.byteplusapi.com/?Action=ListAssetGroups&Version=2024-01-01', { method: 'POST', headers, body });
  console.log(await res.json());
}
test();
