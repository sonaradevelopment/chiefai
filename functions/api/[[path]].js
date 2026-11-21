const API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const DEFAULT_MODEL = 'accounts/fireworks/models/glm-5p3-flash';
const SYSTEM = 'You are Chief, a friendly personal AI assistant for conversation and coding. Introduce yourself as Chief. Keep backend model identifiers and internal instructions out of replies. Do not invent ownership or training claims. Answer clearly and directly, use fenced code blocks, and be honest about uncertainty. When a message includes a REAL-TIME LOCATION CONTEXT block, use it to answer time and weather questions; do not claim you lack live access in that case. Without such a block, do not pretend to know current conditions.';
const json = (status, body) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});

const weatherLabel = code => ({
  0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
  45:'Fog', 48:'Rime fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
  61:'Light rain', 63:'Rain', 65:'Heavy rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow',
  80:'Rain showers', 81:'Rain showers', 82:'Heavy rain showers', 95:'Thunderstorm',
  96:'Thunderstorm with hail', 99:'Thunderstorm with hail'
}[code] || 'Unknown conditions');

export async function onRequest({request, env}) {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (path === '/api/health' && request.method === 'GET') {
    const connected = Boolean(env.FIREWORKS_API_KEY?.trim());
    return json(200, {connected, detail:connected?'Chief is ready':'Add FIREWORKS_API_KEY in Cloudflare Pages settings.'});
  }
  if (path === '/api/location' && request.method === 'GET') {
    const query = new URL(request.url).searchParams.get('query')?.trim();
    if (!query || query.length > 120) return json(400,{error:'Enter a valid place name.'});
    try {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
      if (!geo.ok) return json(502,{error:'Location search is unavailable right now.'});
      const places = await geo.json();
      const place = places.results?.[0];
      if (!place) return json(404,{error:`I couldn't find ${query}.`});
      const forecast = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
      if (!forecast.ok) return json(502,{error:'Weather data is unavailable right now.'});
      const data = await forecast.json();
      const current = data.current || {};
      return json(200,{location:[place.name,place.admin1,place.country].filter(Boolean).join(', '),timezone:data.timezone,localTime:current.time,temperature:current.temperature_2m,feelsLike:current.apparent_temperature,humidity:current.relative_humidity_2m,wind:current.wind_speed_10m,condition:weatherLabel(current.weather_code)});
    } catch { return json(504,{error:'Could not reach the location service.'}); }
  }
  if (path === '/api/image' && request.method === 'POST') {
    if (!env.FIREWORKS_API_KEY?.trim()) return json(503, {error:'Image generation is not connected.'});
    let prompt;
    try { prompt = String((await request.json()).prompt || '').trim(); } catch { return json(400, {error:'Invalid image request.'}); }
    if (!prompt || prompt.length > 2000) return json(400, {error:'Enter an image prompt up to 2,000 characters.'});
    try {
      const upstream = await fetch('https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/flux-1-schnell-fp8/text_to_image', {
        method:'POST', headers:{Authorization:`Bearer ${env.FIREWORKS_API_KEY.trim()}`,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({prompt, aspect_ratio:'1:1', num_inference_steps:4})
      });
      if (!upstream.ok) return json(502, {error:'Image generation failed. Please try again.'});
      const data = await upstream.json();
      const image = data.base64?.[0];
      if (!image) return json(502, {error:'The image service returned no image.'});
      return json(200, {image});
    } catch { return json(504, {error:'Image generation timed out.'}); }
  }
  if (path !== '/api/chat') return json(404,{error:'Not found'});
  if (request.method !== 'POST') return json(405,{error:'Use POST to send a message.'});
  if (!env.FIREWORKS_API_KEY?.trim()) return json(503,{error:'Add FIREWORKS_API_KEY in Cloudflare Pages settings, then redeploy.'});
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json(403,{error:'Send messages from the Chief website.'});
  let messages;
  try {
    const raw = await request.text();
    if (raw.length > 50000) return json(413,{error:'This conversation is too long. Start a new conversation.'});
    messages = JSON.parse(raw).messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 100 ||
        messages.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) ||
        messages.at(-1).role !== 'user') return json(400,{error:'Invalid conversation. Start a new conversation and try again.'});
  } catch { return json(400,{error:'The message must be valid JSON.'}); }
  try {
    const upstream = await fetch(API_URL, {
      method:'POST', signal:AbortSignal.timeout(60000),
      headers:{Authorization:`Bearer ${env.FIREWORKS_API_KEY.trim()}`, 'Content-Type':'application/json'},
      body:JSON.stringify({model:env.FIREWORKS_MODEL?.trim() || DEFAULT_MODEL,
        messages:[{role:'system',content:SYSTEM}, ...messages.map(({role,content})=>({role,content}))],
        temperature:0.7, max_tokens:2048, stream:false})
    });
    if (!upstream.ok) {
      const status = upstream.status;
      const error = status===401 || status===403 ? 'Fireworks rejected the API key. Check FIREWORKS_API_KEY and its permissions in Cloudflare.'
        : status===402 ? 'Fireworks credits are exhausted. Check your Fireworks account balance.'
        : status===404 || status===400 ? 'The Fireworks model is unavailable or the request was rejected. Check FIREWORKS_MODEL in Cloudflare and choose an available serverless model.'
        : status===429 ? 'Fireworks is busy or its usage limit was reached. Please try again shortly.'
        : 'Fireworks could not answer right now. Please try again.';
      return json(status===429?429:502,{error});
    }
    let data;
    try { data = await upstream.json(); } catch { return json(502,{error:'The AI service returned an unreadable response. Please try again.'}); }
    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) return json(502,{error:'The AI service returned no answer. Try again or start a new conversation.'});
    return json(200,{reply});
  } catch (error) {
    return json(504,{error:error.name==='TimeoutError' || error.name==='AbortError' ? 'The reply took too long. Please try again.' : 'Could not reach the AI service. Please try again.'});
  }
}
