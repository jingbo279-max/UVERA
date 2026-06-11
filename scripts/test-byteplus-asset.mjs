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
  const listBody = JSON.stringify({
    Filter: { GroupType: "AIGC" },
    PageNumber: 1,
    PageSize: 1
  });
  const listHeaders = await signBytePlusRequest('POST', 'https://open.ap-southeast-1.byteplusapi.com/?Action=ListAssetGroups&Version=2024-01-01', listBody, AK, SK);
  const listRes = await fetch('https://open.ap-southeast-1.byteplusapi.com/?Action=ListAssetGroups&Version=2024-01-01', { method: 'POST', headers: listHeaders, body: listBody });
  const listData = await listRes.json();
  const groupId = listData.Result.Items[0].Id;
  console.log("Using GroupId:", groupId);

  const createBody = JSON.stringify({
    GroupId: groupId,
    URL: "https://images.unsplash.com/photo-1544005313-94ddf0286df2", // A portrait of a person
    AssetType: "Image",
    Moderation: { Strategy: "Skip" }
  });
  const createHeaders = await signBytePlusRequest('POST', 'https://open.ap-southeast-1.byteplusapi.com/?Action=CreateAsset&Version=2024-01-01', createBody, AK, SK);
  const createRes = await fetch('https://open.ap-southeast-1.byteplusapi.com/?Action=CreateAsset&Version=2024-01-01', { method: 'POST', headers: createHeaders, body: createBody });
  const createData = await createRes.json();
  console.log("CreateAsset:", createData);

  if(createData.Result?.Id) {
    const assetId = createData.Result.Id;
    // wait a bit
    await new Promise(r => setTimeout(r, 2000));
    const getBody = JSON.stringify({ Id: assetId });
    const getHeaders = await signBytePlusRequest('POST', 'https://open.ap-southeast-1.byteplusapi.com/?Action=GetAsset&Version=2024-01-01', getBody, AK, SK);
    const getRes = await fetch('https://open.ap-southeast-1.byteplusapi.com/?Action=GetAsset&Version=2024-01-01', { method: 'POST', headers: getHeaders, body: getBody });
    const getData = await getRes.json();
    console.log("GetAsset Status:", getData.Result?.Status);
  }
}
test();
