/* Chat Export Viewer — UI controller.
 * Messages are rendered through a sliding window (at most MAX_ROWS in the DOM) so even
 * very large chats open instantly and scroll smoothly. */
(function () {
  'use strict';

  const { esc, format, mark, isEmojiOnly } = window.WAFormat;
  const Parser = window.WAParser;

  const CHUNK = 120;        // rows added per batch while scrolling
  const MAX_ROWS = 480;     // rows kept in the DOM at once
  const EDGE = 1500;        // px from an edge that triggers loading more rows
  const LONG_TEXT = 1800;   // characters before a message gets "Read more"
  const NAME_COLORS = ['#e542a3', '#1f7aec', '#dc7a2c', '#02a698', '#91ab01', '#7f66ff', '#d3396d', '#00a0d1', '#c45c00', '#53a653', '#a259ff', '#e2453c', '#008f68', '#b4876e', '#6e6ad6', '#d6599c'];
  const OMIT = {
    media: ['image', 'Media'], image: ['image', 'Photo'], video: ['video', 'Video'], audio: ['mic', 'Audio'],
    sticker: ['sticker', 'Sticker'], gif: ['video', 'GIF'], document: ['doc', 'Document'],
    contact: ['person', 'Contact card'], once: ['image', 'View once media']
  };
  const FILE_ICON = { img: 'image', stk: 'sticker', vid: 'video', voice: 'mic', audio: 'music', vcf: 'person', doc: 'doc' };
  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/x-matroska',
    opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav',
    amr: 'audio/amr', weba: 'audio/webm', pdf: 'application/pdf', vcf: 'text/vcard', txt: 'text/plain'
  };
  const TICKS = '<svg class="tick" viewBox="0 0 18 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Read"><path d="M1.5 5.8l3.2 3.2L11.6 1.6"/><path d="M7.4 8.6l.9.9 6.9-7.9"/></svg>';

  const $ = id => document.getElementById(id);
  const ui = {
    app: $('app'), chatList: $('chatList'), chatFilter: $('chatFilter'), welcome: $('welcome'), chat: $('chat'),
    scroller: $('scroller'), rows: $('rows'), fab: $('fab'), floatDate: $('floatDate'),
    headAv: $('headAv'), headTitle: $('headTitle'), headSub: $('headSub'), headWho: $('headWho'),
    drawer: $('drawer'), drawerTitle: $('drawerTitle'), drawerTools: $('drawerTools'), drawerBody: $('drawerBody'),
    searchInput: $('searchInput'), sCount: $('sCount'), sPrev: $('sPrev'), sNext: $('sNext'),
    fileInput: $('fileInput'), mediaInput: $('mediaInput'),
    lightbox: $('lightbox'), lbImg: $('lbImg'), lbWho: $('lbWho'), lbCap: $('lbCap'), lbCount: $('lbCount'),
    lbPrev: $('lbPrev'), lbNext: $('lbNext'), lbDl: $('lbDl'), lbGo: $('lbGo'),
    drop: $('drop'), busy: $('busy'), busyText: $('busyText'),
    modal: $('modal'), modalTitle: $('modalTitle'), modalBody: $('modalBody'), modalActions: $('modalActions'),
    toasts: $('toasts'), themeBtn: $('themeBtn'),
    fabUp: $('fabUp'), scrub: $('scrub'), scrubThumb: $('scrubThumb'), scrubTip: $('scrubTip'),
    railCount: $('railCount'), railMedia: $('railMedia'), chips: $('chips')
  };

  const state = { chats: [], active: null, drawer: null, listFilter: 'all' };
  let seq = 0;

  /* ---------- small helpers ---------- */
  const icon = (name, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const pad = n => String(n).padStart(2, '0');
  const isMobile = () => matchMedia('(max-width: 767px)').matches;
  const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
  const num = n => Number(n || 0).toLocaleString();

  // Anonymous product analytics (see js/analytics.js). Never send chat content, names or file names.
  function track(event, props) {
    try { if (typeof window.plausible === 'function') window.plausible(event, props ? { props } : undefined); } catch (e) { /* ignore */ }
  }
  const sizeBucket = n => n < 1e3 ? '<1k' : n < 1e4 ? '1k-10k' : n < 1e5 ? '10k-100k' : '100k+';

  const MAX_ZIP_BYTES = 2 * 1024 ** 3; // browsers can't hold larger archives in memory
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Exports carry no profile photos, so everyone gets WhatsApp's default grey silhouette.
  function avatarHTML(cls, group) {
    return '<span class="av' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><svg viewBox="0 0 212 212"><use href="#i-avatar' + (group ? '-group' : '') + '"/></svg></span>';
  }

  const fmts = {};
  const fmt = (key, opts) => fmts[key] || (fmts[key] = new Intl.DateTimeFormat(undefined, opts));
  const timeStr = (ts, h12) => fmt('t' + !!h12, { hour: 'numeric', minute: '2-digit', hour12: !!h12 }).format(ts);
  const startOfDay = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const daysAgo = ts => Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 864e5);
  const shortDate = ts => fmt('sd', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
  const longDate = ts => fmt('ld', { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
  const dayKey = ts => { const d = new Date(ts); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const fmtDur = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); };
  const fmtSize = b => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' kB' : (b / 1048576).toFixed(1) + ' MB';
  const toISO = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

  function dayLabel(ts) {
    const n = daysAgo(ts);
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    if (n > 1 && n < 7) return fmt('wd', { weekday: 'long' }).format(ts);
    return fmt('long', { day: 'numeric', month: 'long', year: 'numeric' }).format(ts);
  }

  function listTime(ts, h12) {
    const n = daysAgo(ts);
    if (n === 0) return timeStr(ts, h12);
    if (n === 1) return 'Yesterday';
    if (n > 1 && n < 7) return fmt('wd', { weekday: 'long' }).format(ts);
    return shortDate(ts);
  }

  // iOS prefixes attachments with a sequence number: "00000012-PHOTO-2020-…jpg"
  const displayName = f => String(f).replace(/^\d{8}-/, '');

  /* ---------- chats ---------- */
  function titleFromName(name) {
    if (!name) return null;
    const m = /WhatsApp Chat(?: with| -| mit| con| avec| com| met| med| z)?\s*(.+?)(?:\s*\(\d+\))?\.(?:txt|zip)$/i.exec(name);
    return m && m[1].trim() ? m[1].trim() : null;
  }

  function guessMe(parsed, title) {
    const ps = parsed.participants;
    if (parsed.youDeleted) return { me: parsed.youDeleted, sure: true };
    if (title && ps.length === 2) {
      const t = title.toLowerCase();
      const hit = ps.find(p => p.toLowerCase() === t);
      if (hit) return { me: ps.find(p => p !== hit), sure: true };
    }
    if (!ps.length) return { me: null, sure: true };
    if (ps.length === 1) return { me: null, sure: false };
    return { me: ps.length === 2 ? ps[1] : ps[0], sure: false };
  }

  function buildRows(chat) {
    const rows = [{ k: 'n' }];
    let last = null;
    for (const m of chat.msgs) {
      const d = dayKey(m.ts);
      if (d !== last) { rows.push({ k: 'd', ts: m.ts }); last = d; }
      m.r = rows.length;
      rows.push({ k: 'm', m });
    }
    chat.rows = rows;
  }

  function applyParsed(chat, parsed) {
    chat.parsed = parsed;
    chat.msgs = parsed.messages;
    chat.h12 = parsed.hasAmPm;
    chat.isGroup = parsed.participants.length > 2 || !!parsed.groupName || parsed.groupHints;
    chat.colors = new Map(parsed.participants.map((p, i) => [p, NAME_COLORS[i % NAME_COLORS.length]]));
    chat.stats = null;
    chat.gallery = null;
    chat.saved = null;
    chat.search = { q: '', hits: [], pos: -1, re: null };
    buildRows(chat);
  }

  function addChat(text, names, media) {
    names = [].concat(names).filter(Boolean);
    const parsed = Parser.parse(text);
    if (!parsed.messages.length) throw new Error('No messages found in ' + (names[0] || 'that file') + '. Is it a WhatsApp chat export?');
    const fileTitle = names.map(titleFromName).find(Boolean) || null;
    const chat = {
      id: ++seq, names, text, media: media || new Map(),
      urls: new Map(), ratios: new Map(), durs: new Map(), vcards: new Map(), expanded: new Set(),
      lo: 0, hi: 0
    };
    applyParsed(chat, parsed);
    const g = guessMe(parsed, fileTitle || parsed.systemName);
    chat.me = g.me;
    chat.askMe = !g.sure;
    chat.title = fileTitle || parsed.groupName || parsed.systemName || defaultTitle(chat);
    state.chats.push(chat);
    renderChatList();
    updateEmpty();
    return chat;
  }

  function defaultTitle(chat) {
    const others = chat.parsed.participants.filter(p => p !== chat.me);
    if (!others.length) return 'Chat';
    if (others.length === 1) return others[0];
    return others.slice(0, 3).join(', ') + (others.length > 3 ? ' +' + (others.length - 3) : '');
  }

  function removeChat(chat) {
    const i = state.chats.indexOf(chat);
    if (i < 0) return;
    state.chats.splice(i, 1);
    chat.urls.forEach(p => p.then(u => u && URL.revokeObjectURL(u)));
    if (state.active === chat) {
      stopVoice();
      closeDrawer();
      state.active = null;
      ui.chat.hidden = true;
      ui.welcome.hidden = false;
      ui.rows.innerHTML = '';
      ui.app.classList.remove('chat-open');
    }
    renderChatList();
    updateEmpty();
  }

  function updateEmpty() {
    ui.app.classList.toggle('empty', !state.chats.length);
  }

  function lastMsg(chat) {
    for (let i = chat.msgs.length - 1; i >= 0; i--) if (chat.msgs[i].kind !== 'system') return chat.msgs[i];
    return chat.msgs[chat.msgs.length - 1];
  }

  function summary(m) {
    switch (m.kind) {
      case 'media': {
        const label = { img: '📷 Photo', stk: '💟 Sticker', vid: '🎥 Video', voice: '🎤 Voice message', audio: '🎵 Audio', vcf: '👤 Contact' }[m.ftype];
        if (m.text) return (label ? label.split(' ')[0] : '📄') + ' ' + m.text.split('\n')[0];
        return label || '📄 ' + displayName(m.file);
      }
      case 'omitted': return '📎 ' + (OMIT[m.otype] || OMIT.media)[1] + ' omitted';
      case 'deleted': return '🚫 This message was deleted';
      case 'call': return '📞 ' + m.text.split(',')[0];
      case 'location': return '📍 Location';
      case 'poll': return '📊 ' + m.poll.question;
      default: return (m.text || '').split('\n')[0];
    }
  }

  /* ---------- media ---------- */
  function mediaMap(files) {
    const map = new Map();
    for (const f of files) map.set(f.name.toLowerCase(), { size: f.size, blob: () => Promise.resolve(f) });
    return map;
  }

  const getMedia = (chat, name) => name ? chat.media.get(String(name).toLowerCase()) : null;

  function mediaURL(chat, name) {
    const key = String(name).toLowerCase();
    let p = chat.urls.get(key);
    if (!p) {
      const entry = chat.media.get(key);
      if (!entry) return Promise.resolve(null);
      p = entry.blob()
        .then(b => URL.createObjectURL(b.type ? b : new Blob([b], { type: MIME[extOf(name)] || 'application/octet-stream' })))
        .catch(() => null);
      chat.urls.set(key, p);
    }
    return p;
  }

  const mediaIO = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      mediaIO.unobserve(e.target);
      loadMedia(state.active, e.target);
    }
  }, { root: ui.scroller, rootMargin: '1200px 0px' });

  function observeMedia(root) {
    root.querySelectorAll('[data-f]:not([data-obs])').forEach(n => { n.dataset.obs = '1'; mediaIO.observe(n); });
  }

  function unobserveMedia(node) {
    node.querySelectorAll('[data-f]').forEach(n => mediaIO.unobserve(n));
  }

  async function loadMedia(chat, node) {
    if (!chat || node.dataset.ld) return;
    node.dataset.ld = '1';
    const name = node.dataset.f;
    const url = await mediaURL(chat, name);
    if (!url) { node.classList.add('err'); return; }
    const key = name.toLowerCase();
    switch (node.dataset.t) {
      case 'img':
      case 'stk': {
        const img = node.querySelector('img');
        img.onload = () => {
          node.classList.add('ok');
          if (node.dataset.t === 'img' && img.naturalWidth) {
            const r = Math.min(1.9, Math.max(0.62, img.naturalWidth / img.naturalHeight));
            chat.ratios.set(key, r.toFixed(3));
            node.style.aspectRatio = r.toFixed(3);
          }
        };
        img.onerror = () => node.classList.add('err');
        img.src = url;
        break;
      }
      case 'vid':
        node.querySelector('video').src = url;
        break;
      case 'voice': {
        node.dataset.url = url;
        if (!chat.durs.has(key)) {
          const a = new Audio();
          a.preload = 'metadata';
          a.addEventListener('loadedmetadata', () => {
            if (isFinite(a.duration)) {
              chat.durs.set(key, a.duration);
              const live = node.isConnected ? node : ui.rows.querySelector('.voice[data-f="' + CSS.escape(name) + '"]');
              if (live && voiceKey !== name) live.querySelector('.v-time').textContent = fmtDur(a.duration);
            }
          }, { once: true });
          a.src = url;
        }
        break;
      }
      case 'vcf':
        node.href = url;
        if (!chat.vcards.has(key)) {
          fetch(url).then(r => r.text()).then(t => {
            const fn = /^FN[^:]*:(.+)$/m.exec(t);
            chat.vcards.set(key, fn ? fn[1].trim() : 'Contact');
            const d = node.querySelector('.dname');
            if (d) d.textContent = chat.vcards.get(key);
          }).catch(() => {});
        }
        break;
      default:
        node.href = url;
    }
  }

  /* ---------- message rendering ---------- */
  function rowHTML(chat, i) {
    const r = chat.rows[i];
    if (r.k === 'n') {
      return '<div class="row note"><span class="pill note">' + icon('lock') +
        'Opened from an export file. This chat stays on your device and is never uploaded.</span></div>';
    }
    if (r.k === 'd') return '<div class="row day"><span class="pill">' + esc(dayLabel(r.ts)) + '</span></div>';
    const m = r.m;
    if (m.kind === 'system') return '<div class="row sys"><span class="pill">' + mark(esc(m.text), chat.search.re) + '</span></div>';
    return msgHTML(chat, i, m);
  }

  function textBlock(chat, m, sp) {
    let t = m.text, more = '';
    if (t.length > LONG_TEXT && !chat.expanded.has(m.id)) {
      t = t.slice(0, 1100).replace(/\s+\S*$/, '') + '…';
      more = '<button class="more" type="button" data-more="' + m.id + '">Read more</button>';
    }
    return '<div class="tx">' + format(t, chat.search.re) + more + sp + '</div>';
  }

  function mediaHTML(chat, m) {
    const f = m.file, t = m.ftype, df = esc(f);
    const entry = getMedia(chat, f);
    if (!entry) {
      return {
        cls: ' file',
        html: '<div class="miss">' + icon(FILE_ICON[t] || 'doc') + '<div class="dmeta"><div class="mname">' + esc(displayName(f)) +
          '</div><div class="msub">Not included in this export</div></div></div>'
      };
    }
    const key = f.toLowerCase();
    switch (t) {
      case 'img':
        return {
          cls: ' media', over: true,
          html: '<div class="mm img" data-t="img" data-f="' + df + '" style="aspect-ratio:' + (chat.ratios.get(key) || '4 / 3') + '"><img alt="Photo" draggable="false" decoding="async"></div>'
        };
      case 'stk':
        return { cls: ' bare', over: true, html: '<div class="mm stk" data-t="stk" data-f="' + df + '"><img alt="Sticker" decoding="async"></div>' };
      case 'vid':
        return { cls: ' media', html: '<div class="mm vid" data-t="vid" data-f="' + df + '"><video controls preload="metadata" playsinline></video></div>' };
      case 'voice':
      case 'audio': {
        const dur = chat.durs.get(key);
        const side = t === 'voice'
          ? avatarHTML() + '<span class="v-mic">' + icon('mic') + '</span>'
          : '<span class="v-music">' + icon('music') + '</span>';
        return {
          cls: '',
          html: '<div class="voice" data-t="voice" data-f="' + df + '">' +
            '<button class="v-play" type="button" aria-label="Play">' + icon('play', 'pl') + icon('pause', 'pz') + '</button>' +
            '<div class="v-track"><div class="v-wave" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' + waveBars(f) +
            '<span class="v-dot"></span></div><span class="v-time">' + (dur ? fmtDur(dur) : '0:00') + '</span></div>' +
            '<span class="v-side">' + side + '<button class="v-speed" type="button" aria-label="Playback speed">' + speedLabel() + '</button></span></div>'
        };
      }
      case 'vcf':
        return {
          cls: ' file',
          html: '<a class="doc" data-t="vcf" data-f="' + df + '" download="' + esc(displayName(f)) + '">' + avatarHTML('md') +
            '<div class="dmeta"><div class="dname">' + esc(chat.vcards.get(key) || 'Contact card') + '</div><div class="dsub">vCard · ' + fmtSize(entry.size) + '</div></div></a>'
        };
      default: {
        const ext = extOf(f).toUpperCase().slice(0, 4);
        return {
          cls: ' file',
          html: '<a class="doc" data-t="doc" data-f="' + df + '" download="' + esc(displayName(f)) + '"><span class="dic" data-ext="' + esc(ext) + '">' + icon('doc') + '</span>' +
            '<div class="dmeta"><div class="dname">' + esc(displayName(f)) + '</div><div class="dsub">' + esc(ext) + (entry.size ? ' · ' + fmtSize(entry.size) : '') + '</div></div>' +
            '<span class="ddl">' + icon('download') + '</span></a>'
        };
      }
    }
  }

  // Exports have no waveform data, so draw a stable pseudo-waveform seeded by the file name.
  const WAVE_BARS = 40;
  function waveBars(name) {
    let x = hash(name) || 1;
    let h = '';
    for (let i = 0; i < WAVE_BARS; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const env = Math.sin(Math.PI * (i + 1) / (WAVE_BARS + 1));
      h += '<i style="height:' + Math.round(14 + (x % 70) * (0.35 + 0.65 * env)) + '%"></i>';
    }
    return h;
  }

  function pollHTML(p) {
    const total = p.options.reduce((s, o) => s + o.votes, 0) || 1;
    return '<div class="poll"><div class="poll-q">' + esc(p.question) + '</div><div class="poll-hint">' + icon('poll') + 'Poll</div>' +
      p.options.map(o => '<div class="poll-o"><div class="poll-l"><span>' + esc(o.label) + '</span><span>' + o.votes + '</span></div>' +
        '<div class="poll-bar"><i style="width:' + Math.round(o.votes / total * 100) + '%"></i></div></div>').join('') + '</div>';
  }

  function msgHTML(chat, i, m) {
    const prev = chat.rows[i - 1];
    const first = !(prev && prev.k === 'm' && prev.m.kind !== 'system' && prev.m.sender === m.sender);
    const out = chat.me != null && m.sender === chat.me;
    const grp = chat.isGroup && !out;
    const time = timeStr(m.ts, chat.h12);
    const spW = Math.ceil(time.length * 6.4) + 14 + (out ? 20 : 0) + (m.edited ? 42 : 0);
    const sp = '<span class="sp" style="width:' + spW + 'px"></span>';
    let bcls = 'bubble', mcls = 'meta', body = '';

    switch (m.kind) {
      case 'media': {
        const res = mediaHTML(chat, m);
        bcls += res.cls;
        body = res.html;
        if (m.text) body += textBlock(chat, m, sp);
        else if (res.over) mcls += ' over';
        else body += '<div class="tx empty">' + sp + '</div>';
        if (m.ftype === 'stk' && res.cls === ' bare') mcls = 'meta';
        break;
      }
      case 'omitted': {
        const o = OMIT[m.otype] || OMIT.media;
        body = '<div class="omit">' + icon(o[0]) + '<span>' + esc(o[1]) + ' omitted</span>' + (m.text ? '' : sp) + '</div>' + (m.text ? textBlock(chat, m, sp) : '');
        break;
      }
      case 'deleted':
        body = '<div class="tx del">' + icon('block') + '<span>' + (out ? 'You deleted this message' : 'This message was deleted') + '</span>' + sp + '</div>';
        break;
      case 'call': {
        const parts = m.text.split(',');
        const missed = /missed/i.test(m.text);
        const detail = parts.slice(1).join(',').trim();
        body = '<div class="call' + (missed ? ' missed' : '') + '"><span class="call-ic">' + icon(/video/i.test(m.text) ? 'video' : 'phone') + '</span><div><div class="call-t">' +
          esc(parts[0]) + '</div>' + (detail && !/tap to call/i.test(detail) ? '<div class="call-s">' + esc(detail) + '</div>' : '') + '</div></div>' +
          '<div class="tx empty">' + sp + '</div>';
        break;
      }
      case 'location':
        body = '<a class="loc" href="' + esc(m.url) + '" target="_blank" rel="noopener noreferrer"><div class="loc-map"><span class="loc-pin">' + icon('pin') + '</span></div>' +
          '<div class="loc-txt">' + icon('pin') + '<span>' + (m.lat != null ? m.lat.toFixed(4) + ', ' + m.lng.toFixed(4) : 'Shared location') + '</span><small>Open map</small></div></a>' +
          '<div class="tx empty">' + sp + '</div>';
        bcls += ' media';
        break;
      case 'poll':
        body = pollHTML(m.poll) + '<div class="tx empty">' + sp + '</div>';
        break;
      default:
        if (isEmojiOnly(m.text)) {
          bcls += ' bare emo';
          body = '<div class="tx">' + esc(m.text.trim()) + '</div>';
        } else {
          body = textBlock(chat, m, sp);
        }
    }

    const sender = grp && first
      ? '<div class="sender" style="color:' + chat.colors.get(m.sender) + '">' + esc(m.sender) + '</div>'
      : '';
    const meta = '<span class="' + mcls + '">' + (m.edited ? '<span class="ed">Edited</span>' : '') + '<time>' + esc(time) + '</time>' + (out ? TICKS : '') + '</span>';
    const avatar = grp ? '<div class="avs">' + (first ? avatarHTML('sm') : '') + '</div>' : '';
    return '<div class="row m ' + (out ? 'out' : 'in') + (first ? ' first' : '') + (grp ? ' g' : '') + '" data-i="' + i + '">' +
      avatar + '<div class="' + bcls + '">' + sender + body + meta +
      '<button class="bm" type="button" aria-label="Message options">' + icon('down') + '</button></div></div>';
  }

  function rangeHTML(chat, lo, hi) {
    let h = '';
    for (let i = lo; i < hi; i++) h += rowHTML(chat, i);
    return h;
  }

  /* ---------- windowed scrolling ---------- */
  function paint(chat, lo, hi) {
    ui.rows.querySelectorAll('[data-f]').forEach(n => mediaIO.unobserve(n));
    ui.rows.innerHTML = rangeHTML(chat, lo, hi);
    chat.lo = lo;
    chat.hi = hi;
    observeMedia(ui.rows);
    syncVoice();
  }

  // Index (into ui.rows.children) of the last row whose top is at or above y.
  function childAt(y) {
    const kids = ui.rows.children;
    let lo = 0, hi = kids.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (kids[mid].offsetTop <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function anchorEl() {
    return ui.rows.children[childAt(ui.scroller.scrollTop + ui.scroller.clientHeight / 3)] || null;
  }

  // Run a DOM mutation without the visible content jumping.
  function keepAnchor(fn) {
    const a = anchorEl();
    const before = a ? a.getBoundingClientRect().top : 0;
    fn();
    if (a && a.isConnected) {
      const d = a.getBoundingClientRect().top - before;
      if (Math.abs(d) > 0.5) ui.scroller.scrollTop += d;
    }
  }

  const atBottom = () => ui.scroller.scrollHeight - ui.scroller.scrollTop - ui.scroller.clientHeight < 60;

  function anchorInfo(chat) {
    if (chat.hi >= chat.rows.length && atBottom()) return { bottom: true };
    const a = anchorEl();
    if (!a) return { bottom: true };
    return { i: chat.lo + Array.prototype.indexOf.call(ui.rows.children, a), off: a.offsetTop - ui.scroller.scrollTop };
  }

  function restoreAnchor(chat, a) {
    stickBottom = !a || !!a.bottom;
    if (stickBottom) { ui.scroller.scrollTop = ui.scroller.scrollHeight; return; }
    const n = ui.rows.children[a.i - chat.lo];
    if (n) ui.scroller.scrollTop = n.offsetTop - a.off;
  }

  // Re-render the current window in place (after a search, perspective change, …).
  function rerender() {
    const chat = state.active;
    if (!chat) return;
    const a = anchorInfo(chat);
    paint(chat, chat.lo, chat.hi);
    restoreAnchor(chat, a);
  }

  function replaceRow(chat, i) {
    const n = ui.rows.children[i - chat.lo];
    if (!n) return;
    unobserveMedia(n);
    n.insertAdjacentHTML('afterend', rowHTML(chat, i));
    n.remove();
    observeMedia(ui.rows);
  }

  function openAt(chat, target, opts) {
    opts = opts || {};
    const n = chat.rows.length;
    let lo, hi;
    if (target === 'end') { hi = n; lo = Math.max(0, n - CHUNK * 2); }
    else { lo = Math.max(0, target - CHUNK); hi = Math.min(n, target + CHUNK); }
    paint(chat, lo, hi);
    stickBottom = target === 'end';
    if (target === 'end') {
      ui.scroller.scrollTop = ui.scroller.scrollHeight;
    } else {
      const node = ui.rows.children[target - lo];
      if (node) {
        const top = opts.top ? node.offsetTop - 56 : node.offsetTop - (ui.scroller.clientHeight - node.offsetHeight) / 2;
        ui.scroller.scrollTop = Math.max(0, top);
        if (opts.flash) {
          node.classList.remove('flash');
          void node.offsetWidth;
          node.classList.add('flash');
        }
      }
    }
    requestAnimationFrame(onScrollFrame);
  }

  function prepend(chat) {
    const newLo = Math.max(0, chat.lo - CHUNK);
    const html = rangeHTML(chat, newLo, chat.lo);
    keepAnchor(() => {
      ui.rows.insertAdjacentHTML('afterbegin', html);
      chat.lo = newLo;
      let extra = chat.hi - chat.lo - MAX_ROWS;
      while (extra-- > 0) {
        const last = ui.rows.lastElementChild;
        unobserveMedia(last);
        last.remove();
        chat.hi--;
      }
    });
    observeMedia(ui.rows);
  }

  function append(chat) {
    const newHi = Math.min(chat.rows.length, chat.hi + CHUNK);
    const html = rangeHTML(chat, chat.hi, newHi);
    keepAnchor(() => {
      ui.rows.insertAdjacentHTML('beforeend', html);
      chat.hi = newHi;
      let extra = chat.hi - chat.lo - MAX_ROWS;
      while (extra-- > 0) {
        const firstRow = ui.rows.firstElementChild;
        unobserveMedia(firstRow);
        firstRow.remove();
        chat.lo++;
      }
    });
    observeMedia(ui.rows);
  }

  // While a chat sits at its latest message, keep it there as photos load and grow the content.
  let stickBottom = false;
  new ResizeObserver(() => { if (stickBottom) ui.scroller.scrollTop = ui.scroller.scrollHeight; }).observe(ui.rows);
  // Any scroll that leaves the bottom (wheel, keys, touch, search jumps…) releases the pin.
  ui.scroller.addEventListener('scroll', () => {
    const s = ui.scroller;
    stickBottom = !!state.active && state.active.hi >= state.active.rows.length && s.scrollHeight - s.scrollTop - s.clientHeight < 4;
  }, { passive: true });

  let scrollRaf = 0, floatTimer = 0, upTimer = 0, lastTop = 0;
  function onScrollFrame() {
    scrollRaf = 0;
    const chat = state.active;
    if (!chat || ui.chat.hidden) return;
    const s = ui.scroller;
    if (s.scrollTop < EDGE && chat.lo > 0) { prepend(chat); scrollRaf = requestAnimationFrame(onScrollFrame); }
    else if (s.scrollHeight - s.scrollTop - s.clientHeight < EDGE && chat.hi < chat.rows.length) { append(chat); scrollRaf = requestAnimationFrame(onScrollFrame); }
    ui.fab.classList.toggle('show', chat.hi < chat.rows.length || s.scrollHeight - s.scrollTop - s.clientHeight > 400);
    updateScrub();
  }

  // The "go to first message" button shows while scrolling up and fades shortly after.
  function updateUpFab() {
    const chat = state.active;
    const top = ui.scroller.scrollTop;
    const up = top < lastTop - 2;
    lastTop = top;
    if (!chat) return;
    const awayFromStart = chat.lo > 0 || top > 600;
    if (up && awayFromStart) {
      ui.fabUp.classList.add('show');
      clearTimeout(upTimer);
      upTimer = setTimeout(() => ui.fabUp.classList.remove('show'), 2500);
    } else if (!awayFromStart) {
      ui.fabUp.classList.remove('show');
    }
  }

  function updateFloatDate() {
    const chat = state.active;
    if (!chat) return;
    if (ui.scroller.scrollTop < 40) { ui.floatDate.classList.remove('show'); return; }
    const idx = chat.lo + childAt(ui.scroller.scrollTop + 48);
    let r = chat.rows[idx];
    if (r && r.k === 'n') r = chat.rows[idx + 1];
    if (!r) return;
    const ts = r.k === 'd' ? r.ts : r.m.ts;
    ui.floatDate.textContent = dayLabel(ts);
    ui.floatDate.classList.add('show');
    clearTimeout(floatTimer);
    floatTimer = setTimeout(() => ui.floatDate.classList.remove('show'), 1100);
  }

  ui.scroller.addEventListener('scroll', () => {
    if (!scrollRaf) scrollRaf = requestAnimationFrame(onScrollFrame);
    updateFloatDate();
    updateUpFab();
  }, { passive: true });

  function goTop() {
    const chat = state.active;
    if (!chat) return;
    ui.fabUp.classList.remove('show');
    if (chat.lo > 0) openAt(chat, 0, { top: true });
    else ui.scroller.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBottom() {
    const chat = state.active;
    if (!chat) return;
    if (chat.hi < chat.rows.length) openAt(chat, 'end');
    else ui.scroller.scrollTo({ top: ui.scroller.scrollHeight, behavior: 'smooth' });
  }

  ui.fab.addEventListener('click', goBottom);
  ui.fabUp.addEventListener('click', goTop);

  /* Fast-scroll bar: the DOM only holds a window of the chat, so the native scrollbar can't
     represent it. This bar maps the full chat (row 0 … last row) onto its height. */
  let scrubbing = false, scrubRaf = 0, scrubFrac = 0;

  function rowTs(chat, i) {
    const r = chat.rows[Math.max(1, Math.min(chat.rows.length - 1, i))];
    return r ? (r.k === 'd' ? r.ts : r.m.ts) : null;
  }

  function setThumb(frac) {
    const travel = ui.scrub.clientHeight - ui.scrubThumb.offsetHeight;
    const y = Math.max(0, Math.min(1, frac)) * travel;
    ui.scrubThumb.style.transform = 'translateY(' + y + 'px)';
    ui.scrubTip.style.top = (y + ui.scrubThumb.offsetHeight / 2) + 'px';
  }

  function updateScrub() {
    const chat = state.active;
    if (!chat) return;
    const s = ui.scroller;
    const n = chat.rows.length;
    const scrollable = chat.lo > 0 || chat.hi < n || s.scrollHeight > s.clientHeight + 4;
    ui.scrub.hidden = !scrollable;
    if (!scrollable || scrubbing) return;
    const atEnd = chat.hi >= n && s.scrollHeight - s.scrollTop - s.clientHeight < 4;
    setThumb(atEnd ? 1 : (chat.lo + childAt(s.scrollTop)) / Math.max(1, n - 1));
  }

  function scrubTo(e) {
    const chat = state.active;
    const r = ui.scrub.getBoundingClientRect();
    const th = ui.scrubThumb.offsetHeight;
    scrubFrac = Math.max(0, Math.min(1, (e.clientY - r.top - th / 2) / (r.height - th)));
    setThumb(scrubFrac);
    const ts = rowTs(chat, Math.round(scrubFrac * (chat.rows.length - 1)));
    ui.scrubTip.textContent = ts ? longDate(ts) : '';
    if (!scrubRaf) {
      scrubRaf = requestAnimationFrame(() => {
        scrubRaf = 0;
        if (scrubFrac >= 0.999) openAt(chat, 'end');
        else openAt(chat, Math.round(scrubFrac * (chat.rows.length - 1)), { top: true });
      });
    }
  }

  ui.scrub.addEventListener('pointerdown', e => {
    if (!state.active || e.button > 0) return;
    e.preventDefault();
    scrubbing = true;
    stickBottom = false;
    ui.scrub.setPointerCapture(e.pointerId);
    ui.scrub.classList.add('drag');
    scrubTo(e);
  });
  ui.scrub.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e); });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    ui.scrub.classList.remove('drag');
    updateScrub();
  };
  ui.scrub.addEventListener('pointerup', endScrub);
  ui.scrub.addEventListener('pointercancel', endScrub);
  new ResizeObserver(updateScrub).observe(ui.scroller);

  /* ---------- open / switch chats ---------- */
  function participantsLine(chat) {
    const names = chat.parsed.participants.filter(p => p !== chat.me).sort((a, b) => a.localeCompare(b));
    if (chat.me) names.push('You');
    return names.join(', ');
  }

  function renderHeader(chat) {
    ui.headAv.innerHTML = avatarHTML('md', chat.isGroup);
    ui.headTitle.textContent = chat.title;
    ui.headSub.textContent = chat.isGroup ? participantsLine(chat) : 'click here for contact info';
  }

  function openChat(chat, push) {
    if (state.active && state.active !== chat) {
      state.active.saved = anchorInfo(state.active);
      stopVoice();
      if (state.drawer === 'search') closeDrawer();
    }
    const switching = state.active !== chat;
    state.active = chat;
    ui.welcome.hidden = true;
    ui.chat.hidden = false;
    renderHeader(chat);
    if (switching || !ui.rows.childElementCount) {
      if (chat.saved) { paint(chat, chat.lo, chat.hi); restoreAnchor(chat, chat.saved); }
      else openAt(chat, 'end');
    }
    if (state.drawer === 'info') renderInfo(chat);
    if (!ui.app.classList.contains('chat-open')) {
      ui.app.classList.add('chat-open');
      if (push !== false && isMobile()) history.pushState({ chat: chat.id }, '');
    }
    renderChatList();
    if (chat.askMe) {
      chat.askMe = false;
      toast(chat.me ? 'Showing ' + chat.me + '’s messages as yours' : 'Choose whose messages are yours', { action: 'Change', run: () => pickMe(chat), ms: 7000 });
    }
  }

  function closeChatView() {
    ui.app.classList.remove('chat-open');
    if (state.drawer) closeDrawer();
  }

  ui.headWho.addEventListener('click', () => state.drawer === 'info' ? closeDrawer() : openDrawer('info'));
  ui.headWho.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.headWho.click(); } });
  $('backBtn').addEventListener('click', () => { if (history.state && history.state.chat) history.back(); else closeChatView(); });
  window.addEventListener('popstate', () => { if (isMobile() && ui.app.classList.contains('chat-open')) closeChatView(); });

  /* ---------- sidebar ---------- */
  function renderChatList() {
    ui.railCount.hidden = !state.chats.length;
    ui.railCount.textContent = state.chats.length;
    ui.railMedia.disabled = !state.active;
    if (!state.chats.length) {
      ui.chatList.innerHTML = '<div class="list-empty">No chats yet.<br>Open a WhatsApp export to get started.<br><button class="btn primary" type="button" data-act="import">Open chat export</button></div>';
      return;
    }
    const q = ui.chatFilter.value.trim().toLowerCase();
    const kind = state.listFilter;
    const list = state.chats
      .filter(c => (!q || c.title.toLowerCase().includes(q)) && (kind === 'all' || (kind === 'groups') === c.isGroup))
      .sort((a, b) => lastMsg(b).ts - lastMsg(a).ts);
    if (!list.length) {
      ui.chatList.innerHTML = '<div class="list-empty">' + (q ? 'No chats match “' + esc(q) + '”' : 'No ' + (kind === 'groups' ? 'group' : 'personal') + ' chats yet') + '</div>';
      return;
    }
    ui.chatList.innerHTML = list.map(c => {
      const m = lastMsg(c);
      const who = m.kind === 'system' ? '' : m.sender === c.me ? TICKS : c.isGroup ? esc(m.sender) + ': ' : '';
      return '<div class="ci' + (c === state.active ? ' active' : '') + '" data-id="' + c.id + '" role="button" tabindex="0">' +
        avatarHTML('', c.isGroup) +
        '<div class="ci-main"><div class="ci-top"><span class="ci-title">' + esc(c.title) + '</span><span class="ci-time">' + esc(listTime(m.ts, c.h12)) + '</span></div>' +
        '<div class="ci-bottom"><span class="ci-prev">' + who + esc(m.kind === 'system' ? m.text : summary(m)) + '</span>' +
        '<button class="ci-x" type="button" data-x="' + c.id + '" title="Remove chat" aria-label="Remove chat">' + icon('close') + '</button></div></div></div>';
    }).join('');
  }

  ui.chatList.addEventListener('click', e => {
    if (e.target.closest('[data-act="import"]')) { ui.fileInput.click(); return; }
    const x = e.target.closest('[data-x]');
    const find = id => state.chats.find(c => c.id === +id);
    if (x) { e.stopPropagation(); confirmRemove(find(x.dataset.x)); return; }
    const item = e.target.closest('.ci');
    if (item) openChat(find(item.dataset.id));
  });
  ui.chatList.addEventListener('keydown', e => {
    const item = e.target.closest('.ci');
    if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); item.click(); }
  });
  ui.chatFilter.addEventListener('input', renderChatList);
  ui.chips.addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.listFilter = chip.dataset.filter;
    ui.chips.querySelectorAll('[data-filter]').forEach(c => {
      c.classList.toggle('on', c === chip);
      c.setAttribute('aria-selected', c === chip);
    });
    renderChatList();
  });

  function confirmRemove(chat) {
    if (!chat) return;
    showModal('Remove this chat?', '<p>“' + esc(chat.title) + '” will be closed. Your original export file is not affected.</p>', [
      { label: 'Cancel' },
      { label: 'Remove', primary: true, run: () => removeChat(chat) }
    ]);
  }

  /* ---------- clicks inside the chat ---------- */
  ui.rows.addEventListener('click', e => {
    const chat = state.active;
    if (!chat) return;
    const more = e.target.closest('[data-more]');
    if (more) {
      const m = chat.msgs[+more.dataset.more];
      chat.expanded.add(m.id);
      keepAnchor(() => replaceRow(chat, m.r));
      return;
    }
    const bm = e.target.closest('.bm');
    if (bm) { messageMenu(chat, chat.rows[+bm.closest('.row').dataset.i].m, bm); return; }
    const play = e.target.closest('.v-play');
    if (play) { toggleVoice(play.closest('.voice')); return; }
    if (e.target.closest('.v-speed')) { cycleSpeed(); return; }
    const wave = e.target.closest('.v-wave');
    if (wave) { seekVoice(wave.closest('.voice'), e.clientX); return; }
    const img = e.target.closest('.mm.img');
    if (img && !img.classList.contains('err')) {
      const row = img.closest('.row');
      openLightbox(chat, chat.rows[+row.dataset.i].m.id);
      return;
    }
    const doc = e.target.closest('a.doc');
    if (doc && !doc.getAttribute('href')) {
      e.preventDefault();
      mediaURL(chat, doc.dataset.f).then(url => { if (url) { doc.href = url; doc.click(); } });
    }
  });

  function copyText(text) {
    const done = () => toast('Copied to clipboard');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast('Could not copy', { error: true }); }
    ta.remove();
  }

  function messageMenu(chat, m, anchor) {
    const who = m.sender === chat.me ? 'You' : m.sender;
    const stamp = longDate(m.ts) + ', ' + timeStr(m.ts, chat.h12);
    const entry = m.kind === 'media' && getMedia(chat, m.file);
    showMenu(anchor, [
      m.text ? { icon: 'copy', label: 'Copy', run: () => copyText(m.text) } : null,
      m.text ? { icon: 'copy', label: 'Copy with sender & time', run: () => copyText('[' + stamp + '] ' + who + ': ' + m.text) } : null,
      entry ? {
        icon: 'download', label: 'Download', run: () => mediaURL(chat, m.file).then(url => {
          if (!url) return;
          const a = document.createElement('a');
          a.href = url;
          a.download = displayName(m.file);
          a.click();
        })
      } : null,
      {
        icon: 'info', label: 'Message info', run: () => showModal('Message info',
          '<dl class="kv"><dt>From</dt><dd>' + esc(who) + '</dd><dt>Sent</dt><dd>' + esc(stamp) + '</dd>' +
          (m.edited ? '<dt>Edited</dt><dd>Yes</dd>' : '') +
          (m.file ? '<dt>File</dt><dd>' + esc(displayName(m.file)) + '</dd>' : '') +
          '<dt>Message</dt><dd>#' + num(m.id + 1) + ' of ' + num(chat.msgs.length) + '</dd></dl>', [{ label: 'OK', primary: true }])
      }
    ]);
  }

  /* ---------- voice notes ---------- */
  const player = new Audio();
  const SPEEDS = [1, 1.5, 2];
  let voiceKey = null;
  let speed = 1;

  const speedLabel = () => speed + '×';
  const voiceNode = () => voiceKey ? ui.rows.querySelector('.voice[data-f="' + CSS.escape(voiceKey) + '"]') : null;

  function toggleVoice(node) {
    if (!node) return;
    if (!node.dataset.url) { toast('Audio is still loading…'); loadMedia(state.active, node); return; }
    if (voiceKey === node.dataset.f) {
      if (player.paused) player.play().catch(audioErr); else player.pause();
      return;
    }
    stopVoice();
    voiceKey = node.dataset.f;
    player.src = node.dataset.url;
    player.playbackRate = speed;
    player.play().catch(audioErr);
  }

  function audioErr(err) {
    if (err && err.name === 'AbortError') return;
    toast('This browser can’t play ' + (voiceKey ? extOf(voiceKey).toUpperCase() : 'this') + ' audio. Try Chrome or Firefox.', { error: true });
    stopVoice();
  }

  // Paint progress (0–1) onto a voice note's waveform.
  function paintWave(node, frac) {
    const wave = node.querySelector('.v-wave');
    const on = Math.round(frac * WAVE_BARS);
    wave.style.setProperty('--p', (frac * 100) + '%');
    wave.setAttribute('aria-valuenow', Math.round(frac * 100));
    Array.prototype.forEach.call(wave.children, (b, i) => { if (b.tagName === 'I') b.classList.toggle('on', i < on); });
  }

  // Bring a (re-rendered) voice note node in line with the player's state.
  function syncVoice() {
    const n = voiceNode();
    if (!n) return;
    n.classList.toggle('playing', !player.paused);
    n.querySelector('.v-time').textContent = fmtDur(player.currentTime);
    if (isFinite(player.duration) && player.duration > 0) paintWave(n, player.currentTime / player.duration);
  }

  function stopVoice() {
    const n = voiceNode();
    player.pause();
    if (n) {
      n.classList.remove('playing');
      paintWave(n, 0);
      const d = state.active && state.active.durs.get(voiceKey.toLowerCase());
      n.querySelector('.v-time').textContent = d ? fmtDur(d) : '0:00';
    }
    voiceKey = null;
  }

  function seekVoice(node, clientX) {
    const wave = node.querySelector('.v-wave');
    const r = wave.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    if (voiceKey !== node.dataset.f) {
      toggleVoice(node);
      if (voiceKey !== node.dataset.f) return;
    }
    const apply = () => { if (isFinite(player.duration)) player.currentTime = frac * player.duration; };
    if (isFinite(player.duration)) apply(); else player.addEventListener('loadedmetadata', apply, { once: true });
    paintWave(node, frac);
  }

  function cycleSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    player.playbackRate = speed;
    ui.rows.querySelectorAll('.v-speed').forEach(b => { b.textContent = speedLabel(); });
  }

  player.addEventListener('play', syncVoice);
  player.addEventListener('pause', syncVoice);
  player.addEventListener('timeupdate', syncVoice);
  player.addEventListener('ended', stopVoice);

  /* ---------- drawer: search & info ---------- */
  function openDrawer(mode) {
    const chat = state.active;
    if (!chat) return;
    state.drawer = mode;
    ui.drawer.classList.add('open');
    ui.drawer.setAttribute('aria-hidden', 'false');
    if (mode === 'search') {
      ui.drawerTitle.textContent = 'Search messages';
      ui.drawerTools.hidden = false;
      ui.searchInput.value = chat.search.q;
      renderSearch(chat);
      setTimeout(() => { ui.searchInput.focus(); ui.searchInput.select(); }, 60);
    } else {
      ui.drawerTitle.textContent = chat.isGroup ? 'Group info' : 'Contact info';
      ui.drawerTools.hidden = true;
      renderInfo(chat);
    }
  }

  function closeDrawer(keepSearch) {
    if (!state.drawer) return;
    const wasSearch = state.drawer === 'search';
    state.drawer = null;
    ui.drawer.classList.remove('open');
    ui.drawer.setAttribute('aria-hidden', 'true');
    const chat = state.active;
    if (wasSearch && !keepSearch && chat && chat.search.q) {
      chat.search = { q: '', hits: [], pos: -1, re: null };
      rerender();
    }
  }

  $('drawerClose').addEventListener('click', () => closeDrawer());
  $('searchBtn').addEventListener('click', () => state.drawer === 'search' && !isMobile() ? closeDrawer() : openDrawer('search'));

  let searchTimer = 0;
  ui.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(ui.searchInput.value), 160);
  });
  ui.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      const chat = state.active;
      if (ui.searchInput.value.trim() !== chat.search.q) runSearch(ui.searchInput.value);
      stepHit(e.shiftKey ? 1 : -1);
    }
  });
  ui.sPrev.addEventListener('click', () => stepHit(-1));
  ui.sNext.addEventListener('click', () => stepHit(1));

  function runSearch(raw) {
    const chat = state.active;
    if (!chat) return;
    const q = raw.trim();
    const s = chat.search;
    s.q = q;
    s.pos = -1;
    if (!q) { s.hits = []; s.re = null; }
    else {
      const lq = q.toLowerCase();
      s.hits = chat.msgs.filter(m => {
        if (m.lc === undefined) m.lc = ((m.text || '') + ' ' + (m.file || '') + (m.poll ? ' ' + m.poll.options.map(o => o.label).join(' ') : '')).toLowerCase();
        return m.lc.includes(lq);
      });
      s.re = new RegExp(escapeRe(esc(q)), 'giu');
    }
    renderSearch(chat);
    rerender();
  }

  function snippet(text, lq, re) {
    const flat = text.replace(/\s+/g, ' ');
    const i = flat.toLowerCase().indexOf(lq);
    let s = flat, pre = '';
    if (i > 40) { s = flat.slice(i - 30); pre = '…'; }
    return pre + mark(esc(s.slice(0, 180)), re);
  }

  function renderSearch(chat) {
    const s = chat.search;
    updateSearchNav(chat);
    if (!s.q) { ui.drawerBody.innerHTML = '<div class="drawer-empty">Search for messages in ' + esc(chat.title) + '</div>'; return; }
    if (!s.hits.length) { ui.drawerBody.innerHTML = '<div class="drawer-empty">No messages found for “' + esc(s.q) + '”</div>'; return; }
    const lq = s.q.toLowerCase();
    const shown = s.hits.slice(-300).reverse();
    ui.drawerBody.innerHTML =
      (s.hits.length > 300 ? '<div class="sr-note">Showing the 300 most recent of ' + num(s.hits.length) + ' matches</div>' : '') +
      shown.map(m => {
        const who = m.sender == null ? '' : m.sender === chat.me ? TICKS + ' ' : chat.isGroup ? '<b>' + esc(m.sender) + ':</b> ' : '';
        return '<button class="sr" type="button" data-id="' + m.id + '"><span class="sr-date">' + esc(shortDate(m.ts)) + ' · ' + esc(timeStr(m.ts, chat.h12)) +
          '</span><span class="sr-txt">' + who + snippet(m.text || displayName(m.file || ''), lq, s.re) + '</span></button>';
      }).join('');
  }

  function updateSearchNav(chat) {
    const s = chat.search;
    ui.sCount.textContent = !s.q ? '' : !s.hits.length ? '0' : s.pos >= 0 ? (s.hits.length - s.pos) + ' of ' + num(s.hits.length) : num(s.hits.length);
    ui.sPrev.disabled = !s.hits.length || s.pos === 0;
    ui.sNext.disabled = !s.hits.length || s.pos === -1 || s.pos >= s.hits.length - 1;
    ui.drawerBody.querySelectorAll('.sr.cur').forEach(n => n.classList.remove('cur'));
    if (s.pos >= 0) {
      const cur = ui.drawerBody.querySelector('.sr[data-id="' + s.hits[s.pos].id + '"]');
      if (cur) { cur.classList.add('cur'); cur.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // dir -1 = older match, +1 = newer match
  function stepHit(dir) {
    const chat = state.active;
    const s = chat && chat.search;
    if (!s || !s.hits.length) return;
    if (s.pos === -1) s.pos = s.hits.length - 1;
    else s.pos = Math.min(s.hits.length - 1, Math.max(0, s.pos + dir));
    jumpToMsg(chat, s.hits[s.pos]);
    updateSearchNav(chat);
  }

  ui.drawerBody.addEventListener('click', e => {
    const chat = state.active;
    if (!chat) return;
    const sr = e.target.closest('.sr');
    if (sr) {
      const m = chat.msgs[+sr.dataset.id];
      chat.search.pos = chat.search.hits.indexOf(m);
      updateSearchNav(chat);
      if (isMobile()) closeDrawer(true);
      jumpToMsg(chat, m);
      return;
    }
    const tile = e.target.closest('.tile');
    if (tile) {
      const m = chat.msgs[+tile.dataset.id];
      if (m.ftype === 'img') openLightbox(chat, m.id);
      else { if (isMobile()) closeDrawer(); jumpToMsg(chat, m); }
      return;
    }
    const seg = e.target.closest('[data-order]');
    if (seg) { setOrder(chat, seg.dataset.order); return; }
    if (e.target.closest('[data-act="remove"]')) confirmRemove(chat);
    if (e.target.closest('[data-act="addmedia"]')) ui.mediaInput.click();
  });

  ui.drawerBody.addEventListener('change', e => {
    if (e.target.id === 'meSelect') setMe(state.active, e.target.value || null);
  });

  function jumpToMsg(chat, m) {
    if (m.text && m.text.length > LONG_TEXT) chat.expanded.add(m.id);
    openAt(chat, m.r, { flash: true });
  }

  function getStats(chat) {
    if (chat.stats) return chat.stats;
    let media = 0, links = 0, words = 0, total = 0, first = null, last = null;
    const days = new Map();
    for (const m of chat.msgs) {
      if (m.kind === 'system') continue;
      total++;
      if (first === null) first = m.ts;
      last = m.ts;
      if (m.kind === 'media' || m.kind === 'omitted') media++;
      if (m.text) {
        const l = m.text.match(/https?:\/\/|www\./gi);
        if (l) links += l.length;
        const w = m.text.match(/\S+/g);
        if (w) words += w.length;
      }
      const k = dayKey(m.ts);
      const d = days.get(k);
      if (d) d.n++; else days.set(k, { n: 1, ts: m.ts });
    }
    let busiest = null;
    days.forEach(d => { if (!busiest || d.n > busiest.n) busiest = d; });
    chat.stats = { total, media, links, words, days: days.size, busiest, first, last };
    return chat.stats;
  }

  function galleryItems(chat) {
    if (!chat.gallery) chat.gallery = chat.msgs.filter(m => m.kind === 'media' && (m.ftype === 'img' || m.ftype === 'vid') && getMedia(chat, m.file));
    return chat.gallery;
  }

  let galleryIO = null;
  function renderInfo(chat) {
    const st = getStats(chat);
    const ps = chat.parsed.participants;
    const counts = chat.parsed.counts;
    const max = Math.max(1, ...ps.map(p => counts.get(p)));
    const gal = galleryItems(chat);
    const order = chat.parsed.order;
    const other = !chat.isGroup && ps.find(p => p !== chat.me);

    ui.drawerBody.innerHTML =
      '<div class="info-hero">' + avatarHTML('xl', chat.isGroup) + '<h2>' + esc(chat.title) + '</h2><p>' +
      (chat.isGroup ? 'Group · ' + ps.length + ' participants' : esc(other && other !== chat.title ? other : 'Personal chat')) + '</p></div>' +

      '<div class="info-card"><h3>Overview</h3><div class="stat-grid">' +
      '<div class="stat"><b>' + num(st.total) + '</b><span>messages</span></div>' +
      '<div class="stat"><b>' + num(st.media) + '</b><span>media files</span></div>' +
      '<div class="stat"><b>' + num(st.days) + '</b><span>active days</span></div>' +
      '<div class="stat"><b>' + num(st.links) + '</b><span>links shared</span></div>' +
      '</div><div class="range-line">' +
      (st.first ? 'From <b>' + esc(longDate(st.first)) + '</b> to <b>' + esc(longDate(st.last)) + '</b><br>' : '') +
      (st.busiest ? 'Busiest day: <b>' + esc(longDate(st.busiest.ts)) + '</b> (' + num(st.busiest.n) + ' messages)<br>' : '') +
      num(st.words) + ' words in total</div></div>' +

      '<div class="info-card"><h3>Viewing as</h3><select class="field" id="meSelect" aria-label="Whose messages are yours">' +
      ps.map(p => '<option value="' + esc(p) + '"' + (p === chat.me ? ' selected' : '') + '>' + esc(p) + '</option>').join('') +
      '<option value=""' + (chat.me == null ? ' selected' : '') + '>Nobody (show everyone on the left)</option></select>' +
      '<p class="hint">Messages from this person appear on the right in green, like your own.</p></div>' +

      (chat.parsed.ambiguous && order !== 'ymd'
        ? '<div class="info-card"><h3>Date format</h3><div class="seg"><button type="button" data-order="dmy"' + (order === 'dmy' ? ' class="on"' : '') + '>DD/MM/YYYY</button>' +
          '<button type="button" data-order="mdy"' + (order === 'mdy' ? ' class="on"' : '') + '>MM/DD/YYYY</button></div><p class="hint">Switch if dates look wrong. This export doesn’t say which one it uses.</p></div>'
        : '') +

      '<div class="info-card"><h3><span>' + ps.length + ' participant' + (ps.length === 1 ? '' : 's') + '</span></h3>' +
      ps.map(p => '<div class="pp">' + avatarHTML('md') + '<div class="pp-main"><div class="pp-name"><span>' + esc(p) + '</span>' +
        (p === chat.me ? '<span class="you-badge">You</span>' : '') + '</div><div class="pp-bar"><i style="width:' + (counts.get(p) / max * 100).toFixed(1) + '%"></i></div></div>' +
        '<span class="pp-count">' + num(counts.get(p)) + '</span></div>').join('') + '</div>' +

      '<div class="info-card"><h3><span>Media</span><span>' + num(gal.length) + '</span></h3>' +
      (gal.length
        ? '<div class="gallery">' + gal.map(m => '<button class="tile" type="button" data-id="' + m.id + '" data-t="' + m.ftype + '" data-f="' + esc(m.file) + '" aria-label="' + (m.ftype === 'img' ? 'Photo' : 'Video') + '"></button>').join('') + '</div>'
        : '<p class="hint">' + (chat.media.size ? 'No photos or videos in this chat.' : 'No media in this export. Export with “Include media” as a .zip, or add the files below.') + '</p>') +
      '<p class="hint"><button class="chip" type="button" data-act="addmedia">Add media files…</button></p></div>' +

      '<div class="info-card"><button class="danger-btn" type="button" data-act="remove">' + icon('trash') + 'Remove chat</button></div>';

    if (galleryIO) galleryIO.disconnect();
    galleryIO = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        galleryIO.unobserve(e.target);
        const t = e.target;
        mediaURL(chat, t.dataset.f).then(url => {
          if (!url) return;
          t.innerHTML = t.dataset.t === 'img'
            ? '<img alt="" src="' + url + '" decoding="async">'
            : '<video muted preload="metadata" src="' + url + '#t=0.1"></video>' + icon('video');
        });
      }
    }, { root: ui.drawerBody, rootMargin: '300px 0px' });
    ui.drawerBody.querySelectorAll('.tile').forEach(t => galleryIO.observe(t));
  }

  function setMe(chat, me) {
    if (!chat) return;
    chat.me = me;
    chat.askMe = false;
    renderHeader(chat);
    rerender();
    renderChatList();
    if (state.drawer === 'info') renderInfo(chat);
  }

  function setOrder(chat, order) {
    if (chat.parsed.order === order) return;
    const me = chat.me;
    const parsed = Parser.parse(chat.text, { order });
    applyParsed(chat, parsed);
    chat.me = parsed.participants.includes(me) ? me : chat.me;
    renderHeader(chat);
    openAt(chat, 'end');
    renderChatList();
    renderInfo(chat);
    toast('Dates now read as ' + (order === 'dmy' ? 'day/month/year' : 'month/day/year'));
  }

  function pickMe(chat) {
    const ps = chat.parsed.participants;
    const opt = (v, label, extra) => '<label class="pick"><input type="radio" name="me" value="' + esc(v) + '"' + ((chat.me || '') === v ? ' checked' : '') + '>' +
      avatarHTML('md', !v) + '<span>' + esc(label) + '</span><small>' + extra + '</small></label>';
    showModal('Which one is you?',
      ps.map(p => opt(p, p, num(chat.parsed.counts.get(p)) + ' msgs')).join('') + opt('', 'Nobody', 'everyone on the left'),
      [
        { label: 'Cancel' },
        { label: 'Apply', primary: true, run: () => { const c = ui.modalBody.querySelector('input:checked'); setMe(chat, c && c.value ? c.value : null); } }
      ]);
  }

  /* ---------- header menu & jump to date ---------- */
  $('menuBtn').addEventListener('click', e => {
    const chat = state.active;
    if (!chat) return;
    const ps = chat.parsed.participants;
    showMenu(e.currentTarget, [
      { icon: 'info', label: chat.isGroup ? 'Group info' : 'Contact info', run: () => openDrawer('info') },
      { icon: 'search', label: 'Search messages', run: () => openDrawer('search') },
      { icon: 'calendar', label: 'Jump to date', run: () => jumpDialog(chat) },
      { icon: 'person', label: 'Choose who is “You”…', run: () => pickMe(chat) },
      ps.length === 2 ? { icon: 'swap', label: 'Swap sides', run: () => setMe(chat, ps.find(p => p !== chat.me) || ps[0]) } : null,
      { icon: 'attach', label: 'Add media files…', run: () => ui.mediaInput.click() },
      { icon: 'up', label: 'Go to first message', run: () => openAt(chat, 0, { top: true }) },
      { icon: 'trash', label: 'Remove chat', danger: true, run: () => confirmRemove(chat) }
    ]);
  });
  $('dateBtn').addEventListener('click', () => state.active && jumpDialog(state.active));

  function jumpDialog(chat) {
    const st = getStats(chat);
    if (!st.first) return;
    const cur = chat.rows[chat.lo + childAt(ui.scroller.scrollTop + 48)];
    const curTs = cur && cur.k === 'm' ? cur.m.ts : cur && cur.k === 'd' ? cur.ts : st.first;
    showModal('Jump to date',
      '<input type="date" class="field" id="jumpInput" min="' + toISO(st.first) + '" max="' + toISO(st.last) + '" value="' + toISO(curTs) + '">' +
      '<div class="quick"><button class="chip" type="button" data-q="first">First message</button><button class="chip" type="button" data-q="last">Latest</button></div>',
      [
        { label: 'Cancel' },
        {
          label: 'Go', primary: true, run: () => {
            const v = $('jumpInput').value;
            if (!v) return false;
            const [y, mo, d] = v.split('-').map(Number);
            jumpToTs(chat, new Date(y, mo - 1, d).getTime());
          }
        }
      ]);
    ui.modalBody.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      closeModal();
      if (b.dataset.q === 'first') openAt(chat, 0, { top: true }); else openAt(chat, 'end');
    }));
  }

  function jumpToTs(chat, ts) {
    const m = chat.msgs.find(x => x.ts >= ts) || chat.msgs[chat.msgs.length - 1];
    const target = chat.rows[m.r - 1] && chat.rows[m.r - 1].k === 'd' ? m.r - 1 : m.r;
    openAt(chat, target, { top: true, flash: true });
  }

  /* ---------- lightbox ---------- */
  const lb = { chat: null, list: [], idx: 0 };

  function openLightbox(chat, msgId) {
    lb.chat = chat;
    lb.list = galleryItems(chat).filter(m => m.ftype === 'img');
    lb.idx = lb.list.findIndex(m => m.id === msgId);
    if (lb.idx < 0) return;
    ui.lightbox.hidden = false;
    showLb();
  }

  async function showLb() {
    const m = lb.list[lb.idx];
    const chat = lb.chat;
    ui.lbImg.removeAttribute('src');
    ui.lbWho.innerHTML = avatarHTML('md') + '<div>' + esc(m.sender === chat.me ? 'You' : m.sender) + '<small>' + esc(longDate(m.ts) + ', ' + timeStr(m.ts, chat.h12)) + '</small></div>';
    ui.lbCap.innerHTML = m.text ? format(m.text) : '';
    ui.lbCount.textContent = (lb.idx + 1) + ' / ' + lb.list.length;
    ui.lbPrev.disabled = lb.idx === 0;
    ui.lbNext.disabled = lb.idx === lb.list.length - 1;
    const url = await mediaURL(chat, m.file);
    if (lb.list[lb.idx] !== m || !url) return;
    ui.lbImg.src = url;
    ui.lbDl.href = url;
    ui.lbDl.download = displayName(m.file);
  }

  function stepLb(d) {
    const n = lb.idx + d;
    if (n < 0 || n >= lb.list.length) return;
    lb.idx = n;
    showLb();
  }

  const closeLb = () => { ui.lightbox.hidden = true; ui.lbImg.removeAttribute('src'); };
  $('lbClose').addEventListener('click', closeLb);
  ui.lbPrev.addEventListener('click', () => stepLb(-1));
  ui.lbNext.addEventListener('click', () => stepLb(1));
  ui.lbGo.addEventListener('click', () => {
    const m = lb.list[lb.idx];
    closeLb();
    if (isMobile()) closeDrawer();
    if (state.active !== lb.chat) openChat(lb.chat);
    jumpToMsg(lb.chat, m);
  });
  $('lbStage').addEventListener('click', e => { if (e.target.id === 'lbStage') closeLb(); });
  let touchX = null;
  ui.lightbox.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  ui.lightbox.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) stepLb(dx < 0 ? 1 : -1);
  });

  /* ---------- menus, modals, toasts, busy ---------- */
  let menuEl = null;
  function showMenu(anchor, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    items.filter(Boolean).forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (it.danger ? ' danger' : '');
      b.setAttribute('role', 'menuitem');
      b.innerHTML = icon(it.icon) + '<span>' + esc(it.label) + '</span>';
      b.addEventListener('click', () => { closeMenu(); it.run(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
    m.style.right = Math.max(8, innerWidth - r.right) + 'px';
    menuEl = m;
    const first = m.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
  }
  function outsideMenu(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener('pointerdown', outsideMenu, true);
  }

  function showModal(title, html, actions) {
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = html;
    ui.modalActions.innerHTML = '';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      if (a.primary) b.dataset.primary = '1';
      b.addEventListener('click', () => { if (a.run && a.run() === false) return; closeModal(); });
      ui.modalActions.appendChild(b);
    });
    ui.modal.hidden = false;
    const focus = ui.modalBody.querySelector('input:checked, input, select') || ui.modalActions.querySelector('[data-primary]');
    if (focus) setTimeout(() => focus.focus(), 30);
  }
  const closeModal = () => { ui.modal.hidden = true; };
  ui.modal.addEventListener('click', e => { if (e.target === ui.modal) closeModal(); });
  ui.modal.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      const p = ui.modalActions.querySelector('[data-primary]');
      if (p) { e.preventDefault(); p.click(); }
    }
  });

  function toast(msg, opts) {
    opts = opts || {};
    const t = document.createElement('div');
    t.className = 'toast' + (opts.error ? ' error' : '');
    t.setAttribute('role', 'status');
    t.innerHTML = '<span>' + esc(msg) + '</span>';
    const dismiss = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); };
    if (opts.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.action;
      b.addEventListener('click', () => { dismiss(); opts.run(); });
      t.appendChild(b);
    }
    ui.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(dismiss, opts.ms || 4000);
  }

  function busy(on, text) {
    ui.busyText.textContent = text || 'Opening chat…';
    ui.busy.hidden = !on;
  }

  /* ---------- file loading ---------- */
  async function openZip(file) {
    if (!window.JSZip) throw new Error('ZIP support didn’t load. Reload the page, or extract the zip and open the folder instead.');
    if (file.size > MAX_ZIP_BYTES) {
      throw new Error(file.name + ' is ' + (file.size / 1024 ** 3).toFixed(1) + ' GB, too large for a browser to unzip. Extract it on your device and open the folder instead.');
    }
    if (file.size > 300 * 1024 ** 2) busy(true, 'Unzipping ' + fmtSize(file.size) + '… this can take a moment');
    const zip = await window.JSZip.loadAsync(file);
    const base = e => e.name.split('/').pop();
    const entries = Object.values(zip.files).filter(e => !e.dir && !/(^|\/)__MACOSX\//.test(e.name) && !/^\./.test(base(e)));
    const txt = entries.find(e => /^_chat\.txt$/i.test(base(e)))
      || entries.find(e => /^whatsapp.*\.txt$/i.test(base(e)))
      || entries.find(e => /\.txt$/i.test(e.name));
    if (!txt) throw new Error('No chat .txt file found inside ' + file.name);
    const media = new Map();
    for (const e of entries) {
      if (e === txt) continue;
      media.set(base(e).toLowerCase(), { size: (e._data && e._data.uncompressedSize) || 0, blob: () => e.async('blob') });
    }
    const text = await txt.async('string');
    return addChat(text, [file.name, base(txt)], media);
  }

  async function handleFiles(list) {
    const files = Array.from(list || []).filter(f => f.size > 0);
    if (!files.length) return;
    const zips = files.filter(f => /\.zip$/i.test(f.name));
    const txts = files.filter(f => /\.txt$/i.test(f.name) && !/^\./.test(f.name));
    const rest = files.filter(f => !zips.includes(f) && !txts.includes(f));
    let opened = null;
    const source = zips.length ? 'zip' : txts.length && rest.length ? 'folder' : txts.length ? 'txt' : 'media';
    busy(true, files.length > 1 ? 'Reading ' + files.length + ' files…' : 'Opening ' + files[0].name + '…');
    try {
      for (const z of zips) opened = await openZip(z);
      if (txts.length) {
        const chatTxt = txts.filter(t => /whatsapp|_chat/i.test(t.name));
        const media = mediaMap(rest.concat(txts.filter(t => !chatTxt.includes(t) && chatTxt.length)));
        for (const t of (chatTxt.length ? chatTxt : txts)) opened = addChat(await t.text(), t.name, media);
      } else if (!zips.length && rest.length) {
        if (state.active) {
          addMedia(state.active, rest);
        } else {
          toast('Choose a WhatsApp export: a .zip or .txt file', { error: true });
        }
      }
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : 'Could not open that file', { error: true, ms: 7000 });
      track('Open Failed', { source });
    } finally {
      busy(false);
    }
    if (opened) {
      openChat(opened);
      track('Chat Opened', { source, messages: sizeBucket(opened.msgs.length), group: String(opened.isGroup) });
    }
  }

  function addMedia(chat, files) {
    mediaMap(files).forEach((v, k) => { chat.media.set(k, v); chat.urls.delete(k); });
    chat.gallery = null;
    const referenced = chat.msgs.filter(m => m.file && files.some(f => f.name.toLowerCase() === m.file.toLowerCase())).length;
    rerender();
    if (state.drawer === 'info') renderInfo(chat);
    toast('Added ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' (' + referenced + ' matched messages)');
  }

  async function filesFromDrop(dt) {
    const plain = Array.from(dt.files || []);
    const entries = Array.from(dt.items || []).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.some(e => e.isDirectory)) return plain;
    const out = [];
    const walk = async entry => {
      if (entry.isFile) {
        out.push(await new Promise((res, rej) => entry.file(res, rej)));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e);
        } while (batch.length);
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  ui.fileInput.addEventListener('change', () => { handleFiles(ui.fileInput.files); ui.fileInput.value = ''; });
  const folderInput = $('folderInput');
  const canPickFolder = 'webkitdirectory' in folderInput;
  const pickFolder = () => folderInput.click();
  folderInput.addEventListener('change', () => { handleFiles(folderInput.files); folderInput.value = ''; });
  $('folderBtn').hidden = !canPickFolder;
  $('folderBtn').addEventListener('click', pickFolder);
  ui.mediaInput.addEventListener('change', () => {
    if (state.active && ui.mediaInput.files.length) addMedia(state.active, Array.from(ui.mediaInput.files));
    ui.mediaInput.value = '';
  });
  $('importBtn').addEventListener('click', () => ui.fileInput.click());
  $('pickBtn').addEventListener('click', () => ui.fileInput.click());
  const dropzone = $('dropzone');
  dropzone.addEventListener('click', () => ui.fileInput.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.fileInput.click(); } });

  $('demoBtn').addEventListener('click', loadDemo);
  async function loadDemo() {
    busy(true, 'Loading demo…');
    try {
      const d = await window.WADemo.build();
      const chat = addChat(d.text, d.name, mediaMap(d.files));
      busy(false);
      openChat(chat);
      track('Demo Opened');
    } catch (err) {
      console.error(err);
      busy(false);
      toast('Could not load the demo', { error: true });
    }
  }

  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; ui.drop.hidden = false; });
  window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.drop.hidden = true; });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    ui.drop.hidden = true;
    filesFromDrop(e.dataTransfer).then(handleFiles).catch(err => toast(err.message || 'Could not read the dropped files', { error: true }));
  });

  /* ---------- theme ---------- */
  const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  function updateThemeIcon() {
    const dark = effectiveTheme() === 'dark';
    ui.themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
    ui.themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#202c33' : '#f0f2f5'));
  }
  function toggleTheme() {
    const t = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('cev-theme', t); } catch (e) { /* storage unavailable */ }
    updateThemeIcon();
  }
  ui.themeBtn.addEventListener('click', toggleTheme);

  /* ---------- rail, sidebar menu, help, composer ---------- */
  function showHelp() {
    const grid = document.getElementById('howtoGrid');
    showModal('How to export a chat', (grid ? grid.outerHTML.replace(' id="howtoGrid"', '') : '') +
      '<p class="hint">Open the .zip here, or drop the extracted folder. Everything is read in your browser and nothing is uploaded.</p>',
      [{ label: 'Try demo', run: loadDemo }, { label: 'Open export', primary: true, run: () => ui.fileInput.click() }]);
  }

  $('helpBtn').addEventListener('click', showHelp);
  $('railOpen').addEventListener('click', () => ui.fileInput.click());
  $('railChats').addEventListener('click', () => {
    if (isMobile() && ui.app.classList.contains('chat-open')) closeChatView();
    ui.chatFilter.focus();
  });
  ui.railMedia.addEventListener('click', () => { if (state.active) openDrawer('info'); });
  $('sideMenuBtn').addEventListener('click', e => {
    const dark = effectiveTheme() === 'dark';
    showMenu(e.currentTarget, [
      { icon: 'upload', label: 'Open chat export', run: () => ui.fileInput.click() },
      canPickFolder ? { icon: 'doc', label: 'Open extracted folder', run: pickFolder } : null,
      { icon: 'chat', label: 'Try a demo chat', run: loadDemo },
      { icon: dark ? 'sun' : 'moon', label: dark ? 'Light mode' : 'Dark mode', run: toggleTheme },
      { icon: 'help', label: 'How to export a chat', run: showHelp }
    ]);
  });

  const composer = $('composer');
  const readOnly = () => toast('This is an exported chat, so it’s read-only');
  composer.addEventListener('click', readOnly);
  composer.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); readOnly(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeIcon);

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', e => {
    if (!ui.lightbox.hidden) {
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') stepLb(-1);
      else if (e.key === 'ArrowRight') stepLb(1);
      return;
    }
    if (e.key === 'Escape') {
      if (!ui.modal.hidden) closeModal();
      else if (menuEl) closeMenu();
      else if (state.drawer) closeDrawer();
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (!typing && ui.modal.hidden && state.active && !ui.chat.hidden && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      if (e.key === 'Home') goTop(); else goBottom();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && state.active && !ui.chat.hidden) {
      e.preventDefault();
      openDrawer('search');
    }
  });

  /* ---------- errors, offline support, installed-app file opening ---------- */
  let lastErrorToast = 0;
  function unexpected(err) {
    console.error(err);
    busy(false);
    if (Date.now() - lastErrorToast < 5000) return;
    lastErrorToast = Date.now();
    toast('Something went wrong. If it keeps happening, reload the page.', { error: true, ms: 6000 });
  }
  window.addEventListener('error', e => { if (e.error) unexpected(e.error); });
  window.addEventListener('unhandledrejection', e => unexpected(e.reason));

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline mode unavailable:', err)));
  }

  // When installed as an app, .zip/.txt files can be opened with it directly (see manifest file_handlers).
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      if (!params.files || !params.files.length) return;
      handleFiles(await Promise.all(params.files.map(h => h.getFile())));
    });
  }

  /* ---------- init ---------- */
  updateThemeIcon();
  renderChatList();
  updateEmpty();
  if (location.hash === '#demo') loadDemo();
})();
