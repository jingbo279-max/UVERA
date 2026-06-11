const ALLOWED_ORIGINS = [
  'http://localhost:5176',
  'https://uvera.ai',
];

const CUSTOM_DOMAIN = 'https://asset.uvera.ai';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, accesstoken',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'PUT' && request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);

    // --- NEW STREAM UPLOAD PROXY ---
    if (url.pathname === '/stream/direct_upload' && request.method === 'POST') {
      const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
      const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');

      try {
        const cfResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            maxDurationSeconds: 7200,
            creator: "admin-dashboard"
          })
        });

        const cfData = await cfResponse.json();
        
        return new Response(JSON.stringify(cfData), {
          status: cfResponse.ok ? 200 : 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(origin),
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(origin)
          }
        });
      }
    }
    // --- END STREAM UPLOAD PROXY ---

    // Expected path: /upload/<objectKey>
    const objectKey = url.pathname.replace('/upload/', '');

    if (!objectKey || objectKey === '/upload/') {
      return new Response('Missing object key', { status: 400 });
    }

    const contentType = request.headers.get('Content-Type') || 'image/jpeg';
    const body = await request.arrayBuffer();

    await env.BUCKET.put(objectKey, body, {
      httpMetadata: { contentType },
    });

    const publicUrl = `${CUSTOM_DOMAIN}/${objectKey}`;
    return new Response(JSON.stringify({ url: publicUrl }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
      },
    });
  },
};
