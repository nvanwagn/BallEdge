// Email subscriptions: double opt-in signup, one email per newly published article,
// one-click unsubscribe. Sends through Resend's HTTP API (https://resend.com), because
// many hosts (Railway included) block outgoing SMTP.
//
// Turned on by two environment variables:
//   RESEND_API_KEY   API key from resend.com
//   MAIL_FROM        sender, e.g.  BallEdge <news@balledge.net>  (domain verified in Resend)
const crypto = require('crypto');
const { db } = require('./db');
const { esc, excerpt } = require('./content');

const enabled = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const RESEND = (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, '');   // override only for testing
const BATCH = 100;              // Resend batch limit
const PAUSE_MS = 600;           // stay under Resend's default 2 requests/second
const RESEND_CONFIRM_AFTER = 10 * 60e3;

const newToken = () => crypto.randomBytes(24).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 254 && EMAIL_RE.test(e);

const Q = {
  byEmail: db.prepare('SELECT * FROM subscribers WHERE email = ?'),
  byToken: db.prepare('SELECT * FROM subscribers WHERE token = ?'),
  insert: db.prepare('INSERT INTO subscribers (email, token, status, created_at) VALUES (?, ?, \'pending\', ?)'),
  repend: db.prepare('UPDATE subscribers SET status = \'pending\', token = ?, unsubscribed_at = NULL WHERE id = ?'),
  sentConfirm: db.prepare('UPDATE subscribers SET confirm_sent_at = ? WHERE id = ?'),
  confirm: db.prepare('UPDATE subscribers SET status = \'active\', confirmed_at = ? WHERE id = ?'),
  unsub: db.prepare('UPDATE subscribers SET status = \'unsubscribed\', unsubscribed_at = ? WHERE id = ?'),
  active: db.prepare('SELECT id, email, token FROM subscribers WHERE status = \'active\' ORDER BY id'),
  activeCount: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE status = \'active\''),
  all: db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC'),
  remove: db.prepare('DELETE FROM subscribers WHERE id = ?'),
  markArticle: db.prepare('UPDATE articles SET emailed_at = ?, emailed_count = ? WHERE id = ?'),
  claimArticle: db.prepare('UPDATE articles SET emailed_at = ? WHERE id = ? AND emailed_at IS NULL'),
};

/* ------------------------------ Sending ------------------------------ */
async function resend(pathname, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(RESEND + pathname, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error('Resend kept refusing the request (rate limit or outage).');
}

// Shared email frame: gold rule, logo text, content, small footer.
function frame({ base, inner, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:Georgia,'Times New Roman',serif;color:#1b1b1b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-top:4px solid #f0cf00">
<tr><td style="padding:22px 28px 6px;font-family:Arial,sans-serif;font-weight:800;font-size:20px;letter-spacing:.04em">
<a href="${esc(base)}" style="color:#1b1b1b;text-decoration:none">BALL<span style="color:#c9ad00">EDGE</span></a></td></tr>
${inner}
<tr><td style="padding:18px 28px 26px;border-top:1px solid #e4e1d8;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#7a7974">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#f0cf00;color:#1b1b1b;font-family:Arial,sans-serif;font-weight:700;font-size:14px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;padding:12px 22px">${esc(label)}</a>`;

async function sendConfirmation(sub, base) {
  const url = `${base}/subscribe/confirm?token=${encodeURIComponent(sub.token)}`;
  await resend('/emails', {
    from: process.env.MAIL_FROM,
    to: [sub.email],
    subject: 'Confirm your BallEdge subscription',
    html: frame({
      base,
      inner: `<tr><td style="padding:10px 28px 26px;font-size:17px;line-height:1.6">
        <p>Thanks for signing up to get new BallEdge articles by email.</p>
        <p>Click below to confirm. If you didn't sign up, ignore this email and you won't hear from us again.</p>
        <p style="margin:24px 0">${button(url, 'Confirm subscription')}</p></td></tr>`,
      footer: `Or paste this link into your browser:<br>${esc(url)}`,
    }),
    text: `Thanks for signing up to get new BallEdge articles by email.\n\nConfirm here: ${url}\n\nIf you didn't sign up, ignore this email.`,
  });
  Q.sentConfirm.run(Date.now(), sub.id);
}

function articleEmail(article, sub, base) {
  const link = `${base}/article/${article.slug}`;
  const unsub = `${base}/unsubscribe?token=${encodeURIComponent(sub.token)}`;
  const img = article.share_image || article.hero_image;
  const dek = article.dek || excerpt(article, 220);
  return {
    from: process.env.MAIL_FROM,
    to: [sub.email],
    subject: article.title,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: frame({
      base,
      inner: `${img ? `<tr><td style="padding:8px 28px 0"><a href="${esc(link)}"><img src="${esc(base + img)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0"></a></td></tr>` : ''}
        <tr><td style="padding:18px 28px 26px">
          <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8a7500">${esc(article.category)}</p>
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2"><a href="${esc(link)}" style="color:#1b1b1b;text-decoration:none">${esc(article.title)}</a></h1>
          ${dek ? `<p style="margin:0 0 22px;font-size:17px;line-height:1.6;color:#3a3935">${esc(dek)}</p>` : ''}
          ${button(link, 'Read the article')}
        </td></tr>`,
      footer: `You're getting this because you subscribed to new articles at ${esc(base.replace(/^https?:\/\//, ''))}.<br>
        <a href="${esc(unsub)}" style="color:#7a7974">Unsubscribe</a>`,
    }),
    text: `${article.title}\n\n${dek}\n\nRead it: ${link}\n\n--\nUnsubscribe: ${unsub}`,
  };
}

// Emails a newly published article to every active subscriber, once per article.
// Runs in the background; progress and failures go to the server log.
async function notifyNewArticle(article, base) {
  if (!enabled()) return;
  if (!Q.claimArticle.run(Date.now(), article.id).changes) return;   // already sent (or sending)
  const subs = Q.active.all();
  let sent = 0;
  try {
    for (let i = 0; i < subs.length; i += BATCH) {
      if (i) await sleep(PAUSE_MS);
      const chunk = subs.slice(i, i + BATCH);
      await resend('/emails/batch', chunk.map((s) => articleEmail(article, s, base)));
      sent += chunk.length;
    }
    console.log(`Newsletter: emailed "${article.title}" to ${sent} subscriber(s)`);
  } catch (err) {
    console.error(`Newsletter: stopped after ${sent} of ${subs.length} for "${article.title}":`, err.message);
  } finally {
    Q.markArticle.run(Date.now(), sent, article.id);
  }
}

/* ------------------------------ Signup / confirm / unsubscribe ------------------------------ */
// Always resolves with the same public outcome, so the form never reveals who is subscribed.
async function subscribe(rawEmail, base) {
  const email = normalizeEmail(rawEmail);
  if (!validEmail(email)) return { error: 'Please enter a valid email address.' };
  if (!enabled()) return { error: 'Email signups are not available right now.' };
  let sub = Q.byEmail.get(email);
  if (!sub) {
    Q.insert.run(email, newToken(), Date.now());
    sub = Q.byEmail.get(email);
  } else if (sub.status === 'unsubscribed') {
    Q.repend.run(newToken(), sub.id);
    sub = Q.byEmail.get(email);
  } else if (sub.status === 'active') {
    return { ok: true };
  } else if (sub.confirm_sent_at && Date.now() - sub.confirm_sent_at < RESEND_CONFIRM_AFTER) {
    return { ok: true };   // pending, and we just sent a confirmation
  }
  try {
    await sendConfirmation(sub, base);
  } catch (err) {
    console.error('Newsletter: confirmation email failed:', err.message);
    return { error: 'We couldn\'t send the confirmation email. Please try again later.' };
  }
  return { ok: true };
}

function confirm(token) {
  const sub = token ? Q.byToken.get(String(token)) : null;
  if (!sub) return null;
  if (sub.status !== 'active') Q.confirm.run(Date.now(), sub.id);
  return sub;
}

function findByToken(token) { return token ? Q.byToken.get(String(token)) || null : null; }

function unsubscribe(token) {
  const sub = findByToken(token);
  if (sub && sub.status !== 'unsubscribed') Q.unsub.run(Date.now(), sub.id);
  return sub;
}

// Simple in-memory throttle: 5 signups per IP per hour.
const hits = new Map();
function signupAllowed(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) { hits.set(ip, { count: 1, reset: now + 3600e3 }); return true; }
  h.count++;
  return h.count <= 5;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 3600e3).unref();

module.exports = {
  enabled, subscribe, confirm, unsubscribe, findByToken, notifyNewArticle, signupAllowed,
  activeCount: () => Q.activeCount.get().n,
  list: () => Q.all.all(),
  remove: (id) => Q.remove.run(id).changes > 0,
};
