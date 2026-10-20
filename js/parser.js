/* WhatsApp chat export parser.
 * Handles Android ("31/12/20, 22:15 - Name: text") and iOS ("[31/12/20, 22:15:32] Name: text")
 * exports, 12/24h clocks, DMY/MDY/YMD dates, multi-line messages, attachments and system events. */
(function (global) {
  'use strict';

  const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
  const ODD_SPACES = /[    ]/g;

  const DATE = '(\\d{1,4})[/.\\-](\\d{1,2})[/.\\-](\\d{1,4})\\.?';
  const TIME = '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?(?:\\s?([AaPp])\\.?\\s?[Mm]\\.?)?';
  const HEAD_IOS = new RegExp('^\\[' + DATE + ',?\\s+' + TIME + '\\]\\s?(.*)$');
  const HEAD_ANDROID = new RegExp('^' + DATE + ',?\\s+' + TIME + '\\s?[-\\u2013\\u2014]\\s(.*)$');

  const ATTACH_IOS = /<attached:\s*([^>]+?)\s*>/i;
  const ATTACH_ANDROID = /^(.+?\.[A-Za-z0-9]{2,5})(?:\s+•.*?)?\s+\((?:file attached|archivo adjunto|arquivo anexado|fichier joint|Datei angehängt|file allegato|bestand bijgevoegd|dosya ekli|файл прикреплён|файл вложен|file terlampir|fail dilampirkan)\)$/i;
  const OMITTED = /^<?\s*(media|image|video|audio|sticker|gif|document|contact card|view once (?:voice message|photo|video|image))\s+omitted\s*>?$/i;
  const OMITTED_L10N = /^<(Multimedia omitido|Medien ausgeschlossen|Médias omis|Mídia oculta|Media weggelaten|Media omessi|Medya dahil edilmedi|Без медиафайлов|Media tidak disertakan)>$/i;
  const DOC_OMITTED = /document omitted$/i;
  const DELETED = /^(This message was deleted|You deleted this message|Se eliminó este mensaje|Eliminaste este mensaje|Diese Nachricht wurde gelöscht|Du hast diese Nachricht gelöscht|Ce message a été supprimé|Vous avez supprimé ce message|Essa mensagem foi apagada|Você apagou esta mensagem|Questo messaggio è stato eliminato|Hai eliminato questo messaggio)\.?$/i;
  const YOU_DELETED = /^(You deleted this message|Eliminaste este mensaje|Du hast diese Nachricht gelöscht|Vous avez supprimé ce message|Você apagou esta mensagem|Hai eliminato questo messaggio)\.?$/i;
  const EDITED = /\s*<(This message was edited|Se editó este mensaje|Diese Nachricht wurde bearbeitet|Ce message a été modifié|Mensagem editada|Questo messaggio è stato modificato)>\s*$/i;
  const CALL = /^(?:Missed (?:group )?(?:voice|video) call|(?:Voice|Video) call|Silenced (?:voice|video) call|Group (?:voice|video) call)(?:,.*)?$/i;
  const LOCATION = /^(?:location|ubicación|standort|position|localização|posizione|lokasi):\s*(https?:\/\/\S+)$/i;
  const MAPS_Q = /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/;
  const ENCRYPTED = /^(Messages and calls are end-to-end encrypted|Messages to this (?:group|chat) are now secured|Messages you send to this (?:group|chat))/i;
  const SYS_TEXT = /^(?:.*security code (?:changed|with)|.*created (?:group|this group)|.*changed (?:the subject|this group's icon|the group description|their phone number|the group name|the settings|to )|.*\b(?:added|removed|left|joined using this group's invite link|joined from the community|joined)\b|.*turned (?:on|off) disappearing messages|.*is a contact\.?$|Waiting for this message|.*pinned a message|.*now an admin|.*no longer an admin|.*deleted this group's icon|.*started a call|.*blocked this contact|.*unblocked this contact)/i;
  const SYS_VERBS = /\b(changed|added|removed|left|joined|created|deleted|turned|pinned|updated|reset|blocked|unblocked|started|now)\b/i;
  const GROUP_NAME = /(?:created group|changed the subject (?:from .+? )?to|changed the group name (?:from .+? )?to|changed this group's name (?:from .+? )?to)\s+["“](.+?)["”]\s*$/i;
  const GROUP_HINT = /\b(group|added|removed|left|admin|invite link|community)\b/i;

  function looksLikeSystemName(name) {
    return name.length > 60 || (name.trim().split(/\s+/).length >= 3 && SYS_VERBS.test(name));
  }

  function fileType(name) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (/^(jpe?g|png|gif|bmp|avif)$/.test(ext)) return 'img';
    if (ext === 'webp') return /STK|STICKER/i.test(name) ? 'stk' : 'img';
    if (/^(mp4|mov|m4v|3gp|webm|mkv)$/.test(ext)) return 'vid';
    if (/^(opus|ogg|oga|m4a|mp3|aac|wav|amr|weba)$/.test(ext)) return (ext === 'opus' || /PTT|AUDIO|voice/i.test(name)) ? 'voice' : 'audio';
    if (ext === 'vcf') return 'vcf';
    return 'doc';
  }

  function omittedType(s) {
    s = s.toLowerCase();
    if (/view once/.test(s)) return 'once';
    if (/image|photo/.test(s)) return 'image';
    if (/video/.test(s)) return 'video';
    if (/audio/.test(s)) return 'audio';
    if (/sticker/.test(s)) return 'sticker';
    if (/gif/.test(s)) return 'gif';
    if (/document/.test(s)) return 'document';
    if (/contact/.test(s)) return 'contact';
    return 'media';
  }

  function toTs(h, order) {
    let d, mo, y;
    if (order === 'ymd') { y = h.a; mo = h.b; d = h.c; }
    else if (order === 'mdy') { mo = h.a; d = h.b; y = h.c; }
    else { d = h.a; mo = h.b; y = h.c; }
    if (y < 100) y += 2000;
    let hr = h.h;
    if (h.ap === 'p' && hr < 12) hr += 12;
    if (h.ap === 'a' && hr === 12) hr = 0;
    return new Date(y, mo - 1, d, hr, h.mi, h.s).getTime();
  }

  // Count how often time goes backwards — the right date order keeps the chat (mostly) chronological.
  function disorder(heads, order) {
    let bad = 0, prev = -Infinity;
    for (const h of heads) {
      const t = toTs(h, order);
      if (t < prev) bad++;
      prev = t;
    }
    return bad;
  }

  function detectOrder(heads) {
    let aBig = false, bBig = false, ap = false;
    for (const h of heads) {
      if (h.aLen === 4) return { order: 'ymd', ambiguous: false };
      if (h.a > 12) aBig = true;
      if (h.b > 12) bBig = true;
      if (h.ap) ap = true;
    }
    if (aBig && !bBig) return { order: 'dmy', ambiguous: false };
    if (bBig && !aBig) return { order: 'mdy', ambiguous: false };
    const dmy = disorder(heads, 'dmy'), mdy = disorder(heads, 'mdy');
    if (dmy !== mdy) return { order: dmy < mdy ? 'dmy' : 'mdy', ambiguous: true };
    return { order: ap ? 'mdy' : 'dmy', ambiguous: true };
  }

  function parsePoll(text) {
    const lines = text.split('\n').slice(1);
    const options = [];
    const question = [];
    for (const line of lines) {
      const o = /^OPTION:\s*(.*?)\s*\((\d+)\s+votes?\)\s*$/i.exec(line);
      if (o) options.push({ label: o[1], votes: +o[2] });
      else if (!options.length) question.push(line);
    }
    return { question: question.join('\n').trim(), options };
  }

  function parse(raw, options) {
    options = options || {};
    const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
    const heads = [];
    let cur = null;

    for (const original of lines) {
      const line = original.replace(ODD_SPACES, ' ').replace(BIDI, '');
      const m = HEAD_IOS.exec(line) || HEAD_ANDROID.exec(line);
      if (m) {
        cur = {
          a: +m[1], b: +m[2], c: +m[3], aLen: m[1].length,
          h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0,
          ap: m[7] ? m[7].toLowerCase() : '',
          body: m[8], more: [],
          // iOS marks system lines and attachments with a left-to-right mark right after "Name: "
          lrm: /:\s‎/.test(original)
        };
        heads.push(cur);
      } else if (cur) {
        cur.more.push(line);
      }
    }

    const det = options.order ? { order: options.order, ambiguous: true } : detectOrder(heads);
    const messages = [];
    const counts = new Map();
    let hasAmPm = false, systemName = null, groupName = null, groupHints = false, youDeleted = null;

    for (const h of heads) {
      if (h.ap) hasAmPm = true;
      const ts = toTs(h, det.order);
      const body = h.body;
      let sender = null, text;
      const idx = body.indexOf(': ');
      if (idx > 0 && !looksLikeSystemName(body.slice(0, idx))) {
        sender = body.slice(0, idx).trim();
        text = [body.slice(idx + 2)].concat(h.more).join('\n');
      } else if (/^[^:]{1,60}:$/.test(body) && h.more.length && !looksLikeSystemName(body)) {
        sender = body.slice(0, -1).trim();
        text = h.more.join('\n');
      } else {
        text = [body].concat(h.more).join('\n');
      }
      text = text.replace(/\s+$/, '');

      const msg = { id: messages.length, ts, sender, text, kind: 'text' };

      if (!sender || ENCRYPTED.test(text) || (h.lrm && SYS_TEXT.test(text))) {
        if (sender && h.lrm && !systemName) systemName = sender;
        msg.kind = 'system';
        msg.sender = null;
        const g = GROUP_NAME.exec(text);
        if (g) groupName = g[1];
        if (!ENCRYPTED.test(text) && GROUP_HINT.test(text)) groupHints = true;
        messages.push(msg);
        continue;
      }

      let t = text;
      const ed = EDITED.exec(t);
      if (ed) { msg.edited = true; t = t.slice(0, ed.index); }
      const nl = t.indexOf('\n');
      const first = (nl < 0 ? t : t.slice(0, nl)).trim();
      const rest = nl < 0 ? '' : t.slice(nl + 1).trim();
      const whole = t.trim();
      let a;

      if ((a = ATTACH_IOS.exec(t))) {
        msg.kind = 'media';
        msg.file = a[1];
        msg.ftype = fileType(a[1]);
        msg.text = t.replace(a[0], '').trim();
      } else if ((a = ATTACH_ANDROID.exec(first))) {
        msg.kind = 'media';
        msg.file = a[1].trim();
        msg.ftype = fileType(msg.file);
        msg.text = rest;
      } else if (OMITTED.test(first) || OMITTED_L10N.test(first) || DOC_OMITTED.test(first) || whole === 'null') {
        msg.kind = 'omitted';
        msg.otype = whole === 'null' ? 'once' : omittedType(first);
        msg.text = rest;
      } else if (DELETED.test(whole)) {
        msg.kind = 'deleted';
        msg.text = '';
        if (YOU_DELETED.test(whole)) youDeleted = sender;
      } else if (CALL.test(whole)) {
        msg.kind = 'call';
        msg.text = whole;
      } else if ((a = LOCATION.exec(whole))) {
        msg.kind = 'location';
        msg.url = a[1];
        const q = MAPS_Q.exec(a[1]);
        if (q) { msg.lat = +q[1]; msg.lng = +q[2]; }
        msg.text = '';
      } else if (/^POLL:\n/i.test(t)) {
        msg.kind = 'poll';
        msg.poll = parsePoll(t);
        msg.text = msg.poll.question;
      } else {
        msg.text = t;
      }

      counts.set(sender, (counts.get(sender) || 0) + 1);
      messages.push(msg);
    }

    const participants = Array.from(counts.entries()).sort((x, y) => y[1] - x[1]).map(e => e[0]);

    return {
      messages, participants, counts,
      order: det.order, ambiguous: det.ambiguous,
      hasAmPm, systemName, groupName, groupHints, youDeleted
    };
  }

  global.WAParser = { parse, fileType };
})(typeof window !== 'undefined' ? window : globalThis);
