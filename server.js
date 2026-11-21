// BallEdge — sports analytics publishing site.
// Start with:  npm start   (then open http://localhost:3000)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { db, UPLOAD_DIR, getSetting, setSetting } = require('./src/db');
const auth = require('./src/auth');
const backup = require('./src/backup');
const C = require('./src/content');
const V = require('./src/views');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
// Health check for the host (Railway pings this before switching traffic to a new deploy).
app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => { if (!req.body) req.body = {}; next(); });
app.use(auth.sessionMiddleware);
app.use(auth.sameOrigin);

// Public address of the site, used for share links and link-preview images.
// Set SITE_URL (e.g. https://balledge.com) in production so previews always point at the real domain.
const siteUrl = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

const send = (res, html, status = 200) => res.status(status).type('html').send(html);

/* ------------------------------ Queries ------------------------------ */
const Q = {
  published: db.prepare(`SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT ?`),
  byCategory: db.prepare(`SELECT * FROM articles WHERE status = 'published' AND category = ? ORDER BY published_at DESC`),
  bySlug: db.prepare(`SELECT a.*, u.display_name AS author FROM articles a LEFT JOIN users u ON u.id = a.author_id WHERE a.slug = ?`),
  byId: db.prepare('SELECT * FROM articles WHERE id = ?'),
  all: db.prepare('SELECT * FROM articles ORDER BY COALESCE(published_at, updated_at) DESC'),
  related: db.prepare(`SELECT slug, title, published_at FROM articles WHERE status = 'published' AND id != ? ORDER BY published_at DESC LIMIT 6`),
  slugTaken: db.prepare('SELECT id FROM articles WHERE slug = ? AND id != ?'),
};

function uniqueSlug(title, id = 0) {
  const base = C.slugify(title);
  let slug = base, n = 2;
  while (Q.slugTaken.get(slug, id)) slug = `${base}-${n++}`;
  return slug;
}

/* ------------------------------ Public pages ------------------------------ */
app.get('/', (req, res) => send(res, V.home({ articles: Q.published.all(40), user: req.user })));

app.get('/section/:name', (req, res) => {
  const name = C.CATEGORIES.find((c) => c.toLowerCase() === req.params.name.toLowerCase());
  if (!name) return send(res, V.notFound({ user: req.user }), 404);
  send(res, V.sectionPage({ name, articles: Q.byCategory.all(name), user: req.user }));
});

app.get('/article/:slug', (req, res) => {
  const article = Q.bySlug.get(req.params.slug);
  if (!article || (article.status !== 'published' && !req.user)) return send(res, V.notFound({ user: req.user }), 404);
  const base = siteUrl(req);
  send(res, V.articlePage({
    article, author: article.author, base, url: `${base}/article/${article.slug}`, bodyHtml: C.renderBody(article.body_html),
    related: Q.related.all(article.id), user: req.user,
  }));
});

const DEFAULT_ABOUT = `<p>Welcome to BallEdge — a home for data-driven stories about the NFL and NBA.</p>
<p>Here I dig into the numbers behind the games: efficiency, trends, and the stats that tell a story the box score misses. Every article shows its work, with the SQL and R used to get there.</p>`;
function getAbout() {
  return {
    title: getSetting('about_title', 'About Me'),
    photo: getSetting('about_photo', ''),
    body: getSetting('about_body', DEFAULT_ABOUT),
  };
}
app.get('/about', (req, res) => {
  const a = getAbout();
  send(res, V.aboutPage({ about: { ...a, bodyHtml: C.renderBody(a.body) }, user: req.user }));
});

/* ------------------------------ Auth ------------------------------ */
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/admin');

app.get('/login', (req, res) => {
  if (auth.userCount() === 0) return res.redirect('/setup');
  if (req.user) return res.redirect(safeNext(req.query.next));
  const notice = req.query.restored ? 'Backup restored. Sign in with the username and password from the backup.' : '';
  send(res, V.loginPage({ next: safeNext(req.query.next), notice }));
});

app.post('/login', (req, res) => {
  const next = safeNext(req.query.next);
  const { username = '', password = '' } = req.body;
  if (!auth.loginAllowed(req.ip)) return send(res, V.loginPage({ error: 'Too many attempts. Try again in 15 minutes.', next, username }), 429);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !auth.verifyPassword(String(password), user.password_hash)) {
    auth.recordFailure(req.ip);
    return send(res, V.loginPage({ error: 'That username and password don\'t match.', next, username }), 401);
  }
  auth.clearFailures(req.ip);
  auth.startSession(req, res, user.id);
  res.redirect(next);
});

app.post('/logout', (req, res) => { auth.endSession(req, res); res.redirect('/'); });

app.get('/setup', (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/login');
  send(res, V.setupPage({}));
});

app.post('/setup', (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/login');
  const { display_name = '', username = '', password = '', password2 = '' } = req.body;
  let error = '';
  if (!display_name.trim() || !username.trim()) error = 'Please fill in every field.';
  else if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim())) error = 'Username: 3–32 letters, numbers, dots, dashes or underscores.';
  else if (password.length < 10) error = 'Password must be at least 10 characters.';
  else if (password !== password2) error = 'The passwords don\'t match.';
  if (error) return send(res, V.setupPage({ error, values: req.body }), 400);
  const id = auth.createUser(username, display_name, password);
  auth.startSession(req, res, id);
  res.redirect('/admin');
});

/* ------------------------------ Author area ------------------------------ */
app.get('/admin', auth.requireAuth, (req, res) => send(res, V.dashboard({ user: req.user, articles: Q.all.all() })));
app.get('/admin/new', auth.requireAuth, (req, res) => send(res, V.editorPage({ user: req.user })));
app.get('/admin/edit/:id', auth.requireAuth, (req, res) => {
  const article = Q.byId.get(Number(req.params.id));
  if (!article) return send(res, V.notFound({ user: req.user }), 404);
  send(res, V.editorPage({ user: req.user, article }));
});
app.get('/admin/about', auth.requireAuth, (req, res) => {
  const a = getAbout();
  send(res, V.editorPage({ user: req.user, mode: 'about', article: { id: 'about', title: a.title, hero_image: a.photo, body_html: a.body, status: 'published' } }));
});

app.get('/admin/account', auth.requireAuth, (req, res) =>
  send(res, V.accountPage({ user: req.user, displayName: req.user.displayName })));
app.post('/admin/account', auth.requireAuth, (req, res) => {
  const { display_name = '', current = '', password = '', password2 = '' } = req.body;
  const page = (error, notice) => send(res, V.accountPage({ user: req.user, error, notice, displayName: display_name || req.user.displayName }), error ? 400 : 200);
  if (!display_name.trim()) return page('Name can\'t be empty.');
  if (password || password2) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(current, row.password_hash)) return page('Current password is incorrect.');
    if (password.length < 10) return page('New password must be at least 10 characters.');
    if (password !== password2) return page('New passwords don\'t match.');
    auth.setPassword(req.user.id, password);
    auth.startSession(req, res, req.user.id);
  }
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), req.user.id);
  req.user.displayName = display_name.trim();
  page('', password ? 'Saved. Your password was changed.' : 'Saved.');
});

/* ------------------------------ Backup & restore ------------------------------ */
backup.cleanTmp();
const restoreUpload = multer({ dest: backup.TMP_DIR, limits: { fileSize: 2 * 1024 ** 3, files: 1 } });

app.get('/admin/backup', auth.requireAuth, (req, res) => send(res, V.backupPage({ user: req.user })));

app.get('/admin/backup/download', auth.requireAuth, async (req, res, next) => {
  let file;
  try {
    file = await backup.backupForDownload();
  } catch (err) { return next(err); }
  const day = new Date().toISOString().slice(0, 10);
  res.download(file, `balledge-backup-${day}.tar.gz`, () => fs.rm(file, { force: true }, () => {}));
});

app.post('/admin/backup/restore', auth.requireAuth, (req, res) => {
  const page = (error) => send(res, V.backupPage({ user: req.user, error }), 400);
  restoreUpload.single('backup')(req, res, async (err) => {
    const file = req.file && req.file.path;
    const cleanup = () => file && fs.rm(file, { force: true }, () => {});
    if (err) { cleanup(); return page(err.code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 2 GB.' : 'Upload failed. Please try again.'); }
    if (!file) return page('Choose a backup file to restore.');
    if (String(req.body.confirm || '').trim().toUpperCase() !== 'RESTORE') { cleanup(); return page('Type RESTORE in the box to confirm.'); }
    try {
      const result = await backup.restoreBackup(file);
      console.log(`Restored backup: ${result.articles} articles, ${result.images} images`);
      res.redirect('/login?restored=1');
    } catch (e) {
      console.error(e);
      page(e.message || 'Restore failed. Nothing was changed.');
    } finally { cleanup(); }
  });
});

/* ------------------------------ Image uploads ------------------------------ */
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const d = new Date();
      cb(null, `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${crypto.randomBytes(8).toString('hex')}${IMAGE_TYPES[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
});

// Confirm the file really is an image by its first bytes (not just its name).
function looksLikeImage(file) {
  const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
  return (b[0] === 0xff && b[1] === 0xd8) || b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    b.slice(0, 3).toString() === 'GIF' || (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP');
}

app.post('/api/upload', auth.requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is larger than 15 MB.' : 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a JPG, PNG, GIF or WebP image.' });
    if (!looksLikeImage(req.file.path)) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'That file isn\'t a valid image.' }); }
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

/* ------------------------------ Article API ------------------------------ */
const cleanImagePath = (p) => (typeof p === 'string' && /^\/uploads\/[\w.-]+$/.test(p) ? p : '');

function readArticleInput(body) {
  return {
    title: String(body.title || '').trim().slice(0, 200),
    dek: String(body.dek || '').trim().slice(0, 300),
    category: C.CATEGORIES.includes(body.category) ? body.category : 'General',
    hero_image: cleanImagePath(body.hero_image),
    share_image: cleanImagePath(body.hero_image) ? cleanImagePath(body.share_image) : '',
    hero_caption: String(body.hero_caption || '').trim().slice(0, 300),
    body_html: C.sanitizeBody(String(body.body_html || '')),
    status: body.status === 'published' ? 'published' : 'draft',
  };
}

function validate(input) {
  if (input.status === 'published') {
    if (!input.title) return 'Add a headline before publishing.';
    if (!C.plainText(input.body_html) && !/<img|<pre/.test(input.body_html)) return 'The article body is empty.';
  }
  if (!input.title && !C.plainText(input.body_html)) return 'Nothing to save yet — add a headline or some text.';
  return '';
}

app.post('/api/articles', auth.requireAuth, (req, res) => {
  const input = readArticleInput(req.body);
  const error = validate(input);
  if (error) return res.status(400).json({ error });
  const now = Date.now();
  const title = input.title || 'Untitled draft';
  const info = db.prepare(`INSERT INTO articles (slug, title, dek, category, hero_image, share_image, hero_caption, body_html, status, author_id, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uniqueSlug(title), title, input.dek, input.category, input.hero_image, input.share_image, input.hero_caption, input.body_html,
    input.status, req.user.id, now, now, input.status === 'published' ? now : null);
  const a = Q.byId.get(Number(info.lastInsertRowid));
  res.json({ id: a.id, slug: a.slug, status: a.status });
});

app.put('/api/articles/:id', auth.requireAuth, (req, res) => {
  const existing = Q.byId.get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Article not found.' });
  const input = readArticleInput(req.body);
  const error = validate(input);
  if (error) return res.status(400).json({ error });
  const now = Date.now();
  const title = input.title || 'Untitled draft';
  // Keep a published article's URL stable; drafts follow their headline.
  const slug = existing.published_at ? existing.slug : uniqueSlug(title, existing.id);
  const publishedAt = input.status === 'published' ? (existing.published_at || now) : existing.published_at;
  db.prepare(`UPDATE articles SET slug=?, title=?, dek=?, category=?, hero_image=?, share_image=?, hero_caption=?, body_html=?, status=?, updated_at=?, published_at=? WHERE id=?`)
    .run(slug, title, input.dek, input.category, input.hero_image, input.share_image, input.hero_caption, input.body_html, input.status, now, publishedAt, existing.id);
  res.json({ id: existing.id, slug, status: input.status });
});

app.delete('/api/articles/:id', auth.requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM articles WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: info.changes > 0 });
});

app.put('/api/about', auth.requireAuth, (req, res) => {
  setSetting('about_title', String(req.body.title || 'About Me').trim().slice(0, 120) || 'About Me');
  setSetting('about_photo', cleanImagePath(req.body.hero_image));
  setSetting('about_body', C.sanitizeBody(String(req.body.body_html || '')));
  res.json({ ok: true, slug: '' });
});

/* ------------------------------ Fallbacks ------------------------------ */
app.use((req, res) => send(res, V.notFound({ user: req.user }), 404));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong on the server.' });
  res.status(500).type('text').send('Something went wrong.');
});

// Clean out expired sessions once a day.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 864e5).unref();

const server = app.listen(PORT, () => console.log(`BallEdge running at http://localhost:${PORT}`));

// Hosts like Railway send SIGTERM on every redeploy. Finish in-flight requests and
// close the database so its write-ahead log is folded back into balledge.db.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const finish = () => { try { db.close(); } catch {} process.exit(0); };
  server.close(finish);
  server.closeIdleConnections?.();
  setTimeout(finish, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
