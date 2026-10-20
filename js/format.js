/* WhatsApp-style text formatting: *bold*, _italic_, ~strike~, ```mono```, `code`, > quotes, lists, links. */
(function (global) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = s => String(s).replace(/[&<>"]/g, c => ESC[c]);

  const LINK = /\b((?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]}*_~'])|\b([\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})\b/gi;
  const TOKEN = /\u0000(\d+)\u0001/g;

  // Wrap matches of `re` in <mark>, touching only text (never tags, entities or placeholders).
  function mark(html, re) {
    if (!re) return html;
    return html.replace(/(<[^>]*>|\u0000\d+\u0001|&[a-z#0-9]+;)|([^<&\u0000]+)/gi,
      (m, skip, txt) => skip || txt.replace(re, '<mark>$&</mark>'));
  }

  function format(text, re) {
    const parts = [];
    const protect = html => '\u0000' + (parts.push(html) - 1) + '\u0001';
    let s = String(text);

    s = s.replace(/```([\s\S]+?)```/g, (_, c) => protect('<code class="pre">' + mark(esc(c), re) + '</code>'));
    s = s.replace(/`([^`\n]+)`/g, (_, c) => protect('<code>' + mark(esc(c), re) + '</code>'));
    s = s.replace(LINK, (_, url, email) => {
      if (email) return protect('<a href="mailto:' + esc(email) + '">' + mark(esc(email), re) + '</a>');
      const href = /^www\./i.test(url) ? 'https://' + url : url;
      return protect('<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + mark(esc(url), re) + '</a>');
    });

    s = esc(s);
    s = s.split('\n').map(line => {
      if (/^&gt; /.test(line)) return '<span class="q">' + line.slice(5) + '</span>';
      if (/^[*-] /.test(line)) return '<span class="li">•</span> ' + line.slice(2);
      return line;
    }).join('\n');

    s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1<b>$2</b>');
    s = s.replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1<i>$2</i>');
    s = s.replace(/(^|[^\w~])~(?=\S)([^~\n]*?\S)~(?![\w~])/g, '$1<s>$2</s>');

    s = mark(s, re);
    return s.replace(TOKEN, (_, i) => parts[+i]);
  }

  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u;
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  // True for 1–3 emoji with no other text: rendered large and without a bubble, like WhatsApp.
  function isEmojiOnly(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 40 || !EMOJI_ONLY.test(t)) return false;
    const n = segmenter ? Array.from(segmenter.segment(t.replace(/\s+/g, ''))).length : Array.from(t.replace(/\s+/g, '')).length;
    return n <= 3;
  }

  global.WAFormat = { esc, format, mark, isEmojiOnly };
})(typeof window !== 'undefined' ? window : globalThis);
