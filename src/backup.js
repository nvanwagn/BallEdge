// Backup & restore of the whole site: the SQLite database plus every uploaded image,
// packed as a .tar.gz (also opens with `tar -xzf` on Windows, macOS and Linux).
//
// Archive layout:   balledge.db          consistent snapshot (VACUUM INTO)
//                   uploads/<file>       every image in UPLOAD_DIR
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const { db, DATA_DIR, UPLOAD_DIR } = require('./db');

const TMP_DIR = path.join(DATA_DIR, 'tmp');
const SAFETY_DIR = path.join(DATA_DIR, 'backups');
const KEEP_SAFETY = 3;
const UPLOAD_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

const tmpPath = (suffix) => path.join(TMP_DIR, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${suffix}`);
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* ------------------------------ tar (ustar) ------------------------------ */
function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512);
  const put = (str, off, len) => h.write(str, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100);
  put(oct(0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8);           // checksum placeholder (spaces)
  put('0', 156, 1);                  // regular file
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

async function writeTarGz(entries, outFile) {
  const gzip = zlib.createGzip();
  const done = pipeline(gzip, fs.createWriteStream(outFile));
  const write = (buf) => (gzip.write(buf) ? Promise.resolve() : new Promise((r) => gzip.once('drain', r)));
  for (const { name, file } of entries) {
    const stat = await fsp.stat(file);
    await write(tarHeader(name, stat.size, stat.mtimeMs));
    for await (const chunk of fs.createReadStream(file)) await write(chunk);
    const pad = (512 - (stat.size % 512)) % 512;
    if (pad) await write(Buffer.alloc(pad));
  }
  await write(Buffer.alloc(1024));   // end-of-archive marker
  gzip.end();
  await done;
}

// Reads a tar (optionally gzipped) and copies the entries we accept into stagingDir.
// Returns { hasDb, images }. Anything else in the archive is ignored.
async function extractArchive(archive, stagingDir) {
  const head = Buffer.alloc(2);
  const fd0 = fs.openSync(archive, 'r'); fs.readSync(fd0, head, 0, 2, 0); fs.closeSync(fd0);
  let tarFile = archive;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    tarFile = tmpPath('.tar');
    await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(tarFile));
  }

  await fsp.mkdir(path.join(stagingDir, 'uploads'), { recursive: true });
  const fd = fs.openSync(tarFile, 'r');
  const total = fs.fstatSync(fd).size;
  const header = Buffer.alloc(512);
  const chunk = Buffer.alloc(1 << 20);
  let pos = 0, hasDb = false, images = 0;
  try {
    while (pos + 512 <= total) {
      fs.readSync(fd, header, 0, 512, pos);
      if (header.every((b) => b === 0)) break;
      const str = (off, len) => header.toString('utf8', off, off + len).replace(/\0.*$/s, '');
      const size = parseInt(str(124, 12).trim() || '0', 8);
      if (!Number.isFinite(size) || size < 0) throw new Error('This file is not a valid backup archive.');
      const type = str(156, 1) || '0';
      const prefix = str(257, 6).startsWith('ustar') ? str(345, 155) : '';
      const name = (prefix ? `${prefix}/` : '') + str(0, 100);
      const rel = name.replace(/^(\.\/)+/, '');
      pos += 512;

      let target = null;
      if (type === '0') {
        if (rel === 'balledge.db') { target = path.join(stagingDir, 'balledge.db'); hasDb = true; }
        else if (rel.startsWith('uploads/') && UPLOAD_NAME.test(rel.slice(8))) { target = path.join(stagingDir, 'uploads', rel.slice(8)); images++; }
      }
      if (target) {
        const out = fs.openSync(target, 'w');
        try {
          for (let done = 0; done < size;) {
            const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - done), pos + done);
            if (!n) throw new Error('The backup file is cut off. Try downloading it again.');
            fs.writeSync(out, chunk, 0, n);
            done += n;
          }
        } finally { fs.closeSync(out); }
      }
      pos += Math.ceil(size / 512) * 512;
    }
  } finally {
    fs.closeSync(fd);
    if (tarFile !== archive) await fsp.rm(tarFile, { force: true });
  }
  return { hasDb, images };
}

/* ------------------------------ Backup ------------------------------ */
// Writes a complete backup to outFile.
async function createBackup(outFile) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const snapshot = tmpPath('.db');
  try {
    db.exec(`VACUUM INTO ${sqlString(snapshot)}`);   // consistent copy, even while the site is running
    const images = (await fsp.readdir(UPLOAD_DIR, { withFileTypes: true }))
      .filter((d) => d.isFile() && UPLOAD_NAME.test(d.name))
      .map((d) => ({ name: `uploads/${d.name}`, file: path.join(UPLOAD_DIR, d.name) }));
    await writeTarGz([{ name: 'balledge.db', file: snapshot }, ...images], outFile);
  } finally {
    await fsp.rm(snapshot, { force: true });
  }
}

// Makes a temporary backup file for download; the caller deletes it afterwards.
async function backupForDownload() {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const file = tmpPath('.tar.gz');
  await createBackup(file);
  return file;
}

/* ------------------------------ Restore ------------------------------ */
const TABLES = ['users', 'articles', 'settings'];   // insert order (articles reference users)

function checkDatabase(file) {
  const magic = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r'); fs.readSync(fd, magic, 0, 16, 0); fs.closeSync(fd);
  if (magic.toString('latin1') !== 'SQLite format 3\0') throw new Error('The backup\'s database file is damaged.');
  const check = new DatabaseSync(file);
  try {
    const tables = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    if (!tables.includes('articles') || !tables.includes('users')) throw new Error('That backup is not from BallEdge.');
    if (!check.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new Error('That backup has no author account in it.');
    return {
      tables,
      articles: check.prepare('SELECT COUNT(*) AS n FROM articles').get().n,
    };
  } finally { check.close(); }
}

// Keeps a safety copy of the current site before it is replaced (newest KEEP_SAFETY kept).
async function saveSafetyCopy() {
  await fsp.mkdir(SAFETY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await createBackup(path.join(SAFETY_DIR, `before-restore-${stamp}.tar.gz`));
  const old = (await fsp.readdir(SAFETY_DIR)).filter((f) => f.startsWith('before-restore-')).sort().reverse().slice(KEEP_SAFETY);
  await Promise.all(old.map((f) => fsp.rm(path.join(SAFETY_DIR, f), { force: true })));
}

// Replaces every article, setting and the author account with the backup's, and adds its images.
// All sessions end, so everyone signs in again with the backup's username and password.
async function restoreBackup(archive) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const staging = tmpPath('-restore');
  try {
    const { hasDb, images } = await extractArchive(archive, staging);
    if (!hasDb) throw new Error('That file has no balledge.db inside, so it is not a BallEdge backup.');
    const bakDb = path.join(staging, 'balledge.db');
    const info = checkDatabase(bakDb);

    await saveSafetyCopy();

    db.exec(`ATTACH DATABASE ${sqlString(bakDb)} AS bak`);
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM sessions; DELETE FROM articles; DELETE FROM users; DELETE FROM settings;');
        for (const t of TABLES) {
          if (!info.tables.includes(t)) continue;
          const live = db.prepare(`PRAGMA main.table_info(${t})`).all().map((c) => c.name);
          const theirs = new Set(db.prepare(`PRAGMA bak.table_info(${t})`).all().map((c) => c.name));
          const cols = live.filter((c) => theirs.has(c)).map((c) => `"${c}"`).join(', ');
          db.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM bak.${t}`);
        }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    } finally { db.exec('DETACH DATABASE bak'); }

    const stagedUploads = path.join(staging, 'uploads');
    for (const name of await fsp.readdir(stagedUploads)) {
      await fsp.copyFile(path.join(stagedUploads, name), path.join(UPLOAD_DIR, name));
    }
    return { articles: info.articles, images };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

// Clears leftovers from interrupted backups/restores (called at startup).
function cleanTmp() {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

module.exports = { TMP_DIR, backupForDownload, restoreBackup, cleanTmp };
