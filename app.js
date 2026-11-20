const $ = s => document.querySelector(s);
const KEY = 'chief.workspace.v1';
let chats = [], active = null, busy = false, controller = null, connected = false;

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
const DEFAULTS = { name: '', custom: '', size: 'medium', glow: true, enter: true };
let prefs = { ...DEFAULTS };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch {}
prefs.size = ['small', 'medium', 'large'].includes(prefs.size) ? prefs.size : 'medium';
prefs.name = String(prefs.name || '').slice(0, 40);
prefs.custom = String(prefs.custom || '').slice(0, 600);
prefs.glow = prefs.glow !== false;
prefs.enter = prefs.enter !== false;

function applyPrefs() {
  document.documentElement.dataset.size = prefs.size;
  document.body.classList.toggle('no-glow', !prefs.glow);
  const name = prefs.name.trim();
  if ($('#profile-name')) $('#profile-name').textContent = name || 'Your workspace';
  if ($('#avatar')) $('#avatar').textContent = (name[0] || 'Y').toUpperCase();
  if ($('#welcome-title')) $('#welcome-title').textContent = name ? 'What’s on your mind, ' + name + '?' : 'What’s on your mind?';
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
  if ($('#set-name')) $('#set-name').value = prefs.name;
  if ($('#set-custom')) $('#set-custom').value = prefs.custom;
  if ($('#custom-count')) $('#custom-count').textContent = prefs.custom.length + ' / 600';
  if ($('#set-glow')) $('#set-glow').checked = prefs.glow;
  if ($('#set-enter')) $('#set-enter').checked = prefs.enter;
  document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === prefs.size)));
}

function initSettingsControls() {
  $('#set-name')?.addEventListener('input', e => { prefs.name = e.target.value.slice(0, 40); savePrefs(); });
  $('#set-custom')?.addEventListener('input', e => {
    prefs.custom = e.target.value.slice(0, 600);
    $('#custom-count').textContent = prefs.custom.length + ' / 600';
    savePrefs();
  });
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

// Minimal, safe markdown: **bold**, *italic*, `code`, # headings, - bullets (built with DOM nodes, never innerHTML)
function appendInline(parent, text) {
  const tokens = text.split(/(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*[^*\s][^*\n]*?\*)/);
  for (const tok of tokens) {
    if (!tok) continue;
    let el = null;
    if (tok.length > 4 && tok.startsWith('**') && tok.endsWith('**')) {
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

function renderInline(parent, text) {
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      const strong = document.createElement('strong');
      appendInline(strong, heading[1]);
      parent.append(strong);
    } else {
      appendInline(parent, line.replace(/^(\s*)[-*]\s+/, '$1• '));
    }
    if (i < lines.length - 1) parent.append('\n');
  });
}

function formatText(container, text) {
  const parts = String(text).split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      const span = document.createElement('span');
      renderInline(span, part);
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
        if (m.role === 'assistant') {
          const logo = document.createElement('img');
          logo.className = 'message-logo';
          logo.src = '/chieflogo.png';
          logo.alt = '';
          label.append(logo, 'CHIEF');
        } else {
          label.textContent = m.role === 'user' ? 'YOU' : 'CONNECTION';
        }
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
    if ($('#connection')) $('#connection').classList.remove('connected');
    if ($('#settings-status')) $('#settings-status').textContent = 'Not connected';
    connected = false;
  }
}

function scrollToEnd() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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
      chat.messages.push({
        role: 'notice',
        content: 'Chief can’t connect right now. Your message is saved. Check the connection and send it again.'
      });
      persist();
      render();
      scrollToEnd();
      return;
    }

    busy = true;
    controller = new AbortController();
    render();
    scrollToEnd();
    const timer = setTimeout(() => controller?.abort(), 65000);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chat.messages.filter(m => m.role === 'user' || m.role === 'assistant'),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          name: prefs.name.trim(),
          custom: prefs.custom.trim()
        }),
        signal: controller.signal
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Chief is unavailable. Please refresh and try again.');
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
      scrollToEnd();
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
    if (e.key !== 'Enter' || e.isComposing) return;
    const send = prefs.enter ? !e.shiftKey : e.ctrlKey || e.metaKey;
    if (send) {
      e.preventDefault();
      if (!busy && $('#message').value.trim()) $('#composer')?.requestSubmit();
    }
  };
}

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
