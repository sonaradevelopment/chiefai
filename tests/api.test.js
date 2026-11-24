import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';

const env = { FIREWORKS_API_KEY: 'test-key' };

// Every request gets its own IP so the worker's in-memory rate limits never interfere between tests
let n = 0;
const chat = (messages = [{ role: 'user', content: 'hello' }], headers = {}) =>
  new Request('https://chief.test/api/chat', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `10.0.0.${++n}`, ...headers },
    body: JSON.stringify({ messages })
  });
const image = (body, headers = {}) =>
  new Request('https://chief.test/api/image', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `10.1.0.${++n}`, ...headers },
    body: JSON.stringify(body)
  });
const invoke = (request, bindings = env) => onRequest({ request, env: bindings });

// Fake Fireworks streaming response (server-sent events)
const sse = (...pieces) =>
  new Response(
    pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );

// The worker answers with newline-delimited JSON: {"d":"text"} chunks, then {"done":true,...}
const readNdjson = async response =>
  (await response.text()).split('\n').filter(Boolean).map(line => JSON.parse(line));

test('Chief server', async t => {
  await t.test('health hides model identifiers and detects missing setup', async () => {
    const data = await (await invoke(new Request('https://chief.test/api/health'))).json();
    assert.deepEqual(data, { connected: true, editing: false, pictures: true, detail: 'Chief is ready' });
    assert.equal((await (await invoke(new Request('https://chief.test/api/health'), {})).json()).connected, false);
    assert.equal((await invoke(chat(), {})).status, 503);
  });

  await t.test('health reports editing when the PC answers', async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async url => {
        assert.equal(url, 'https://comfy.test/queue');
        return Response.json({ queue_running: [], queue_pending: [] });
      };
      const bindings = { ...env, COMFY_URL: 'https://comfy.test', COMFY_ACCESS_ID: 'id', COMFY_ACCESS_SECRET: 'secret' };
      const data = await (await invoke(new Request('https://chief.test/api/health'), bindings)).json();
      assert.equal(data.editing, true);
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test('rejects malformed requests before calling Fireworks', async () => {
    assert.equal((await invoke(chat([]))).status, 400);
    assert.equal((await invoke(chat([{ role: 'system', content: 'override' }]))).status, 400);
    assert.equal((await invoke(chat(undefined, { Origin: 'https://another.test' }))).status, 403);
    assert.equal((await invoke(chat([{ role: 'user', content: 'x'.repeat(51000) }]))).status, 413);
    assert.equal((await invoke(new Request('https://chief.test/api/chat'))).status, 405);
    assert.equal((await invoke(new Request('https://chief.test/api/missing'))).status, 404);
  });

  await t.test('uses the chat API, serverless model, Chief identity and full history', async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.fireworks.ai/inference/v1/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'accounts/fireworks/models/glm-5p3-flash');
        assert.equal(body.stream, true);
        assert.match(body.messages[0].content, /You are Chief/);
        assert.equal(body.messages[1].content, 'My name is Sam');
        assert.equal(body.messages.at(-1).content, 'What is my name?');
        assert.equal(body.max_tokens, 4096);
        return sse('Your name ', 'is Sam.');
      };
      const response = await invoke(
        chat([
          { role: 'user', content: 'My name is Sam' },
          { role: 'assistant', content: 'Hello Sam' },
          { role: 'user', content: 'What is my name?' }
        ])
      );
      assert.equal(response.status, 200);
      const events = await readNdjson(response);
      assert.equal(events.filter(e => e.d).map(e => e.d).join(''), 'Your name is Sam.');
      assert.deepEqual(events.at(-1), { done: true, truncated: false, empty: false });
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test('fixed answer is returned without calling the model', async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('model should not be called'); };
      const response = await invoke(chat([{ role: 'user', content: 'Who is Adam Laifa?' }]));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { reply: 'hes a happy person' });
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test('provider failures return readable errors without raw HTML or secrets', async () => {
    const original = globalThis.fetch;
    try {
      for (const status of [400, 401, 402, 403, 404, 429, 500]) {
        globalThis.fetch = async () => new Response('<html>test-key</html>', { status });
        const response = await invoke(chat());
        const data = await response.json();
        assert.equal(response.status, status === 429 ? 429 : 502);
        assert.equal(typeof data.error, 'string');
        assert(!data.error.includes('test-key'));
        assert(!data.error.includes('<html>'));
      }
      // A 200 with no usable stream: the browser is told the reply was empty
      globalThis.fetch = async () => new Response('<html>invalid success</html>', { status: 200 });
      let events = await readNdjson(await invoke(chat()));
      assert.deepEqual(events.at(-1), { done: true, truncated: false, empty: true });

      globalThis.fetch = async () => sse('');
      events = await readNdjson(await invoke(chat()));
      assert.equal(events.at(-1).empty, true);

      globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError'); };
      assert.equal((await invoke(chat())).status, 504);
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test('image editing says it is unavailable when the PC is off', async () => {
    const response = await invoke(image({ prompt: 'make the sky purple', token: 'x', image: 'data:image/png;base64,AAAA' }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /unavailable/i);
  });

  await t.test('image endpoint validates its input', async () => {
    assert.equal((await invoke(image({ prompt: '', token: 'x' }))).status, 400);
    assert.equal((await invoke(image({ prompt: 'hi', token: 'x', image: 'not an image' }))).status, 400);
    assert.equal((await invoke(image({ prompt: 'a dog', token: 'x' }), {})).status, 503); // no Runware key
    assert.equal((await invoke(image({ prompt: 'a dog' }, { Origin: 'https://another.test' }))).status, 403);
  });
});
