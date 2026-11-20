const $ = s => document.querySelector(s);
const KEY = 'chief.workspace.v1';
let chats = [], active = null, busy = false, controller = null, connected = false;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  chats = Array.isArray(saved.chats) ? saved.chats.filter(c => typeof c.id === 'string' && Array.isArray(c.messages)) : [];
  active = saved.active;
} catch {}

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

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

function newChat() {
  if (busy) {
    toast('Wait for the current reply, or stop it first.');
    return;
  }
  active = null;
  if ($('#message')) $('#message').value = '';
  if ($('#notice')) $('#notice').hidden = true;
  persist();
  render();
  closeSidebar();
  $('#message')?.focus();
}

function renderList() {
  const list = $('#chat-list');
  if (!list) return;
  list.replaceChildren();
  const search = ($('#search')?.value || '').toLowerCase();
  const filtered = chats.filter(c => (c.title || 'New conversation').toLowerCase().includes(search));
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
    const b = document.createElement('button');
    b.textContent = chat.title || 'New conversation';
    b.title = b.textContent;
    b.onclick = () => {
      if (busy) return toast('Stop the current reply before switching chats.');
      active = chat.id;
      if ($('#notice')) $('#notice').hidden = true;
      persist();
      render();
      closeSidebar();
    };
    const del = document.createElement('button');
    del.className = 'delete-chat';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete ' + b.textContent);
    del.onclick = () => {
      if (busy) return;
      if (!confirm('Delete this conversation?')) return;
      chats = chats.filter(c => c.id !== chat.id);
      if (active === chat.id) active = null;
      persist();
      render();
    };
    row.append(b, del);
    list.append(row);
  }
}

function formatText(container, text) {
  const parts = String(text).split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      const span = document.createElement('span');
      span.textContent = part;
      container.append(span);
    } else {
      const newline = part.indexOf('\n');
      const language = newline >= 0 ? part.slice(0, newline).trim() : 'code';
      const code = newline >= 0 ? part.slice(newline + 1) : part;
      const head = document.createElement('div');
      head.className = 'code-header';
      const label = document.createElement('span');
      label.textContent = language || 'code';
      const copy = document.createElement('button');
      copy.className = 'copy';
      copy.textContent = 'Copy code';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast('Code copied');
        } catch {
          toast('Copy is unavailable in this browser. Select the code to copy it.');
        }
      };
      head.append(label, copy);
      const pre = document.createElement('pre');
      const el = document.createElement('code');
      el.textContent = code;
      pre.append(el);
      container.append(head, pre);
    }
  });
}

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
      for (const m of chat.messages) {
        const item = document.createElement('article');
        item.className = 'message ' + m.role;
        const label = document.createElement('div');
        label.className = 'message-label';
        label.textContent = m.role === 'user' ? 'YOU' : m.role === 'assistant' ? '✳  CHIEF' : 'CONNECTION';
        const body = document.createElement('div');
        body.className = 'message-body';
        formatText(body, m.content);
        item.append(label, body);
        msgs.append(item);
      }
    }
    if (busy) {
      const pending = document.createElement('div');
      pending.className = 'pending';
      pending.textContent = 'Chief is thinking…';
      msgs.append(pending);
    }
  }
  updateSend();
}

function updateSend() {
  const send = $('#send');
  const msg = $('#message');
  if (!send || !msg) return;
  send.disabled = !busy && !msg.value.trim();
  send.textContent = busy ? 'Stop' : 'Send';
  send.setAttribute('aria-label', busy ? 'Stop response' : 'Send message');
}

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
    connected = false;
  }
}

if ($('#composer')) {
  $('#composer').onsubmit = async event => {
    event.preventDefault();
    if (busy) {
      controller?.abort();
      return;
    }
    const msgEl = $('#message');
    const text = (msgEl?.value || '').trim();
    if (!text) return;

    let chat = current();
    if (!chat) {
      chat = { id: crypto.randomUUID(), title: text.slice(0, 42), messages: [], created: new Date().toISOString() };
      chats.unshift(chat);
      active = chat.id;
    }
    chat.messages.push({ role: 'user', content: text });
    if (msgEl) {
      msgEl.value = '';
      msgEl.style.height = 'auto';
    }
    if ($('#notice')) $('#notice').hidden = true;
    persist();
    render();

    if (!connected) await health();
    if (!connected) {
      chat.messages.push({ role: 'notice', content: 'Your message is saved. Check that FIREWORKS_API_KEY is set in Cloudflare, then try again.' });
      persist();
      render();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      return;
    }

    busy = true;
    controller = new AbortController();
    render();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    const timer = setTimeout(() => controller?.abort(), 65000);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chat.messages.filter(m => m.role === 'user' || m.role === 'assistant') }),
        signal: controller.signal
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Error('The chat service is unavailable. Please refresh and try again.');
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'The model could not answer.');
      if (typeof data.reply !== 'string') throw Error('The model returned an invalid reply.');
      chat.messages.push({ role: 'assistant', content: data.reply || 'The model ended its reply without text.' });
    } catch (error) {
      chat.messages.push({ role: 'notice', content: error.name === 'AbortError' ? 'Response stopped. Your message is still saved.' : error.message });
    } finally {
      clearTimeout(timer);
      busy = false;
      controller = null;
      persist();
      render();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
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
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy && $('#message').value.trim()) $('#composer')?.requestSubmit();
    }
  };
}

if ($('#new-chat')) $('#new-chat').onclick = newChat;
if ($('#search')) $('#search').oninput = renderList;
if ($('#menu')) $('#menu').onclick = () => document.body.classList.toggle('sidebar-open');
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
document.addEventListener('keydown', e => {
if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
e.preventDefault();
newChat();
}
});
render();
health();
setInterval(health, 15000);
