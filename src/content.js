// Content helpers: sanitizing article HTML, rendering code boxes, slugs, dates.
const sanitizeHtml = require('sanitize-html');
const hljs = require('highlight.js');

const CODE_LANGS = { sql: 'SQL', r: 'R', python: 'Python', plaintext: 'Text' };
const CATEGORIES = ['NFL', 'NBA', 'General'];

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const decode = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// Only these tags/attributes are ever stored, no matter what the editor sends.
function sanitizeBody(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li',
      'blockquote', 'br', 'hr', 'figure', 'figcaption', 'img', 'pre', 'code', 'sup', 'sub',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt'],
      figure: ['class'],
      pre: ['data-lang'],
    },
    allowedClasses: { figure: ['fig-full', 'fig-inset'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    transformTags: {
      b: 'strong',
      i: 'em',
      a: (tag, attribs) => {
        const external = /^https?:/i.test(attribs.href || '');
        return { tagName: 'a', attribs: external ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' } : attribs };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !/^(\/uploads\/|https:\/\/)/.test(frame.attribs.src || ''),
  });
}

// Turns stored <pre data-lang="sql"><code>…</code></pre> into the styled, highlighted code box.
function renderBody(html) {
  return html.replace(/<pre data-lang="([a-z]+)"><code>([\s\S]*?)<\/code><\/pre>/g, (m, lang, code) => {
    const raw = decode(code.replace(/<br\s*\/?>/g, '\n'));
    const language = CODE_LANGS[lang] ? lang : 'plaintext';
    const highlighted = language === 'plaintext' ? esc(raw) : hljs.highlight(raw, { language, ignoreIllegals: true }).value;
    return `<div class="code-box"><div class="code-head"><span class="code-lang">${CODE_LANGS[language]}</span>` +
      `<button type="button" class="code-copy" aria-label="Copy code">Copy</button></div>` +
      `<pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`;
  });
}

function plainText(html) {
  return decode(String(html || '').replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function readingTime(html) {
  const words = plainText(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

function excerpt(article, len = 170) {
  if (article.dek) return article.dek;
  const t = plainText(article.body_html);
  return t.length > len ? t.slice(0, len).replace(/\s+\S*$/, '') + '…' : t;
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
}

function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'Just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'Just now';
}

const TZ = process.env.SITE_TIMEZONE || 'America/New_York';
function fullDate(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${date}, ${time}`;
}
function longToday() {
  return new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = { esc, sanitizeBody, renderBody, readingTime, excerpt, slugify, timeAgo, fullDate, longToday, CODE_LANGS, CATEGORIES, plainText };
