const $ = s => document.querySelector(s);
const KEY = 'chief.workspace.v1';
let chats = [], active = null, busy = false, controller = null, connected = false, streaming = false;
let editingIndex = null;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  chats = Array.isArray(saved.chats) ? saved.chats.filter(c => typeof c.id === 'string' && Array.isArray(c.messages)) : [];
  active = saved.active;
} catch {}

// Show ⌘K on Apple devices
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) && $('#shortcut')) {
  $('#shortcut').textContent = '⌘ K';
}

// ---------- Settings (saved in this browser) ----------
const SKEY = 'chief.settings.v1';
const DEFAULTS = { size: 'medium', glow: true, enter: true };
let prefs = { ...DEFAULTS };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch {}
prefs.size = ['small', 'medium', 'large'].includes(prefs.size) ? prefs.size : 'medium';
delete prefs.name;
delete prefs.custom;
prefs.glow = prefs.glow !== false;
prefs.enter = prefs.enter !== false;

function applyPrefs() {
  document.documentElement.dataset.size = prefs.size;
  document.body.classList.toggle('no-glow', !prefs.glow);
  if ($('#caption-keys')) {
    $('#caption-keys').textContent = prefs.enter
      ? 'Enter to send · Shift + Enter for a new line'
      : 'Ctrl or ⌘ + Enter to send · Enter for a new line';
  }
}

function savePrefs() {
  try { localStorage.setItem(SKEY, JSON.stringify(prefs)); } catch {}
  applyPrefs();
}

function syncSettingsForm() {
  if ($('#set-glow')) $('#set-glow').checked = prefs.glow;
  if ($('#set-enter')) $('#set-enter').checked = prefs.enter;
  document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === prefs.size)));
}

function initSettingsControls() {
  $('#set-glow')?.addEventListener('change', e => { prefs.glow = e.target.checked; savePrefs(); });
  $('#set-enter')?.addEventListener('change', e => { prefs.enter = e.target.checked; savePrefs(); });
  document.querySelectorAll('[data-size]').forEach(b => {
    b.onclick = () => { prefs.size = b.dataset.size; savePrefs(); syncSettingsForm(); };
  });
  $('#reset-settings')?.addEventListener('click', () => {
    if (!confirm('Reset all settings to their defaults? Your chats are not affected.')) return;
    prefs = { ...DEFAULTS };
    savePrefs();
    syncSettingsForm();
    toast('Settings reset');
  });
}

// ---------- Storage and small helpers ----------
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ chats, active }));
  } catch {
    toast('Browser storage is full. Export your chats to keep a copy.');
  }
}

function toast(text) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

function current() {
  return chats.find(c => c.id === active);
}

function setSidebar(open) {
  document.body.classList.toggle('sidebar-open', open);
  $('#menu')?.setAttribute('aria-expanded', String(open));
}

function closeSidebar() {
  setSidebar(false);
}

function newChat() {
  if (busy) {
    toast('Wait for the current reply, or stop it first.');
    return;
  }
  active = null;
  editingIndex = null;
  if ($('#message')) $('#message').value = '';
  if ($('#notice')) $('#notice').hidden = true;
  persist();
  render();
  closeSidebar();
  $('#message')?.focus();
}

function scrollToEnd() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    toast('Copy is unavailable in this browser.');
  }
}

function mkButton(className, text, label, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  if (label) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  b.onclick = onclick;
  return b;
}

// ---------- Conversation list (pin, rename, delete) ----------
function renderList() {
  const list = $('#chat-list');
  if (!list) return;
  list.replaceChildren();
  const search = ($('#search')?.value || '').toLowerCase();
  const filtered = chats
    .filter(c => (c.title || 'New conversation').toLowerCase().includes(search))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)); // pinned first, otherwise keep order
  if ($('#chat-count')) $('#chat-count').textContent = chats.length;

  if (!filtered.length) {
    const p = document.createElement('p');
    p.className = 'empty-list';
    p.textContent = search ? 'No matching conversations.' : 'Your next idea starts here.\nConversations will appear as you go.';
    list.append(p);
  }

  for (const chat of filtered) {
    const row = document.createElement('div');
    row.className = 'chat-row' + (chat.id === active ? ' active' : '');
    const name = chat.title || 'New conversation';
    const b = document.createElement('button');
    b.textContent = (chat.pinned ? '📌 ' : '') + name;
    b.title = name;
    b.onclick = () => {
      if (busy) return toast('Stop the current reply before switching chats.');
      active = chat.id;
      editingIndex = null;
      if ($('#notice')) $('#notice').hidden = true;
      persist();
      render();
      closeSidebar();
    };
    const pin = mkButton('delete-chat', chat.pinned ? '★' : '☆', (chat.pinned ? 'Unpin ' : 'Pin ') + name, () => {
      chat.pinned = !chat.pinned;
      persist();
      renderList();
    });
    const rename = mkButton('delete-chat', '✎', 'Rename ' + name, () => {
      const next = prompt('Rename conversation', chat.title || '');
      if (next === null) return;
      const clean = next.trim().slice(0, 60);
      if (!clean) return;
      chat.title = clean;
      persist();
      renderList();
    });
    const del = mkButton('delete-chat', '×', 'Delete ' + name, () => {
      if (busy) return;
      if (!confirm('Delete this conversation?')) return;
      chats = chats.filter(c => c.id !== chat.id);
      if (active === chat.id) active = null;
      persist();
      render();
    });
    row.append(b, pin, rename, del);
    list.append(row);
  }
}

// ---------- Formatting: **bold**, *italic*, `code`, links, # headings, bullets, > quotes, --- rules, tables ----------
function safeHref(href) {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function makeLink(text, href) {
  const safe = safeHref(href);
  if (!safe) return document.createTextNode(text);
  const a = document.createElement('a');
  a.href = safe;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function appendInline(parent, text) {
  const tokens = text.split(
    /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+|\*\*[^*\n]+?\*\*|`[^`\n]+`|\*[^*\s][^*\n]*?\*)/
  );
  for (const tok of tokens) {
    if (!tok) continue;
    let el = null;
    const md = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (md) {
      el = makeLink(md[1], md[2]);
    } else if (/^https?:\/\//.test(tok)) {
      const url = tok.replace(/[.,;:!?]+$/, '');
      parent.append(makeLink(url, url));
      if (tok.length > url.length) parent.append(document.createTextNode(tok.slice(url.length)));
      continue;
    } else if (tok.length > 4 && tok.startsWith('**') && tok.endsWith('**')) {
      el = document.createElement('strong');
      el.textContent = tok.slice(2, -2);
    } else if (tok.length > 2 && tok.startsWith('`') && tok.endsWith('`')) {
      el = document.createElement('code');
      el.className = 'inline-code';
      el.textContent = tok.slice(1, -1);
    } else if (tok.length > 2 && tok.startsWith('*') && tok.endsWith('*') && !tok.startsWith('**')) {
      el = document.createElement('em');
      el.textContent = tok.slice(1, -1);
    }
    parent.append(el || document.createTextNode(tok));
  }
}

function buildTable(parent, rows) {
  const split = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const c of split(rows[0])) {
    const th = document.createElement('th');
    appendInline(th, c);
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const r of rows.slice(2)) {
    const tr = document.createElement('tr');
    for (const c of split(r)) {
      const td = document.createElement('td');
      appendInline(td, c);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  parent.append(wrap);
}

function renderMarkdown(parent, text) {
  const lines = String(text).split('\n');
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isSep = l => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('-');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const rows = [];
      let j = i;
      while (j < lines.length && isRow(lines[j])) rows.push(lines[j++]);
      buildTable(parent, rows);
      i = j - 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      const hr = document.createElement('div');
      hr.className = 'md-hr';
      parent.append(hr);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const q = document.createElement('div');
      q.className = 'md-quote';
      appendInline(q, quote[1]);
      parent.append(q);
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      const strong = document.createElement('strong');
      appendInline(strong, heading[1]);
      parent.append(strong);
    } else {
      appendInline(parent, line.replace(/^(\s*)[-*]\s+/, '$1• '));
    }
    if (i < lines.length - 1) parent.append('\n');
  }
}

function formatText(container, text) {
  const parts = String(text).split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      const span = document.createElement('span');
      renderMarkdown(span, part);
      container.append(span);
    } else {
      const newline = part.indexOf('\n');
      const language = newline >= 0 ? part.slice(0, newline).trim() : 'code';
      const code = newline >= 0 ? part.slice(newline + 1) : part;
      const head = document.createElement('div');
      head.className = 'code-header';
      const label = document.createElement('span');
      label.textContent = language || 'code';
      const copy = mkButton('copy', 'Copy code', null, () => copyText(code, 'Code copied'));
      head.append(label, copy);
      const pre = document.createElement('pre');
      const el = document.createElement('code');
      el.textContent = code;
      pre.append(el);
      container.append(head, pre);
    }
  });
}

// ---------- Rendering the conversation ----------
const QUICK_PROMPTS = [
  ['Explain simpler', 'Explain that more simply.'],
  ['Give an example', 'Can you give me an example?'],
  ['Make it shorter', 'Make that shorter.']
];

function render() {
  renderList();
  const chat = current();
  const hasMessages = !!chat?.messages.length;
  if ($('#welcome')) $('#welcome').hidden = hasMessages;
  const msgs = $('#messages');
  if (msgs) {
    msgs.hidden = !hasMessages;
    msgs.replaceChildren();
    if (hasMessages) {
      const lastIndex = chat.messages.length - 1;
      chat.messages.forEach((m, i) => {
        const item = document.createElement('article');
        item.className = 'message ' + m.role;
        const label = document.createElement('div');
        label.className = 'message-label';
        if (m.role === 'assistant') {
          const logo = document.createElement('img');
          logo.className = 'message-logo';
          logo.src = '/chieflogo.png';
          logo.alt = '';
          label.append(logo, 'CHIEF');
        } else {
          label.textContent = m.role === 'user' ? 'YOU' : 'CONNECTION';
        }
        item.append(label);

        if (m.role === 'user' && editingIndex === i) {
          item.append(buildEditor(chat, i, m));
        } else {
          const body = document.createElement('div');
          body.className = 'message-body';
          formatText(body, m.content);
          item.append(body);
        }

        // Action buttons
        if (!busy && editingIndex !== i) {
          if (m.role === 'user') {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            actions.append(mkButton('msg-act', 'Edit', 'Edit this message', () => {
              editingIndex = i;
              render();
              $('.edit-area')?.focus();
            }));
            item.append(actions);
          } else if (m.role === 'assistant') {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            actions.append(mkButton('msg-act', 'Copy', 'Copy this reply', () => copyText(m.content, 'Reply copied')));
            const up = mkButton('msg-act' + (m.rating === 'up' ? ' on' : ''), '👍', 'Good reply', () => rate(m, 'up'));
            const down = mkButton('msg-act' + (m.rating === 'down' ? ' on' : ''), '👎', 'Bad reply', () => rate(m, 'down'));
            up.setAttribute('aria-pressed', String(m.rating === 'up'));
            down.setAttribute('aria-pressed', String(m.rating === 'down'));
            actions.append(up, down);
            if (i === lastIndex) actions.append(mkButton('msg-act', '↻ Regenerate', 'Get a different answer', regenerate));
            item.append(actions);
          }
        }
        msgs.append(item);
      });
    }

    const lastMsg = chat?.messages.at(-1);
    if (!busy && lastMsg?.role === 'assistant' && lastMsg.truncated) {
      const wrap = document.createElement('div');
      wrap.className = 'continue-wrap';
      const btn = mkButton('continue-btn', 'Continue', null, continueReply);
      const hint = document.createElement('span');
      hint.textContent = 'This reply stopped early.';
      wrap.append(btn, hint);
      msgs.append(wrap);
    } else if (!busy && lastMsg?.role === 'assistant' && editingIndex === null) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const [label, prompt] of QUICK_PROMPTS) chips.append(mkButton('chip', label, null, () => sendText(prompt)));
      msgs.append(chips);
    }
    if (busy && !streaming) {
      const pending = document.createElement('div');
      pending.className = 'pending';
      pending.textContent = 'Chief is thinking…';
      msgs.append(pending);
    }
  }
  updateSend();
  updateScrollButton();
}

function buildEditor(chat, index, message) {
  const box = document.createElement('div');
  box.className = 'edit-box';
  const area = document.createElement('textarea');
  area.className = 'edit-area';
  area.value = message.content;
  area.maxLength = 12000;
  area.rows = 3;
  area.setAttribute('aria-label', 'Edit your message');
  const row = document.createElement('div');
  row.className = 'edit-actions';
  const save = mkButton('continue-btn', 'Save and resend', null, async () => {
    const text = area.value.trim();
    if (!text) return;
    editingIndex = null;
    chat.messages.splice(index); // drop this message and everything after it
    chat.messages.push({ role: 'user', content: text });
    if (index === 0) chat.title = text.slice(0, 42);
    persist();
    render();
    await respond(chat);
  });
  const cancel = mkButton('msg-act', 'Cancel', null, () => {
    editingIndex = null;
    render();
  });
  area.onkeydown = e => {
    if (e.key === 'Escape') cancel.click();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.click();
  };
  row.append(save, cancel);
  box.append(area, row);
  return box;
}

function rate(message, value) {
  message.rating = message.rating === value ? null : value;
  persist();
  render();
  if (message.rating) {
    // Only the rating is sent (no message text), so you can spot problems in your server logs
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: message.rating })
    }).catch(() => {});
    toast('Thanks for the feedback');
  }
}

function updateSend() {
  const send = $('#send');
  const msg = $('#message');
  if (!send || !msg) return;
  send.disabled = !busy && !msg.value.trim();
  send.textContent = busy ? 'Stop' : 'Send';
  send.setAttribute('aria-label', busy ? 'Stop response' : 'Send message');
}

function updateScrollButton() {
  const btn = $('#scroll-down');
  if (!btn) return;
  const hasChat = !!current()?.messages.length;
  const distance = document.body.scrollHeight - (window.innerHeight + window.scrollY);
  btn.hidden = !(hasChat && distance > 320);
}

// ---------- Connection ----------
async function health() {
  try {
    const r = await fetch('/api/health');
    if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw Error('Chief API unavailable');
    const data = await r.json();
    connected = data.connected === true;
    if ($('#connection-label')) $('#connection-label').textContent = connected ? 'Chief is ready' : 'Not connected';
    if ($('#connection')) $('#connection').classList.toggle('connected', connected);
    if ($('#settings-status')) $('#settings-status').textContent = connected ? 'Connected' : 'Not connected';
  } catch (e) {
    console.error(e);
    if ($('#connection-label')) $('#connection-label').textContent = 'Server unavailable';
    if ($('#connection')) $('#connection').classList.remove('connected');
    if ($('#settings-status')) $('#settings-status').textContent = 'Not connected';
    connected = false;
  }
}

// ---------- Sending and streaming ----------
// Keeps only the most recent part of long chats so they never hit the server's size limit
function historyFor(chat) {
  const list = chat.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(({ role, content }) => ({ role, content }));
  const out = [];
  let total = 0;
  let trimmed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    total += list[i].content.length;
    if (out.length && (total > 30000 || out.length >= 40)) {
      trimmed = true;
      break;
    }
    out.unshift(list[i]);
  }
  while (out.length > 1 && out[0].role === 'assistant') {
    out.shift();
    trimmed = true;
  }
  if (trimmed && !chat.trimNotice) {
    chat.trimNotice = true;
    toast('This chat is long, so Chief now only remembers the most recent messages.');
  }
  return out;
}

async function respond(chat) {
  if (!connected) await health();
  if (!connected) {
    chat.messages.push({
      role: 'notice',
      content: 'Chief can’t connect right now. Your message is saved. Check the connection and send it again.'
    });
    persist();
    render();
    scrollToEnd();
    return;
  }
  await streamReply(chat, false);
}

async function sendText(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  let chat = current();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: text.slice(0, 42), messages: [], created: new Date().toISOString() };
    chats.unshift(chat);
    active = chat.id;
  }
  editingIndex = null;
  chat.messages.push({ role: 'user', content: text });
  if ($('#notice')) $('#notice').hidden = true;
  persist();
  render();
  await respond(chat);
}

async function regenerate() {
  if (busy) return;
  const chat = current();
  if (!chat) return;
  while (chat.messages.length && chat.messages.at(-1).role !== 'user') chat.messages.pop();
  if (!chat.messages.length) return;
  persist();
  render();
  await respond(chat);
}

// Streams a reply into the chat. If it stops early (length limit, timeout, dropped connection, or Stop),
// whatever arrived is kept and a Continue button appears.
async function streamReply(chat, cont) {
  busy = true;
  streaming = false;
  controller = new AbortController();
  render();
  scrollToEnd();
  const timer = setTimeout(() => controller?.abort(), 100000);

  let msg = cont ? chat.messages.at(-1) : null;
  let truncated = false, errorText = '', raf = 0;

  const paint = () => {
    raf = 0;
    if (!msg) return;
    const bodies = document.querySelectorAll('#messages .message.assistant .message-body');
    const body = bodies[bodies.length - 1];
    if (!body) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
    body.replaceChildren();
    formatText(body, msg.content);
    if (nearBottom) window.scrollTo({ top: document.body.scrollHeight });
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: historyFor(chat),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cont: !!cont
      }),
      signal: controller.signal
    });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('ndjson')) {
      if (!type.includes('json')) throw Error('Chief is unavailable. Please refresh and try again.');
      const data = await response.json();
      throw Error(data.error || 'Chief could not answer.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', emptyReply = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (typeof evt.d === 'string') {
          if (!msg) {
            msg = { role: 'assistant', content: '' };
            chat.messages.push(msg);
          }
          msg.content += evt.d;
          if (!streaming) {
            streaming = true;
            render();
          } else if (!raf) {
            raf = requestAnimationFrame(paint);
          }
        }
        if (evt.done) {
          truncated = !!evt.truncated;
          emptyReply = !!evt.empty;
        }
      }
    }
    if (emptyReply && !(msg && msg.content)) errorText = 'Chief returned no answer. Try again or start a new conversation.';
  } catch (error) {
    if (msg && msg.content) {
      truncated = true; // stopped, timed out or disconnected: keep what we have
    } else {
      errorText = error.name === 'AbortError' ? 'Response stopped. Your message is still saved.' : error.message;
    }
  } finally {
    clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    if (msg) {
      if (truncated) msg.truncated = true;
      else delete msg.truncated;
    }
    if (errorText) chat.messages.push({ role: 'notice', content: errorText });
    busy = false;
    streaming = false;
    controller = null;
    persist();
    render();
    scrollToEnd();
  }
}

async function continueReply() {
  if (busy) return;
  const chat = current();
  const last = chat?.messages.at(-1);
  if (!chat || last?.role !== 'assistant') return;
  if (!connected) await health();
  if (!connected) return toast('Chief can’t connect right now. Try again in a moment.');
  await streamReply(chat, true);
}

// ---------- Composer ----------
if ($('#composer')) {
  $('#composer').onsubmit = event => {
    event.preventDefault();
    if (busy) {
      controller?.abort();
      return;
    }
    const msgEl = $('#message');
    const text = (msgEl?.value || '').trim();
    if (!text) return;
    msgEl.value = '';
    msgEl.style.height = 'auto';
    sendText(text);
  };
}

if ($('#message')) {
  $('#message').oninput = () => {
    const t = $('#message');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 170) + 'px';
    updateSend();
  };
  $('#message').onkeydown = e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const send = prefs.enter ? !e.shiftKey : e.ctrlKey || e.metaKey;
    if (send) {
      e.preventDefault();
      if (!busy && $('#message').value.trim()) $('#composer')?.requestSubmit();
    }
  };
}

// Voice input (uses the browser's built-in speech recognition where available)
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRec && $('#mic')) {
  const mic = $('#mic');
  mic.hidden = false;
  let rec = null;
  let listening = false;
  mic.onclick = () => {
    if (listening) {
      rec?.stop();
      return;
    }
    const field = $('#message');
    const base = field.value;
    try {
      rec = new SpeechRec();
      rec.lang = navigator.language || 'en-GB';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = e => {
        let heard = '';
        for (const r of e.results) heard += r[0].transcript;
        field.value = (base ? base + ' ' : '') + heard;
        field.dispatchEvent(new Event('input'));
      };
      rec.onerror = e => {
        toast(e.error === 'not-allowed' ? 'Microphone access was blocked.' : 'Voice input stopped.');
      };
      rec.onend = () => {
        listening = false;
        mic.classList.remove('on');
        mic.setAttribute('aria-pressed', 'false');
        field.focus();
      };
      rec.start();
      listening = true;
      mic.classList.add('on');
      mic.setAttribute('aria-pressed', 'true');
    } catch {
      toast('Voice input is unavailable in this browser.');
    }
  };
}

// ---------- Sidebar, prompts, settings dialog ----------
if ($('#new-chat')) $('#new-chat').onclick = newChat;
if ($('#search')) $('#search').oninput = renderList;
if ($('#menu')) $('#menu').onclick = () => setSidebar(!document.body.classList.contains('sidebar-open'));
if ($('#shade')) $('#shade').onclick = closeSidebar;

document.querySelectorAll('[data-prompt]').forEach(b => {
  b.onclick = () => {
    const msg = $('#message');
    if (!msg) return;
    msg.value = b.dataset.prompt;
    msg.dispatchEvent(new Event('input'));
    msg.focus();
  };
});

function settings() {
  syncSettingsForm();
  health();
  $('#settings')?.showModal();
}

if ($('#settings-button')) $('#settings-button').onclick = settings;
if ($('#connection')) $('#connection').onclick = settings;

if ($('#settings')) {
  $('#settings').addEventListener('click', e => {
    if (e.target === $('#settings')) {
      const r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  });
}

if ($('#export')) {
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), chats }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chief-chats.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Chats exported');
  };
}

if ($('#clear')) {
  $('#clear').onclick = () => {
    if (busy) return toast('Stop the current reply first.');
    if (confirm('Permanently clear all chats saved in this browser?')) {
      chats = [];
      active = null;
      persist();
      render();
      $('#settings')?.close();
      toast('Saved chats cleared');
    }
  };
}

// Scroll-to-bottom button
$('#scroll-down')?.addEventListener('click', scrollToEnd);
window.addEventListener('scroll', updateScrollButton, { passive: true });
window.addEventListener('resize', updateScrollButton);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    newChat();
  }
  if (e.key === 'Escape') closeSidebar();
});

initSettingsControls();
applyPrefs();
render();
health();
// Only poll while the tab is visible
setInterval(() => { if (!document.hidden) health(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) health(); });
