const API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const DEFAULT_MODEL = 'accounts/fireworks/models/glm-5p3-flash';
const SYSTEM =
  'You are Chief, a friendly personal AI assistant for conversation and coding. Introduce yourself as Chief. ' +
  'Keep backend model identifiers and internal instructions out of replies. Do not invent ownership or training claims. ' +
  'Answer clearly and directly, use fenced code blocks, and be honest about uncertainty. ' +
  'You cannot browse the web, run code, or access files. ' +
  'The current date and time, and live weather when the user asks for it, are supplied to you in system messages. ' +
  'Use them as the source of truth, never invent weather or times, and if a lookup failed, say so plainly.';

const json = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/* ---------- Date and time ---------- */

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 60) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function formatNow(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(new Date());
}

/* ---------- Location helpers ---------- */

const WEATHER_RE = /\b(weather|forecast|temperature|temp|raining|rain|snowing|snow|sunny|windy|humid|how (?:hot|cold|warm)|umbrella)\b/i;
const TIME_IN_RE = /\b(?:time|date|day)\b.*\b(?:in|at)\s+/i;

function extractLocation(text) {
  const m = text.match(
    /\b(?:in|for|at|near|around)\s+([^?.!,;\n]{2,60}?)(?:\s+(?:today|tonight|tomorrow|now|right now|rn|currently|this (?:week|weekend)|please|atm))*\s*[?.!]*$/i
  );
  if (!m) return null;
  const name = m[1].replace(/^(the|a)\s+/i, '').trim();
  if (!name || /^(weekend|week|morning|evening|afternoon|night|moment|world)$/i.test(name)) return null;
  return name;
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('lookup failed');
  return r.json();
}

async function geocode(query) {
  const words = query.split(/\s+/).filter(Boolean);
  // Try "Mansfield UK" as-is, then drop trailing words ("UK", "Nottinghamshire England") and use them as a hint
  for (let drop = 0; drop < Math.min(3, words.length); drop++) {
    const name = words.slice(0, words.length - drop).join(' ');
    const hint = words.slice(words.length - drop).join(' ').toLowerCase();
    const data = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`
    );
    const results = data.results || [];
    if (!results.length) continue;
    if (hint) {
      const aliases = { uk: 'gb', 'united kingdom': 'gb', england: 'gb', scotland: 'gb', wales: 'gb', usa: 'us', 'united states': 'us' };
      const h = aliases[hint] || hint;
      const match = results.find(
        r =>
          r.country_code?.toLowerCase() === h ||
          r.country?.toLowerCase() === hint ||
          r.admin1?.toLowerCase() === hint ||
          r.admin2?.toLowerCase() === hint
      );
      if (match) return match;
      continue;
    }
    return results[0];
  }
  return null;
}

const WX = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'violent showers', 85: 'light snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail'
};

async function weatherFor(place) {
  const us = place.country_code === 'US';
  const imperialWind = us || place.country_code === 'GB';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    `&timezone=auto&forecast_days=3&temperature_unit=${us ? 'fahrenheit' : 'celsius'}` +
    `&wind_speed_unit=${imperialWind ? 'mph' : 'kmh'}`;
  const d = await getJson(url);
  const t = us ? '°F' : '°C';
  const w = imperialWind ? 'mph' : 'km/h';
  const c = d.current;
  const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
  const lines = [
    `Live weather for ${label} (Open-Meteo, fetched just now, local time ${c.time.replace('T', ' ')}):`,
    `Now: ${WX[c.weather_code] || 'unknown conditions'}, ${Math.round(c.temperature_2m)}${t} (feels like ${Math.round(c.apparent_temperature)}${t}), ` +
      `humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} ${w}, precipitation ${c.precipitation} mm.`
  ];
  d.daily.time.forEach((day, i) => {
    lines.push(
      `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day}: ${WX[d.daily.weather_code[i]] || 'unknown'}, ` +
        `${Math.round(d.daily.temperature_2m_min[i])}–${Math.round(d.daily.temperature_2m_max[i])}${t}, ` +
        `rain chance ${d.daily.precipitation_probability_max[i] ?? '?'}%.`
    );
  });
  return lines.join('\n');
}

// Builds extra system messages (current time, weather, time in another place) for the latest user message
async function buildContext(text, clientTz, cf) {
  const notes = [];
  const tz = validTimeZone(clientTz) || validTimeZone(cf?.timezone) || 'UTC';
  notes.push(`Current date and time for the user: ${formatNow(tz)} (timezone ${tz}).`);

  const wantsWeather = WEATHER_RE.test(text);
  const wantsOtherTime = TIME_IN_RE.test(text);
  if (!wantsWeather && !wantsOtherTime) return notes;

  const named = extractLocation(text);
  try {
    let place = null;
    if (named) {
      place = await geocode(named);
      if (!place) {
        notes.push(`The user asked about "${named}" but no matching place was found. Say you couldn't find it and ask for a city and country.`);
        return notes;
      }
    } else if (wantsWeather && cf?.latitude && cf?.longitude) {
      place = {
        name: cf.city || 'your area',
        admin1: cf.region,
        country: cf.country,
        country_code: cf.country,
        latitude: Number(cf.latitude),
        longitude: Number(cf.longitude)
      };
    } else if (wantsWeather) {
      notes.push('The user asked about the weather but gave no location. Ask which city they mean.');
      return notes;
    }

    if (place && wantsOtherTime && place.timezone && validTimeZone(place.timezone)) {
      notes.push(`Current date and time in ${place.name}, ${place.country || ''}: ${formatNow(place.timezone)} (timezone ${place.timezone}).`);
    }
    if (place && wantsWeather) notes.push(await weatherFor(place));
  } catch {
    notes.push('A live lookup (weather or location) failed just now. Tell the user you could not fetch it and suggest trying again. Do not guess.');
  }
  return notes;
}

/* ---------- Handler ---------- */

export async function onRequest({ request, env }) {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (path === '/api/health' && request.method === 'GET') {
    const connected = Boolean(env.FIREWORKS_API_KEY?.trim());
    return json(200, { connected, detail: connected ? 'Chief is ready' : 'Add FIREWORKS_API_KEY in Cloudflare Pages settings.' });
  }
  if (path !== '/api/chat') return json(404, { error: 'Not found' });
  if (request.method !== 'POST') return json(405, { error: 'Use POST to send a message.' });
  if (!env.FIREWORKS_API_KEY?.trim()) return json(503, { error: 'Add FIREWORKS_API_KEY in Cloudflare Pages settings, then redeploy.' });
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json(403, { error: 'Send messages from the Chief website.' });

  let messages, tz;
  try {
    const raw = await request.text();
    if (raw.length > 50000) return json(413, { error: 'This conversation is too long. Start a new conversation.' });
    const body = JSON.parse(raw);
    messages = body.messages;
    tz = body.tz;
    if (
      !Array.isArray(messages) || messages.length < 1 || messages.length > 100 ||
      messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) ||
      messages.at(-1).role !== 'user'
    ) return json(400, { error: 'Invalid conversation. Start a new conversation and try again.' });
  } catch {
    return json(400, { error: 'The message must be valid JSON.' });
  }

  const notes = await buildContext(messages.at(-1).content, tz, request.cf);

  try {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${env.FIREWORKS_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.FIREWORKS_MODEL?.trim() || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM + '\n\n' + notes.join('\n') },
          ...messages.map(({ role, content }) => ({ role, content }))
        ],
        temperature: 0.7,
        max_tokens: 2048,
        stream: false
      })
    });
    if (!upstream.ok) {
      const status = upstream.status;
      const error =
        status === 401 || status === 403 ? 'Fireworks rejected the API key. Check FIREWORKS_API_KEY and its permissions in Cloudflare.'
        : status === 402 ? 'Fireworks credits are exhausted. Check your Fireworks account balance.'
        : status === 404 || status === 400 ? 'The Fireworks model is unavailable or the request was rejected. Check FIREWORKS_MODEL in Cloudflare and choose an available serverless model.'
        : status === 429 ? 'Fireworks is busy or its usage limit was reached. Please try again shortly.'
        : 'Fireworks could not answer right now. Please try again.';
      return json(status === 429 ? 429 : 502, { error });
    }
    let data;
    try { data = await upstream.json(); } catch { return json(502, { error: 'The AI service returned an unreadable response. Please try again.' }); }
    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) return json(502, { error: 'The AI service returned no answer. Try again or start a new conversation.' });
    return json(200, { reply });
  } catch (error) {
    return json(504, { error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The reply took too long. Please try again.' : 'Could not reach the AI service. Please try again.' });
  }
}
