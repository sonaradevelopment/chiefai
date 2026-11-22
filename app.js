const $ = s => document.querySelector(s);
const KEY = 'chief.workspace.v1';
let chats = [], active = null, busy = false, controller = null, connected = false, streaming = false;
let editingIndex = null;
let pendingText = 'Chief is thinking…';
let pendingImage = null; // { full, thumb } picture waiting to be sent with the next message

// Your video ad (a VAST tag) and how many seconds of it must be watched before an image is made
const VAST_URL = 'https://gloomy-association.com/d.mbFFzRdjGXNkvwZiG/Uh/XeTmN9VuJZ/UmlqkoPETccv2dNTDEY/2XMkzvM-t/NpzfYs0/NDjRYPz-Nnwr';
const AD_SECONDS = 15;

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
    localStorage.setItem(KEY, JSON.stringify({ chats, active }, (k, v) => (k === 'attach' ? undefined : v)));
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

// Small line icons for the message action buttons (static, trusted markup)
const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  down: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'
};

// The action-button styles live here (not in style.css) so they always apply, whichever CSS file is deployed
(() => {
  const css = document.createElement('style');
  css.textContent = `
    .msg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 6px; }
    .msg-actions .icon-act {
      -webkit-appearance: none;
      appearance: none;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 26px;
      width: 26px;
      height: 26px;
      min-width: 0;
      margin: 0;
      padding: 0;
      line-height: 0;
      background: transparent;
      border: 0;
      border-radius: 7px;
      box-shadow: none;
      color: #8f8b99;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .msg-actions .icon-act:hover { background: #050506; color: #fff; filter: none; }
    .msg-actions .icon-act svg { display: block; flex: none; width: 15px; height: 15px; margin: 0; }
    .msg-actions .icon-act.on { color: #f0dfe9; }
    .msg-actions .icon-act.on svg { fill: currentColor; }
  `;
  document.head.append(css);
})();

// Styles for generated images, the ad window and the image viewer (kept here so they always apply)
(() => {
  const css = document.createElement('style');
  css.textContent = `
    .message-body .generated-image {
      display: block;
      width: auto;
      height: auto;
      max-width: min(100%, 300px);
      max-height: 300px;
      margin-top: 14px;
      border: 1px solid #39343f;
      border-radius: 12px;
      cursor: zoom-in;
      transition: filter 0.15s;
    }
    .message-body .generated-image:hover { filter: brightness(1.08); }

    #ad-gate {
      width: min(560px, calc(100% - 32px));
      max-height: none;
      padding: 26px 24px 22px;
      overflow: visible;
      background: #19191b;
      border: 1px solid #4a4149;
      border-radius: 18px;
      text-align: center;
    }
    #ad-gate h3 { margin: 0 0 8px; font-family: "Manrope", sans-serif; font-size: 20px; font-weight: 600; color: #f3f3f3; }
    #ad-gate p { margin: 0 0 16px; color: #b6b4bd; font-size: 14px; line-height: 1.6; }
    #ad-gate .gate-status { min-height: 22px; margin: 0 0 18px; color: #d6b1cb; font-size: 13px; }
    #ad-gate .gate-status.warn { color: #f0a9a9; }
    #ad-gate .gate-actions { display: flex; justify-content: center; gap: 10px; }
    #ad-gate .gate-btn {
      padding: 10px 20px;
      background: #f5f5f5;
      border: 0;
      border-radius: 22px;
      color: #171717;
      font-size: 14px;
      font-weight: 650;
    }
    #ad-gate .gate-btn:disabled { background: #38353d; color: #8f8c96; }
    #ad-gate .gate-btn.ghost { background: transparent; border: 1px solid #45454b; color: #cfcbd8; font-weight: 500; }

    #ad-gate .gate-stage { position: relative; display: none; margin: 0 0 14px; overflow: hidden; background: #000; border-radius: 12px; }
    #ad-gate .gate-stage.show { display: block; }
    #ad-gate .gate-video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; cursor: pointer; }
    #ad-gate .gate-video::-webkit-media-controls,
    #ad-gate .gate-video::-webkit-media-controls-enclosure,
    #ad-gate .gate-video::-webkit-media-controls-panel,
    #ad-gate .gate-video::-webkit-media-controls-overlay-play-button,
    #ad-gate .gate-video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none; }
    #ad-gate .gate-tap {
      position: absolute; top: 50%; left: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; padding: 0 0 0 4px;
      background: #000b; border: 2px solid #fff; border-radius: 50%; color: #fff; font-size: 24px; line-height: 1;
    }
    #ad-gate .gate-sound {
      position: absolute; top: 10px; right: 10px; padding: 5px 11px;
      background: #000a; border: 1px solid #fff3; border-radius: 16px; color: #fff; font-size: 12px;
    }
    #ad-gate .gate-badge { position: absolute; top: 10px; left: 10px; padding: 3px 9px; background: #000a; border-radius: 12px; color: #ddd; font-size: 11px; letter-spacing: 0.5px; }
    #ad-gate .gate-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: #ffffff22; }
    #ad-gate .gate-bar i { display: block; width: 0; height: 100%; background: #e6a7d4; transition: width 0.25s linear; }

    #img-viewer, #img-viewer:focus, #img-viewer:focus-visible {
      width: fit-content;
      height: fit-content;
      max-width: 96vw;
      max-height: 96vh;
      margin: auto;
      padding: 0;
      overflow: visible;
      background: transparent;
      border: 0;
      outline: 0;
      box-shadow: none;
    }
    #img-viewer[open] { display: block; }
    #img-viewer img { display: block; width: min(90vw, 90vh, 768px); height: auto; aspect-ratio: 1 / 1; object-fit: contain; border: 0; outline: 0; border-radius: 14px; cursor: zoom-out; }
  `;
  document.head.append(css);
})();

function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
}

function iconButton(name, label, onclick, on) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-act' + (on ? ' on' : '');
  b.innerHTML = svgIcon(name);
  b.setAttribute('aria-label', label);
  b.title = label;
  b.onclick = () => onclick(b);
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
          if (m.thumb) {
            const pic = document.createElement('img');
            pic.className = 'attach-thumb';
            pic.src = m.thumb;
            pic.alt = 'Image you attached';
            pic.title = 'Click to enlarge';
            pic.onclick = () => openViewer(m.attach || m.thumb, pic.alt);
            body.prepend(pic);
          }
          if (m.image) {
            const image = document.createElement('img');
            image.className = 'generated-image';
            image.src = m.image;
            image.alt = m.prompt || 'Generated image';
            image.title = 'Click to enlarge';
            image.onclick = () => openViewer(m.image, image.alt);
            body.append(image);
          }
          item.append(body);
        }

        // Action buttons
        if (!busy && editingIndex !== i) {
          if (m.role === 'user' && /^\/image\s/i.test(m.content)) {
            // no edit button for image requests
          } else if (m.role === 'user') {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            actions.append(iconButton('edit', 'Edit message', () => {
              editingIndex = i;
              render();
              $('.edit-area')?.focus();
            }));
            item.append(actions);
          } else if (m.role === 'assistant') {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            if (!m.image) actions.append(iconButton('copy', 'Copy', async btn => {
              await copyText(m.content, 'Reply copied');
              btn.innerHTML = svgIcon('check');
              setTimeout(() => { btn.innerHTML = svgIcon('copy'); }, 1400);
            }));
            const up = iconButton('up', 'Good response', () => rate(m, 'up'), m.rating === 'up');
            const down = iconButton('down', 'Bad response', () => rate(m, 'down'), m.rating === 'down');
            up.setAttribute('aria-pressed', String(m.rating === 'up'));
            down.setAttribute('aria-pressed', String(m.rating === 'down'));
            actions.append(up, down);
            if (m.image) actions.append(iconButton('download', 'Download image', () => downloadImage(m)));
            if (i === lastIndex) actions.append(iconButton('retry', 'Retry', regenerate));
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
    }
    if (busy && !streaming) {
      const pending = document.createElement('div');
      pending.className = 'pending';
      pending.textContent = pendingText;
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
    chat.messages.push({ role: 'user', content: text, thumb: message.thumb, attach: message.attach });
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
  send.disabled = !busy && !msg.value.trim() && !pendingImage;
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
    .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.image && !/^\/image\s/i.test(m.content))
    .map(({ role, content, attach }) => ({ role, content, attach }));
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
  if (!text && pendingImage) text = 'Please read this image and help me with it. If it contains a question or problem, solve it step by step.';
  if (!text || busy) return;

  // "/image a red fox in the snow" makes an image (after the ad)
  if (!pendingImage && /^\/image\s+/i.test(text)) {
    const prompt = text.replace(/^\/image\s+/i, '').trim();
    if (!prompt) return;
    if (prompt.length > 500) return toast('Keep image descriptions under 500 characters.');
    await generateImage(prompt, false);
    return;
  }

  // plain-English image request (the ad window appears first, and Cancel puts your words back)
  const ask = pendingImage ? null : text.match(IMAGE_ASK);
  if (ask) {
    const rest = ask[3].replace(/[.!?\s]+$/, '').trim();
    // keep the kind of picture when it matters ("a logo for my shop"), drop it for plain "image of ..."
    const generic = /^(image|images|picture|pictures|photo|photos|photograph)$/i.test(ask[1]);
    const prompt = generic ? rest : ask[1].toLowerCase().replace(/s$/, '') + ' ' + ask[2].toLowerCase() + ' ' + rest;
    if (prompt && prompt.length <= 500) {
      await generateImage(prompt, false, text);
      return;
    }
  }

  let chat = current();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: text.slice(0, 42), messages: [], created: new Date().toISOString() };
    chats.unshift(chat);
    active = chat.id;
  }
  editingIndex = null;
  const userMessage = { role: 'user', content: text };
  if (pendingImage) {
    userMessage.thumb = pendingImage.thumb;
    userMessage.attach = pendingImage.full;
    clearAttachment();
  }
  chat.messages.push(userMessage);
  if ($('#notice')) $('#notice').hidden = true;
  persist();
  render();
  await respond(chat);
}

async function regenerate() {
  if (busy) return;
  const chat = current();
  if (!chat) return;
  const last = chat.messages.at(-1);
  if (last?.image) return generateImage(last.prompt, true); // new image (needs the ad again)
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
        ...imagePayload(historyFor(chat)),
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

// "generate an image of a dog", "can you draw a picture of a cat"... starts the image flow without typing /image
const IMAGE_ASK = /^(?:(?:please|pls|hey|chief)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|render|produce|design|show me|give me)\s+(?:me\s+)?(?:an?|the|some)?\s*(image|images|picture|pictures|photo|photos|photograph|drawing|illustration|painting|artwork|portrait|wallpaper|logo)\s+(of|showing|with|depicting|for)\s+(.{2,})$/i;

// ---------- Images: watch a video ad, then generate ----------
function pingUrl(url) {
  if (!url) return;
  try {
    const img = new Image();
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.src = url.replace(/\[(CACHEBUSTING|TIMESTAMP|RANDOM)\]/g, String(Date.now())).replace(/\[ERRORCODE\]/g, '900');
  } catch {}
}

// Loads a VAST video ad (following up to 3 wrappers). Tries your ad server directly, then through your own server.
async function loadVast(url, depth = 0, acc = { impressions: [], tracking: {}, clicks: [] }) {
  let text;
  try {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw Error('bad status');
    text = await r.text();
  } catch {
    if (depth > 0) throw Error('no ad');
    const r = await fetch('/api/ad/vast');
    if (!r.ok) throw Error('no ad');
    text = await r.text();
  }
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw Error('bad ad');
  const val = el => (el?.textContent || '').trim();
  doc.querySelectorAll('Impression').forEach(n => acc.impressions.push(val(n)));
  doc.querySelectorAll('Tracking').forEach(n => {
    const ev = n.getAttribute('event');
    (acc.tracking[ev] = acc.tracking[ev] || []).push(val(n));
  });
  doc.querySelectorAll('ClickTracking').forEach(n => acc.clicks.push(val(n)));
  const wrapper = val(doc.querySelector('Wrapper VASTAdTagURI'));
  if (wrapper && depth < 3) return loadVast(wrapper, depth + 1, acc);

  const files = [...doc.querySelectorAll('MediaFile')]
    .map(n => ({ url: val(n), type: n.getAttribute('type') || '', w: Number(n.getAttribute('width')) || 0, delivery: n.getAttribute('delivery') || '' }))
    .filter(f => f.url && /^video\/(mp4|webm)/.test(f.type) && f.delivery !== 'streaming');
  if (!files.length) throw Error('no ad');
  const mp4 = files.filter(f => f.type === 'video/mp4');
  const pool = (mp4.length ? mp4 : files).sort((x, y) => y.w - x.w);
  const maxWidth = window.innerWidth < 700 ? 640 : 854;
  acc.media = (pool.find(f => f.w <= maxWidth) || pool[pool.length - 1]).url;
  acc.clickThrough = val(doc.querySelector('ClickThrough'));
  return acc;
}

function buildAdGate() {
  let dlg = $('#ad-gate');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'ad-gate';
  dlg.setAttribute('aria-labelledby', 'ad-gate-title');
  dlg.innerHTML =
    '<h3 id="ad-gate-title">Watch a short ad to create your image</h3>' +
    '<p>Your image starts after you have watched ' + AD_SECONDS + ' seconds of the ad.</p>' +
    '<div class="gate-stage"><video class="gate-video" playsinline preload="auto" disablepictureinpicture controlslist="nodownload noplaybackrate nofullscreen"></video>' +
    '<button type="button" class="gate-tap" hidden aria-label="Play ad">▶</button>' +
    '<span class="gate-badge">AD</span><button type="button" class="gate-sound" hidden>Sound off</button>' +
    '<div class="gate-bar"><i></i></div></div>' +
    '<div class="gate-status" role="status" aria-live="polite"></div>' +
    '<div class="gate-actions"><button type="button" class="gate-btn" id="gate-watch">Watch ad</button>' +
    '<button type="button" class="gate-btn ghost" id="gate-cancel">Cancel</button></div>';
  document.body.append(dlg);
  return dlg;
}

// Plays the video ad. Resolves with a server ticket after AD_SECONDS of real playback, or null if cancelled.
function watchAdGate() {
  return new Promise(resolve => {
    const dlg = buildAdGate();
    const stage = dlg.querySelector('.gate-stage');
    const video = dlg.querySelector('.gate-video');
    const bar = dlg.querySelector('.gate-bar i');
    const soundBtn = dlg.querySelector('.gate-sound');
    const tap = dlg.querySelector('.gate-tap');
    video.controls = false;
    const status = dlg.querySelector('.gate-status');
    const watch = dlg.querySelector('#gate-watch');
    const cancel = dlg.querySelector('#gate-cancel');

    let ad = null, ticketPromise = null, ticket = null;
    let watched = 0, lastTime = 0, started = false, unlocked = false, finished = false, watchdog = 0;
    const fired = new Set();

    const say = (text, warn) => {
      status.textContent = text;
      status.classList.toggle('warn', !!warn);
    };
    const fire = name => {
      if (fired.has(name) || !ad) return;
      fired.add(name);
      (ad.tracking[name] || []).forEach(pingUrl);
    };
    const reset = () => {
      clearTimeout(watchdog);
      tap.hidden = true;
      stage.classList.remove('show');
      video.pause();
      video.removeAttribute('src');
      video.load();
      bar.style.width = '0%';
      soundBtn.hidden = true;
      watched = lastTime = 0;
      started = unlocked = false;
      fired.clear();
      ad = ticketPromise = ticket = null;
    };

    function finish(value) {
      if (finished) return;
      finished = true;
      document.removeEventListener('visibilitychange', onVisibility);
      dlg.removeEventListener('cancel', onEsc);
      video.onplaying = video.ontimeupdate = video.onended = video.onerror = video.onclick = video.onpause = video.onplay = null;
      reset();
      if (dlg.open) dlg.close();
      resolve(value);
    }
    const onEsc = e => { e.preventDefault(); finish(null); };
    const onVisibility = () => {
      if (!ad) return;
      if (document.hidden) video.pause();
      else if (!video.ended && !unlocked) video.play().catch(() => { tap.hidden = false; });
    };
    document.addEventListener('visibilitychange', onVisibility);
    dlg.addEventListener('cancel', onEsc);

    const needed = () => Math.min(AD_SECONDS, Math.max(3, (video.duration || AD_SECONDS) - 0.5));

    async function unlock() {
      if (unlocked) return;
      unlocked = true;
      try {
        ticket = await ticketPromise;
      } catch (e) {
        unlocked = false;
        say(e.message || 'Could not unlock your image. Please try again.', true);
        return;
      }
      say('Thanks for watching! Press the button to create your image, or let the ad finish.');
      watch.disabled = false;
      watch.textContent = 'Create image';
      watch.onclick = () => finish(ticket);
    }

    video.onplaying = () => {
      clearTimeout(watchdog);
      tap.hidden = true;
      if (started) return;
      started = true;
      ad.impressions.forEach(pingUrl);
      fire('creativeView');
      fire('start');
    };
    video.ontimeupdate = () => {
      const t = video.currentTime;
      const delta = t - lastTime;
      lastTime = t;
      if (!document.hidden && !video.paused && video.readyState >= 3 && delta > 0 && delta < 1.5) watched += delta;
      const need = needed();
      bar.style.width = Math.min(100, (watched / need) * 100) + '%';
      const pct = video.duration ? t / video.duration : 0;
      if (pct >= 0.25) fire('firstQuartile');
      if (pct >= 0.5) fire('midpoint');
      if (pct >= 0.75) fire('thirdQuartile');
      if (!unlocked) {
        if (watched >= need) unlock();
        else say('Your image unlocks in ' + Math.ceil(need - watched) + 's');
      }
    };
    video.onended = async () => {
      fire('complete');
      if (watched < needed() - 1) return;
      if (!unlocked) await unlock();
      if (ticket) finish(ticket);
    };
    let autoTries = 0; // ads are auctioned each time, so one that fails is simply replaced (up to 2 more tries)
    video.onerror = () => {
      if (finished) return;
      reset();
      if (autoTries < 2) {
        autoTries++;
        say('Finding another ad…');
        startAd();
        return;
      }
      say('The ad couldn’t play. If you use an ad blocker, turn it off for this site and try again.', true);
      watch.disabled = false;
      watch.textContent = 'Try again';
      autoTries = 0;
    };
    video.onpause = () => { if (!video.ended && stage.classList.contains('show') && !document.hidden && !finished) tap.hidden = false; };
    video.onplay = () => { tap.hidden = true; };
    tap.onclick = () => {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };
    video.onclick = () => {
      if (video.paused) return tap.onclick();
      if (!ad?.clickThrough) return;
      window.open(ad.clickThrough, '_blank');
      (ad.clicks || []).forEach(pingUrl);
      (ad.tracking.click || []).forEach(pingUrl);
    };
    soundBtn.onclick = () => {
      video.muted = !video.muted;
      soundBtn.textContent = video.muted ? 'Sound off' : 'Sound on';
    };
    cancel.onclick = () => finish(null);

    watch.disabled = false;
    watch.textContent = 'Watch ad';
    say('');
    async function startAd() {
      watch.disabled = true;
      watch.textContent = 'Loading ad…';
      // the server ticket starts its clock now, so the wait can't be skipped by editing the page
      ticketPromise = fetch('/api/image/start', { method: 'POST' }).then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.token) throw Error(data.error || 'Could not start. Please try again.');
        return data.token;
      });
      ticketPromise.catch(() => {});
      try {
        ad = await loadVast(VAST_URL);
      } catch {
        ad = null;
        if (autoTries < 2 && !finished) {
          autoTries++;
          say('Finding another ad…');
          await new Promise(r => setTimeout(r, 500));
          return startAd();
        }
        autoTries = 0;
        say('No ad is available right now. Please try again in a moment.', true);
        watch.disabled = false;
        watch.textContent = 'Try again';
        return;
      }
      stage.classList.add('show');
      video.src = ad.media;
      video.muted = false;
      // if the ad never starts (blocked, broken file), say so instead of waiting forever
      watchdog = setTimeout(() => { if (!started && !finished) video.onerror(); }, 12000);
      try {
        await video.play();
      } catch {
        video.muted = true; // the browser wants sound off until tapped
        try { await video.play(); } catch {}
      }
      soundBtn.hidden = false;
      soundBtn.textContent = video.muted ? 'Sound off' : 'Sound on';
      watch.textContent = 'Watching…';
      say('Your image unlocks in ' + AD_SECONDS + 's');
    }
    watch.onclick = () => {
      autoTries = 0;
      say('');
      startAd();
    };

    dlg.showModal();
  });
}

async function generateImage(prompt, replaceLast, original) {
  if (busy) return;
  const ticket = await watchAdGate();
  if (!ticket) {
    // cancelled: put the request back in the message box
    const field = $('#message');
    if (field && !replaceLast) {
      field.value = original || '/image ' + prompt;
      field.dispatchEvent(new Event('input'));
      field.focus();
    }
    return;
  }

  let chat = current();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: prompt.slice(0, 42), messages: [], created: new Date().toISOString() };
    chats.unshift(chat);
    active = chat.id;
  }
  if (replaceLast) {
    // swap the old image (and its request) for the new one
    while (chat.messages.length && chat.messages.at(-1).role !== 'user') chat.messages.pop();
    if (/^\/image\s/i.test(chat.messages.at(-1)?.content || '')) chat.messages.pop();
  }
  editingIndex = null;
  chat.messages.push({ role: 'user', content: '/image ' + prompt });
  busy = true;
  pendingText = 'Creating your image…';
  controller = new AbortController();
  persist();
  render();
  scrollToEnd();
  const timer = setTimeout(() => controller?.abort(), 60000);

  try {
    const response = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, token: ticket }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.image) throw Error(data.error || 'Image generation failed.');
    chat.messages.push({ role: 'assistant', content: 'Here is your generated image.', image: data.image, prompt });
  } catch (error) {
    chat.messages.push({
      role: 'notice',
      content: error.name === 'AbortError' ? 'Image stopped.' : error.message
    });
  } finally {
    clearTimeout(timer);
    busy = false;
    controller = null;
    pendingText = 'Chief is thinking…';
    persist();
    render();
    scrollToEnd();
  }
}

async function downloadImage(m) {
  try {
    const r = await fetch(m.image);
    if (!r.ok) throw Error('download failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chief-image-' + Date.now() + '.' + ((blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Image downloaded');
  } catch {
    // the image host may not allow direct downloads: open it so it can be saved by hand
    window.open(m.image, '_blank');
    toast('Opened the image in a new tab. Right-click or long-press it to save.');
  }
}

function openViewer(src, alt) {
  let dlg = $('#img-viewer');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'img-viewer';
    dlg.append(document.createElement('img'));
    dlg.addEventListener('click', () => dlg.close());
    document.body.append(dlg);
  }
  const img = dlg.querySelector('img');
  img.src = src;
  img.alt = alt || 'Generated image';
  dlg.showModal();
}

// ---------- Attaching pictures (screenshots, maths questions, photos) ----------
const ATTACH_TYPES = /^image\/(png|jpe?g|webp|gif)$/i;

function scaleToJpeg(bitmap, maxSide, quality) {
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent screenshots get a white background
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

async function attachFile(file) {
  if (!file) return;
  if (!ATTACH_TYPES.test(file.type)) return toast('Please choose a PNG, JPG, WebP or GIF picture.');
  if (file.size > 20 * 1024 * 1024) return toast('That picture is too large (20 MB max).');
  try {
    const bitmap = await createImageBitmap(file);
    let full = scaleToJpeg(bitmap, 1600, 0.9);
    if (full.length > 2000000) full = scaleToJpeg(bitmap, 1200, 0.8);
    if (full.length > 2000000) full = scaleToJpeg(bitmap, 900, 0.7);
    pendingImage = { full, thumb: scaleToJpeg(bitmap, 240, 0.7) };
    showAttachment();
    updateSend();
    $('#message')?.focus();
  } catch {
    toast('Couldn’t read that picture. Try a different one.');
  }
}

function clearAttachment() {
  pendingImage = null;
  showAttachment();
  updateSend();
}

function showAttachment() {
  let box = $('#attach-preview');
  if (!box) {
    box = document.createElement('div');
    box.id = 'attach-preview';
    box.className = 'attach-preview';
    box.hidden = true;
    const img = document.createElement('img');
    img.alt = 'Attached picture';
    const label = document.createElement('span');
    label.textContent = 'Picture attached';
    const x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove picture');
    x.title = 'Remove picture';
    x.textContent = '×';
    x.onclick = clearAttachment;
    box.append(img, label, x);
    $('#composer')?.prepend(box);
  }
  box.hidden = !pendingImage;
  if (pendingImage) box.querySelector('img').src = pendingImage.thumb;
}

// the newest attached picture in the conversation goes to the server with the request
function imagePayload(history) {
  let imageAt = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].attach) { imageAt = i; break; }
  }
  const payload = { messages: history.map(({ role, content }) => ({ role, content })) };
  if (imageAt >= 0) {
    payload.image = history[imageAt].attach;
    payload.imageAt = imageAt;
  }
  return payload;
}

function initAttach() {
  const form = $('#composer');
  const field = $('#message');
  if (!form || !field) return;

  const css = document.createElement('style');
  css.textContent = `
    .tool-btn {
      display: flex; align-items: center; justify-content: center; flex: 0 0 38px;
      width: 38px; height: 38px; padding: 0; line-height: 0;
      background: transparent; border: 1px solid #3a3a40; border-radius: 50%; color: #cfcbd8;
      transition: background 0.18s, color 0.18s;
    }
    .tool-btn:hover { background: #222226; color: #fff; filter: none; }
    .tool-btn svg { display: block; width: 18px; height: 18px; }
    .attach-preview {
      display: flex; align-items: center; gap: 10px; width: fit-content; max-width: 100%;
      margin: 0 0 12px; padding: 6px 8px 6px 6px; background: #19191c; border: 1px solid #38383c; border-radius: 12px;
      color: #b9b5c2; font-size: 13px;
    }
    .attach-preview[hidden] { display: none; }
    .attach-preview img { display: block; width: 44px; height: 44px; object-fit: cover; border-radius: 8px; }
    .attach-preview button { padding: 0 6px; background: none; border: 0; color: #a9a5b3; font-size: 20px; line-height: 1; }
    .attach-preview button:hover { color: #fff; filter: none; }
    .message-body .attach-thumb {
      display: block; width: auto; height: auto; max-width: min(100%, 220px); max-height: 220px;
      margin: 0 0 10px; border: 1px solid #39343f; border-radius: 10px; cursor: zoom-in;
    }
    form#composer.drop { border-color: #e6a7d4; }
  `;
  document.head.append(css);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.hidden = true;
  input.onchange = () => {
    attachFile(input.files[0]);
    input.value = '';
  };
  document.body.append(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tool-btn';
  btn.title = 'Attach a picture';
  btn.setAttribute('aria-label', 'Attach a picture');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  btn.onclick = () => input.click();
  const anchor = $('#mic') || $('#send');
  anchor.parentNode.insertBefore(btn, anchor);

  // paste a screenshot straight into the box
  field.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && ATTACH_TYPES.test(i.type));
    if (item) {
      e.preventDefault();
      attachFile(item.getAsFile());
    }
  });
  // or drag a picture onto the message box
  form.addEventListener('dragover', e => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      form.classList.add('drop');
    }
  });
  form.addEventListener('dragleave', () => form.classList.remove('drop'));
  form.addEventListener('drop', e => {
    form.classList.remove('drop');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      e.preventDefault();
      attachFile(file);
    }
  });
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
    if (!text && !pendingImage) return;
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

// Voice input: the browser's speech recognition types what you say, and the mic button shows live sound bars
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRec && $('#mic')) {
  const mic = $('#mic');
  const bars = [...mic.querySelectorAll('.bars i')];
  const field = $('#message');
  const placeholder = field.placeholder;
  mic.hidden = false;
  let rec = null, listening = false;
  let stream = null, audioCtx = null, analyser = null, levels = null, raf = 0;

  async function startMeter() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!listening) return stopMeter(); // stopped while waiting for permission
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      levels = new Uint8Array(analyser.frequencyBinCount);
      const bins = [2, 4, 1, 3, 5]; // spread across the voice range so the bars move independently
      const draw = () => {
        analyser.getByteFrequencyData(levels);
        bars.forEach((bar, i) => {
          const v = Math.min(1, levels[bins[i]] / 170);
          bar.style.transform = 'scaleY(' + (0.18 + v * 0.82).toFixed(2) + ')';
        });
        raf = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      mic.classList.add('fallback'); // no level access: use the looping animation instead
    }
  }

  function stopMeter() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    audioCtx?.close().catch(() => {});
    stream = audioCtx = analyser = null;
    mic.classList.remove('fallback');
    bars.forEach(b => { b.style.transform = ''; });
  }

  mic.onclick = () => {
    if (listening) {
      rec?.stop();
      return;
    }
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
        toast(e.error === 'not-allowed' ? 'Microphone access was blocked.' : e.error === 'no-speech' ? 'Didn’t hear anything. Try again.' : 'Voice input stopped.');
      };
      rec.onend = () => {
        listening = false;
        stopMeter();
        mic.classList.remove('on');
        mic.setAttribute('aria-pressed', 'false');
        mic.setAttribute('aria-label', 'Voice input');
        field.placeholder = placeholder;
        field.focus();
      };
      rec.start();
      listening = true;
      mic.classList.add('on');
      mic.setAttribute('aria-pressed', 'true');
      mic.setAttribute('aria-label', 'Stop voice input');
      field.placeholder = 'Listening…';
      startMeter();
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
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), chats }, (k, v) => (k === 'attach' ? undefined : v), 2)], { type: 'application/json' });
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
initAttach();
applyPrefs();
render();
health();
// Only poll while the tab is visible
setInterval(() => { if (!document.hidden) health(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) health(); });
