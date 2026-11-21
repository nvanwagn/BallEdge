// Server-rendered pages. Every page shares layout(): header, left dropdown menu, footer.
const { esc, excerpt, timeAgo, fullDate, longToday, readingTime, CATEGORIES } = require('./content');
const news = require('./newsletter');

// "Get new articles by email" form; hidden until email sending is configured.
// The `website` field is a honeypot: people never see it, bots fill it in.
function signupForm(variant, heading, sub) {
  if (!news.enabled()) return '';
  const id = `signup-${variant}`;
  return `<form class="signup signup-${variant}" method="post" action="/subscribe">
    <label class="signup-head" for="${id}">${heading}</label>
    ${sub ? `<p class="signup-sub">${sub}</p>` : ''}
    <div class="signup-row">
      <input id="${id}" type="email" name="email" required maxlength="254" placeholder="you@example.com" autocomplete="email">
      <button class="btn btn-gold" type="submit">Subscribe</button>
    </div>
    <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  </form>`;
}

const SITE = 'BallEdge';
const TAGLINE = 'Numbers behind the NFL & NBA';

const timeTag = (ts, cls = 'ago') =>
  `<time class="${cls}" datetime="${new Date(ts).toISOString()}" data-ts="${ts}" title="${esc(fullDate(ts))}">${timeAgo(ts)}</time>`;

const kicker = (cat) => `<a class="kicker" href="/section/${esc(cat.toLowerCase())}">${esc(cat)}</a>`;

const heroImg = (a, sizes = '') =>
  a.hero_image
    ? `<img src="${esc(a.hero_image)}" alt="${esc(a.hero_caption || a.title)}" loading="lazy" ${sizes}>`
    : `<div class="img-fallback"><img src="/img/logo.png" alt=""></div>`;

function layout({ title, ogTitle, body, user, description = TAGLINE, bodyClass = '', head = '', scripts = '' }) {
  const pageTitle = title ? `${esc(title)} | ${SITE}` : `${SITE} — ${TAGLINE}`;
  const authorLinks = user
    ? `<li class="menu-label">Author · ${esc(user.displayName)}</li>
       <li><a href="/admin/new">New Article</a></li>
       <li><a href="/admin">My Articles</a></li>
       <li><a href="/admin/about">Edit About Page</a></li>
       <li><a href="/admin/account">Account</a></li>
       <li><a href="/admin/subscribers">Subscribers</a></li>
       <li><a href="/admin/backup">Backup &amp; Restore</a></li>
       <li><form method="post" action="/logout"><button type="submit" class="linklike">Sign Out</button></form></li>`
    : `<li class="menu-signin"><a href="/login">Author Sign In</a></li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(ogTitle || title || SITE)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" type="image/png" href="/img/favicon.png">
<link rel="preload" href="/fonts/playfair-display-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/site.css">
${head}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
  <div class="masthead-inner">
    <div class="mh-left">
      <button class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="siteMenu">
        <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span><span class="menu-word">Menu</span>
      </button>
      <nav class="site-menu" id="siteMenu" aria-label="Site" hidden>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/section/nfl">NFL</a></li>
          <li><a href="/section/nba">NBA</a></li>
          <li><a href="/about">About Me</a></li>
          ${authorLinks}
        </ul>
      </nav>
    </div>
    <a class="brand" href="/" aria-label="${SITE} home">
      <img class="brand-mark" src="/img/logo-light.png" alt="">
      <img class="brand-name" src="/img/nameplate-light.png" alt="${SITE}">
    </a>
    <div class="mh-right">
      ${user ? `<a class="btn btn-gold btn-sm" href="/admin/new">+ New Article</a>` : `<span class="mh-date">${esc(longToday())}</span>`}
    </div>
  </div>
</header>
<div class="gold-rule"></div>
<main id="main" class="page">
${body}
</main>
<footer class="site-footer">
  <div class="footer-inner">
    <a class="footer-brand" href="/"><img src="/img/nameplate-gold.png" alt="${SITE}"></a>
    <p class="footer-tag">${TAGLINE}</p>
    ${signupForm('footer', 'Get new articles by email', '')}
    <nav class="footer-links"><a href="/">Home</a><a href="/section/nfl">NFL</a><a href="/section/nba">NBA</a><a href="/about">About Me</a>${user ? '' : '<a href="/login">Sign In</a>'}</nav>
    <p class="footer-copy">© ${new Date().getFullYear()} ${SITE}. All rights reserved.</p>
  </div>
</footer>
<script src="/js/site.js" defer></script>
${scripts}
</body>
</html>`;
}

/* ---------- Home (Fox-style front page) ---------- */
function storyCard(a, variant = 'card') {
  return `<article class="story ${variant}">
    <a class="story-media" href="/article/${esc(a.slug)}" tabindex="-1" aria-hidden="true">${heroImg(a)}</a>
    <div class="story-text">
      ${kicker(a.category)}
      <h3 class="story-title"><a href="/article/${esc(a.slug)}">${esc(a.title)}</a></h3>
      ${variant === 'card' ? `<p class="story-dek">${esc(excerpt(a, 120))}</p>` : ''}
      ${timeTag(a.published_at)}
    </div>
  </article>`;
}

function home({ articles, user }) {
  if (!articles.length) {
    return layout({
      user,
      body: `<section class="empty-state">
        <img src="/img/logo.png" alt="" class="empty-logo">
        <h1 class="display">The first story is coming soon.</h1>
        <p>${user ? 'You are signed in — write your first article to fill the front page.' : 'Check back shortly for statistical deep dives on the NFL and NBA.'}</p>
        ${user ? '<a class="btn btn-gold" href="/admin/new">Write the first article</a>' : ''}
      </section>`,
    });
  }

  const [lead, ...rest] = articles;
  const right = rest.slice(0, 2);
  const more = rest.slice(2, 14);
  const nfl = articles.filter((a) => a.category === 'NFL').slice(0, 4);
  const nba = articles.filter((a) => a.category === 'NBA').slice(0, 4);

  const section = (name, list) => list.length ? `<section class="section-block">
      <header class="section-head"><h2><a href="/section/${name.toLowerCase()}">${name}</a></h2><a class="section-more" href="/section/${name.toLowerCase()}">All ${name} stories →</a></header>
      <div class="mini-list">${list.map((a) => storyCard(a, 'mini')).join('')}</div>
    </section>` : '';

  const body = `
  <section class="front${right.length ? '' : ' solo'}">
    <article class="lead">
      <a class="lead-media" href="/article/${esc(lead.slug)}">${heroImg(lead, 'fetchpriority="high"')}</a>
      <div class="lead-text">
        ${kicker(lead.category)}
        <h1 class="lead-title"><a href="/article/${esc(lead.slug)}">${esc(lead.title)}</a></h1>
        <p class="lead-dek">${esc(excerpt(lead, 220))}</p>
        <p class="meta">${timeTag(lead.published_at)} <span class="dot">·</span> ${readingTime(lead.body_html)} min read</p>
      </div>
    </article>

    ${right.length ? `<aside class="front-right">${right.map((a) => storyCard(a, 'stack')).join('')}</aside>` : ''}
  </section>

  ${more.length ? `<section class="section-block">
    <header class="section-head"><h2>More Stories</h2></header>
    <div class="card-grid">${more.map((a) => storyCard(a)).join('')}</div>
  </section>` : ''}

  <div class="two-sections">${section('NFL', nfl)}${section('NBA', nba)}</div>`;

  return layout({ user, body, bodyClass: 'home' });
}

/* ---------- Section listing ---------- */
function sectionPage({ name, articles, user }) {
  const body = `<header class="page-head"><p class="eyebrow">Section</p><h1 class="display">${esc(name)}</h1></header>
    ${articles.length ? `<div class="list-stream">${articles.map((a) => storyCard(a, 'row')).join('')}</div>`
      : `<p class="muted center pad">No ${esc(name)} articles yet.</p>`}`;
  return layout({ user, title: name, body });
}

/* ---------- Article (ESPN-style) ---------- */
// One Share button: opens the phone's native share sheet when available,
// otherwise a small menu with X, Facebook, LinkedIn, email and Copy link.
function shareMenu(url, title, place) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const id = 'share-' + place;
  return `<div class="share-wrap" data-share data-url="${esc(url)}" data-title="${esc(title)}">
    <button type="button" class="share-main" aria-haspopup="true" aria-expanded="false" aria-controls="${id}">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18 16.1c-.8 0-1.4.3-2 .8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.2c.5.5 1.2.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.7L8 9.8C7.5 9.3 6.8 9 6 9c-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2-.8l7.1 4.2c-.1.2-.1.4-.1.6 0 1.6 1.3 2.9 2.9 2.9s2.9-1.3 2.9-2.9-1.2-2.9-2.8-2.9z"/></svg>
      <span>Share</span>
    </button>
    <div class="share-pop" id="${id}" role="menu" hidden>
      <a role="menuitem" href="https://x.com/intent/tweet?url=${u}&text=${t}" target="_blank" rel="noopener"><span class="si">𝕏</span>Share on X</a>
      <a role="menuitem" href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener"><span class="si">f</span>Share on Facebook</a>
      <a role="menuitem" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" target="_blank" rel="noopener"><span class="si">in</span>Share on LinkedIn</a>
      <a role="menuitem" href="mailto:?subject=${t}&body=${u}"><span class="si">✉</span>Email</a>
      <button role="menuitem" type="button" data-copy-link><span class="si">⧉</span>Copy link</button>
    </div>
  </div>`;
}

function articlePage({ article: a, author, bodyHtml, related, user, url, base }) {
  const draft = a.status !== 'published';
  const ts = a.published_at || a.updated_at;
  const body = `
  ${draft ? `<div class="draft-banner">Draft preview — only you can see this. <a href="/admin/edit/${a.id}">Keep editing</a></div>` : ''}
  <article class="article">
    <div class="article-top">
      <header class="article-head">
        ${kicker(a.category)}
        <h1 class="article-title">${esc(a.title)}</h1>
        ${a.dek ? `<p class="article-dek">${esc(a.dek)}</p>` : ''}
        <div class="byline">
          <img class="byline-avatar" src="/img/logo.png" alt="">
          <div class="byline-text">
            <span class="byline-name">${esc(author || 'BallEdge')}</span>
            <span class="byline-date">${esc(fullDate(ts))} <span class="dot">·</span> ${timeTag(ts, 'ago inline')} <span class="dot">·</span> ${readingTime(a.body_html)} min read</span>
          </div>
          ${shareMenu(url, a.title, 'top')}
        </div>
        ${user ? `<div class="author-tools"><a href="/admin/edit/${a.id}">Edit this article</a></div>` : ''}
      </header>

      ${a.hero_image ? `<figure class="article-hero">
        <img src="${esc(a.hero_image)}" alt="${esc(a.hero_caption || a.title)}">
        ${a.hero_caption ? `<figcaption>${esc(a.hero_caption)}</figcaption>` : ''}
      </figure>` : ''}
    </div>

    <div class="article-wrap">
      <div class="article-main">
        <div class="article-body">${bodyHtml}</div>
        <div class="article-end">
          <img src="/img/logo.png" alt="">
          <div class="article-end-share"><span>Enjoyed this? Pass it on.</span>${shareMenu(url, a.title, 'bottom')}</div>
        </div>
        ${draft ? '' : signupForm('article', 'Get the next one in your inbox', 'One email when a new article is published. No spam, unsubscribe anytime.')}
      </div>

    <aside class="article-rail">
      <h2 class="rail-title">Top Headlines</h2>
      <ul class="rail-list">
        ${related.map((r) => `<li><a href="/article/${esc(r.slug)}">${esc(r.title)}</a>${timeTag(r.published_at)}</li>`).join('') || '<li class="muted">More stories soon.</li>'}
      </ul>
    </aside>
    </div>
  </article>`;

  // Link-preview tags. X/Twitter, Facebook, iMessage, Slack, etc. read these to show the
  // headline and hero image when the link is shared. Image URLs must be absolute.
  const img = a.share_image || a.hero_image;
  const imgUrl = img ? base + img : `${base}/img/share-default.jpg`;
  const sized = !img || a.share_image; // our crops and the default are exactly 1200×630
  const desc = excerpt(a);
  const handle = (process.env.TWITTER_HANDLE || '').replace(/^@?/, '@');
  const head = `
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(imgUrl)}">
${sized ? '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">' : ''}
<meta property="og:image:alt" content="${esc(a.hero_caption || a.title)}">
<meta property="article:published_time" content="${new Date(ts).toISOString()}">
<meta property="article:section" content="${esc(a.category)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(a.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imgUrl)}">
<meta name="twitter:image:alt" content="${esc(a.hero_caption || a.title)}">
${handle.length > 1 ? `<meta name="twitter:site" content="${esc(handle)}">\n<meta name="twitter:creator" content="${esc(handle)}">` : ''}
${draft ? '<meta name="robots" content="noindex">' : ''}`;
  return layout({ user, title: a.title, ogTitle: a.title, description: desc, body, head, bodyClass: 'article-page' });
}

/* ---------- About ---------- */
function aboutPage({ about, user }) {
  const body = `<div class="about">
    <header class="page-head"><p class="eyebrow">About</p><h1 class="display">${esc(about.title)}</h1></header>
    ${about.photo ? `<figure class="about-photo"><img src="${esc(about.photo)}" alt="${esc(about.title)}"></figure>` : ''}
    <div class="article-body">${about.bodyHtml}</div>
    ${user ? '<p class="author-tools center"><a href="/admin/about">Edit this page</a></p>' : ''}
  </div>`;
  return layout({ user, title: 'About Me', body });
}

/* ---------- Auth pages ---------- */
function authCard({ heading, sub, error, fields, button, action, user, foot = '' }) {
  return layout({
    user, title: heading, bodyClass: 'auth-page',
    body: `<section class="auth-card">
      <img src="/img/logo.png" alt="" class="auth-logo">
      <h1 class="display small">${esc(heading)}</h1>
      ${sub ? `<p class="muted">${sub}</p>` : ''}
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
      <form method="post" action="${action}" class="stack-form">
        ${fields}
        <button class="btn btn-dark btn-block" type="submit">${esc(button)}</button>
      </form>
      ${foot}
    </section>`,
  });
}

const field = (name, label, type = 'text', value = '', extra = '') =>
  `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;

function loginPage({ error, next = '/', username = '', notice = '' }) {
  return authCard({
    heading: 'Author Sign In', error, button: 'Sign In', action: `/login?next=${encodeURIComponent(next)}`,
    sub: notice ? `<span class="form-ok">${esc(notice)}</span>` : '',
    fields: field('username', 'Username', 'text', username, 'autocomplete="username" required autofocus') +
      field('password', 'Password', 'password', '', 'autocomplete="current-password" required'),
  });
}

function setupPage({ error, values = {} }) {
  return authCard({
    heading: 'Create Your Author Account',
    sub: 'This one-time setup creates the account you\'ll use to write articles. It disappears once an account exists.',
    error, button: 'Create Account', action: '/setup',
    fields: field('display_name', 'Your name (shown on articles)', 'text', values.display_name, 'required autofocus') +
      field('username', 'Username', 'text', values.username, 'autocomplete="username" required') +
      field('password', 'Password (at least 10 characters)', 'password', '', 'autocomplete="new-password" minlength="10" required') +
      field('password2', 'Confirm password', 'password', '', 'autocomplete="new-password" minlength="10" required'),
  });
}

function accountPage({ user, error, notice, displayName }) {
  return authCard({
    user, heading: 'Account', error, button: 'Save Changes', action: '/admin/account',
    sub: notice ? `<span class="form-ok">${esc(notice)}</span>` : 'Change your byline name or password.',
    fields: field('display_name', 'Name shown on articles', 'text', displayName, 'required') +
      field('current', 'Current password (required to change password)', 'password', '', 'autocomplete="current-password"') +
      field('password', 'New password', 'password', '', 'autocomplete="new-password" minlength="10"') +
      field('password2', 'Confirm new password', 'password', '', 'autocomplete="new-password" minlength="10"'),
  });
}

/* ---------- Email subscription pages ---------- */
function noticePage({ heading, message }) {
  return layout({
    title: heading, bodyClass: 'auth-page',
    body: `<section class="auth-card">
      <img src="/img/logo.png" alt="" class="auth-logo">
      <h1 class="display small">${esc(heading)}</h1>
      <p class="muted">${esc(message)}</p>
      <a class="btn btn-dark btn-block" href="/">Back to BallEdge</a>
    </section>`,
  });
}

function unsubscribePage({ email, token, done }) {
  return layout({
    title: 'Unsubscribe', bodyClass: 'auth-page',
    head: '<meta name="robots" content="noindex">',
    body: `<section class="auth-card">
      <img src="/img/logo.png" alt="" class="auth-logo">
      <h1 class="display small">${done ? 'You\'re unsubscribed' : 'Unsubscribe?'}</h1>
      ${done
        ? `<p class="muted">${esc(email)} won't get any more emails from BallEdge.</p>
           <a class="btn btn-dark btn-block" href="/">Back to BallEdge</a>`
        : `<p class="muted">Stop new-article emails to ${esc(email)}?</p>
           <form method="post" action="/unsubscribe" class="stack-form">
             <input type="hidden" name="token" value="${esc(token)}">
             <button class="btn btn-dark btn-block" type="submit">Unsubscribe</button>
           </form>`}
    </section>`,
  });
}

function subscribersPage({ user, subscribers, enabled }) {
  const count = (s) => subscribers.filter((x) => x.status === s).length;
  const label = { active: 'Subscribed', pending: 'Not confirmed', unsubscribed: 'Unsubscribed' };
  const rows = subscribers.map((s) => `<tr>
      <td>${esc(s.email)}</td>
      <td><span class="badge ${s.status === 'active' ? 'published' : 'draft'}">${label[s.status] || esc(s.status)}</span></td>
      <td class="small">${timeTag(s.confirmed_at || s.created_at)}</td>
      <td class="dash-actions"><form method="post" action="/admin/subscribers/${s.id}/delete" data-msg="${esc(`Remove ${s.email} from the list?`)}" onsubmit="return confirm(this.dataset.msg)">
        <button class="btn btn-ghost btn-sm danger" type="submit">Remove</button></form></td>
    </tr>`).join('');
  const body = `<header class="page-head"><p class="eyebrow">Author</p><h1 class="display">Subscribers</h1>
      <p class="muted">${count('active')} subscribed · ${count('pending')} waiting to confirm · ${count('unsubscribed')} unsubscribed</p></header>
    ${enabled ? '' : `<p class="form-error">Email sending is off, so the signup form is hidden and nothing is sent. Set <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> on the server to turn it on.</p>`}
    ${subscribers.length ? `<div class="table-wrap"><table class="dash"><thead><tr><th>Email</th><th>Status</th><th>Since</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="muted center pad">No subscribers yet. The signup form is in the site footer and at the end of every article.</p>'}`;
  return layout({ user, title: 'Subscribers', body, bodyClass: 'admin' });
}

function backupPage({ user, error }) {
  return layout({
    user, title: 'Backup & Restore', bodyClass: 'auth-page',
    body: `<section class="auth-card">
      <h1 class="display small">Backup &amp; Restore</h1>
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
      <h2>Download a backup</h2>
      <p class="muted">One file with every article, draft, setting, your author account and all images.</p>
      <a class="btn btn-dark btn-block" href="/admin/backup/download">Download Backup</a>
      <h2 style="margin-top:2rem">Restore a backup</h2>
      <p class="muted"><strong>This replaces every article, draft, setting and the author account on this site</strong>
        with the ones in the backup, and adds its images. You'll be signed out; sign back in with the backup's username and password.
        A safety copy of the current site is saved on the server first.</p>
      <form method="post" action="/admin/backup/restore" enctype="multipart/form-data" class="stack-form" id="restoreForm">
        <label class="field"><span>Backup file (.tar.gz)</span><input name="backup" type="file" accept=".gz,.tgz,.tar" required></label>
        ${field('confirm', 'Type RESTORE to confirm', 'text', '', 'required autocomplete="off" pattern="[Rr][Ee][Ss][Tt][Oo][Rr][Ee]"')}
        <button class="btn btn-gold btn-block" type="submit">Restore Backup</button>
      </form>
      <script>document.getElementById('restoreForm').addEventListener('submit', function (e) {
        var b = this.querySelector('button'); b.disabled = true; b.textContent = 'Restoring… this can take a minute';
      });</script>
    </section>`,
  });
}

/* ---------- Admin dashboard ---------- */
function dashboard({ user, articles }) {
  const rows = articles.map((a) => `<tr>
      <td class="dash-thumb">${a.hero_image ? `<img src="${esc(a.hero_image)}" alt="">` : ''}</td>
      <td><a class="dash-title" href="/article/${esc(a.slug)}">${esc(a.title)}</a><div class="muted small">${esc(a.category)}</div></td>
      <td><span class="badge ${a.status}">${a.status === 'published' ? 'Published' : 'Draft'}</span></td>
      <td class="small">${a.published_at ? timeTag(a.published_at) : `Edited ${timeTag(a.updated_at)}`}${a.emailed_at ? `<div class="muted">Emailed to ${a.emailed_count}</div>` : ''}</td>
      <td class="dash-actions">
        <a class="btn btn-ghost btn-sm" href="/admin/edit/${a.id}">Edit</a>
        <button class="btn btn-ghost btn-sm danger" data-delete="${a.id}" data-title="${esc(a.title)}">Delete</button>
      </td>
    </tr>`).join('');
  const body = `<header class="page-head row-head"><div><p class="eyebrow">Author</p><h1 class="display">My Articles</h1></div>
      <a class="btn btn-gold" href="/admin/new">+ New Article</a></header>
    ${articles.length ? `<div class="table-wrap"><table class="dash"><thead><tr><th></th><th>Title</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="muted center pad">No articles yet. Your first one is a click away.</p>'}`;
  return layout({ user, title: 'My Articles', body, bodyClass: 'admin', scripts: '<script src="/js/dashboard.js" defer></script>' });
}

/* ---------- Editor ---------- */
function editorPage({ user, article, mode = 'article', notify = 0 }) {
  const a = article || { id: '', title: '', dek: '', category: 'NFL', hero_image: '', hero_caption: '', body_html: '', status: 'draft' };
  const isAbout = mode === 'about';
  const data = JSON.stringify({ mode, id: a.id || null, status: a.status, bodyHtml: a.body_html, slug: a.slug || '', notify }).replace(/</g, '\\u003c');

  const body = `
  <form class="editor-shell" id="editorForm" autocomplete="off">
    <div class="editor-bar">
      <div class="editor-bar-left">
        <a href="${isAbout ? '/about' : '/admin'}" class="back-link">← ${isAbout ? 'About page' : 'My Articles'}</a>
        <span class="save-state" id="saveState"></span>
      </div>
      <div class="editor-bar-right">
        ${isAbout
          ? '<button type="button" class="btn btn-gold" data-save="publish">Save About Page</button>'
          : `<button type="button" class="btn btn-ghost" data-save="draft">Save Draft</button>
             <button type="button" class="btn btn-ghost" data-preview ${a.id ? '' : 'disabled'}>Preview</button>
             <button type="button" class="btn btn-gold" data-save="publish">${a.status === 'published' ? 'Update' : 'Publish'}</button>`}
      </div>
    </div>

    <div class="editor-main">
      ${isAbout ? `
        <label class="field"><span>Page heading</span><input name="title" class="title-input" value="${esc(a.title)}" placeholder="About Me"></label>
        <div class="hero-upload ${a.hero_image ? 'has-image' : ''}" id="heroDrop">
          <input type="file" id="heroFile" accept="image/*" hidden>
          <div class="hero-empty"><strong>Add a portrait photo</strong><span>Optional · drag & drop or click to upload</span></div>
          <img id="heroPreview" src="${esc(a.hero_image)}" alt="">
          <div class="hero-actions"><button type="button" class="btn btn-sm btn-light" data-hero-change>Change</button><button type="button" class="btn btn-sm btn-light" data-hero-remove>Remove</button></div>
        </div>
        <input type="hidden" name="hero_image" value="${esc(a.hero_image)}">`
      : `
        <div class="meta-row">
          <label class="field cat-field"><span>Section</span>
            <select name="category">${CATEGORIES.map((c) => `<option ${c === a.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </label>
        </div>
        <textarea name="title" class="title-input" rows="1" placeholder="Headline" maxlength="200">${esc(a.title)}</textarea>
        <textarea name="dek" class="dek-input" rows="1" placeholder="Subheadline — one sentence that sells the story (optional)" maxlength="300">${esc(a.dek)}</textarea>

        <div class="hero-upload ${a.hero_image ? 'has-image' : ''}" id="heroDrop">
          <input type="file" id="heroFile" accept="image/*" hidden>
          <div class="hero-empty"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M19 5v14H5V5h14m0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-4.86 8.86-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/></svg>
            <strong>Upload hero image</strong><span>The main photo on the home page and at the top of the article · drag & drop or click</span></div>
          <img id="heroPreview" src="${esc(a.hero_image)}" alt="">
          <div class="hero-actions"><button type="button" class="btn btn-sm btn-light" data-hero-change>Change</button><button type="button" class="btn btn-sm btn-light" data-hero-remove>Remove</button></div>
          <div class="hero-progress" hidden><span></span></div>
        </div>
        <input type="hidden" name="hero_image" value="${esc(a.hero_image)}">
        <input type="hidden" name="share_image" value="${esc(a.share_image || '')}">
        <input name="hero_caption" class="caption-input" value="${esc(a.hero_caption)}" placeholder="Hero caption / photo credit (optional)" maxlength="300">`}

      <div class="toolbar" id="toolbar" role="toolbar" aria-label="Formatting">
        <select data-block aria-label="Text style">
          <option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option>
        </select>
        <span class="tb-sep"></span>
        <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <button type="button" data-cmd="link" title="Link">Link</button>
        <span class="tb-sep"></span>
        <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
        <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
        <button type="button" data-cmd="quote" title="Pull quote">❝ Quote</button>
        <span class="tb-sep"></span>
        <button type="button" class="tb-insert" data-insert="image" title="Insert an image at the cursor">＋ Image</button>
        <button type="button" class="tb-insert" data-insert="code" title="Insert a code box at the cursor">＋ Code Box</button>
        <input type="file" id="inlineFile" accept="image/*" hidden>
      </div>
      <div class="editor-body article-body" id="editor" contenteditable="true" spellcheck="true" data-placeholder="Start writing your article…"></div>
      <p class="editor-hint">Tip: place your cursor where you want an image or code box — even mid-paragraph — then use <b>＋ Image</b> or <b>＋ Code Box</b>. Paste SQL or R straight into a code box.</p>
    </div>
  </form>
  <script id="editorData" type="application/json">${data}</script>`;

  return layout({
    user, title: isAbout ? 'Edit About Page' : (a.id ? 'Edit Article' : 'New Article'), body, bodyClass: 'editor-page',
    scripts: '<script src="/js/editor.js" defer></script>',
  });
}

function notFound({ user }) {
  return layout({
    user, title: 'Not found',
    body: `<section class="empty-state"><h1 class="display">That page is out of bounds.</h1><p>The article may have moved or been removed.</p><a class="btn btn-dark" href="/">Back to the front page</a></section>`,
  });
}

module.exports = {
  layout, home, sectionPage, articlePage, aboutPage, loginPage, setupPage, accountPage, backupPage,
  noticePage, unsubscribePage, subscribersPage, dashboard, editorPage, notFound,
};
