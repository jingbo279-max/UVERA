import crypto from 'crypto';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hmac(key, buffer) {
  return crypto.createHmac('sha256', key).update(buffer).digest();
}

export function signBytePlusRequest({ method, url, body, accessKeyId, secretAccessKey, service, region }) {
  const urlObj = new URL(url);
  const host = urlObj.host;
  const path = urlObj.pathname || '/';
  const query = urlObj.search.slice(1);
  
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(body || '');

  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${payloadHash}\nx-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';

  const canonicalRequest = `${method}\n${path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');

  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/json',
    'X-Date': amzDate,
    'X-Content-Sha256': payloadHash,
    'Authorization': authorization
  };
}
