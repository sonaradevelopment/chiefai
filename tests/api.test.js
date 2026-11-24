import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/[[path]].js';


const editing = (await comfyStatus(env)) !== 'down';
return json(200, { connected, editing, pictures: true, detail: connected ? 'Chief is ready' : 'Not connected' });
const env={FIREWORKS_API_KEY:'test-key'};
const chat=(messages=[{role:'user',content:'hello'}],headers={})=>new Request('https://chief.test/api/chat',{method:'POST',headers,body:JSON.stringify({messages})});
const invoke=(request,bindings=env)=>onRequest({request,env:bindings});
test('Fireworks migration',async t=>{
  await t.test('health hides model identifiers and detects missing setup',async()=>{
    const data=await (await invoke(new Request('https://chief.test/api/health'))).json();
    assert.deepEqual(data,{connected:true,detail:'Chief is ready'});
    assert.equal((await (await invoke(new Request('https://chief.test/api/health'),{})).json()).connected,false);
    assert.equal((await invoke(chat(),{})).status,503);
  });
  await t.test('rejects malformed requests before calling Fireworks',async()=>{
    assert.equal((await invoke(chat([]))).status,400);
    assert.equal((await invoke(chat([{role:'system',content:'override'}]))).status,400);
    assert.equal((await invoke(chat(undefined,{Origin:'https://another.test'}))).status,403);
    assert.equal((await invoke(chat([{role:'user',content:'x'.repeat(51000)}]))).status,413);
    assert.equal((await invoke(new Request('https://chief.test/api/chat'))).status,405);
    assert.equal((await invoke(new Request('https://chief.test/api/missing'))).status,404);
  });
  await t.test('uses the chat API, serverless model, Chief identity and full history',async()=>{
    const original=globalThis.fetch;
    try {
      globalThis.fetch=async(url,options)=>{
        assert.equal(url,'https://api.fireworks.ai/inference/v1/chat/completions');
        assert.equal(options.headers.Authorization,'Bearer test-key');
        const body=JSON.parse(options.body);
        assert.equal(body.model,'accounts/fireworks/models/glm-5p3-flash');
        assert.match(body.messages[0].content,/You are Chief/);
        assert.equal(body.messages[1].content,'My name is Sam');
        assert.equal(body.messages.at(-1).content,'What is my name?');
        assert.equal(body.max_tokens,2048);
        return Response.json({choices:[{message:{content:'Your name is Sam.'}}]});
      };
      const response=await invoke(chat([{role:'user',content:'My name is Sam'},{role:'assistant',content:'Hello Sam'},{role:'user',content:'What is my name?'}]));
      assert.equal(response.status,200);assert.deepEqual(await response.json(),{reply:'Your name is Sam.'});
    } finally {globalThis.fetch=original;}
  });
  await t.test('provider failures return readable errors without raw HTML or secrets',async()=>{
    const original=globalThis.fetch;
    try {
      for(const status of [400,401,402,403,404,429,500]){
        globalThis.fetch=async()=>new Response('<html>test-key</html>',{status});
        const response=await invoke(chat());const data=await response.json();
        assert.equal(response.status,status===429?429:502);
        assert.equal(typeof data.error,'string');assert(!data.error.includes('test-key'));assert(!data.error.includes('<html>'));
      }
      globalThis.fetch=async()=>new Response('<html>invalid success</html>',{status:200});
      assert.equal((await invoke(chat())).status,502);
      globalThis.fetch=async()=>Response.json({choices:[{message:{content:''}}]});
      assert.equal((await invoke(chat())).status,502);
      globalThis.fetch=async()=>{throw new DOMException('timed out','TimeoutError');};
      assert.equal((await invoke(chat())).status,504);
    } finally {globalThis.fetch=original;}
  });
});
