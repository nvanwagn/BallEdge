# BallEdge

A self-hosted publishing site for NFL and NBA statistics articles. It has a news-style front page, ESPN-style article pages, and a private author dashboard with a full rich-text editor.

Built with **Node.js** and **Express**, using Node's built-in **SQLite**. There's no front-end framework and no build step.

---

## Features

**For readers**
- **Front page.** The newest article is the large lead story, the next two sit beside it, and NFL / NBA sections follow. "Posted 3 hours ago" labels update live.
- **Article pages.** Section tag, serif headline, subheadline, byline with read time, hero image and a "Top Headlines" sidebar.
- **Sharing.** A native share sheet on mobile, and X, Facebook, LinkedIn, email and copy-link buttons on desktop.
- **Link previews.** Large preview cards with the hero image when an article is shared on X, iMessage and similar apps.

**For the author** (signed in only)
- **Rich-text editor.** Headings, bold/italic/underline, links, lists and pull quotes.
- **Images.** Drag-and-drop hero image, plus images placed anywhere in the text (full width or inset with text wrap, with a caption). You can paste screenshots directly.
- **Code blocks.** SQL, R and Python with syntax highlighting and a Copy button.
- **Drafts.** Save, preview, publish and unpublish. `Ctrl/Cmd + S` saves.
- **About page.** An editable About Me page with an optional portrait.
- **Article manager.** A list of all articles and drafts.

---

## Getting started

**Requirements:** [Node.js](https://nodejs.org) 22.13 or newer

```bash
npm install
npm start
```

Then open **http://localhost:3000/login**. The first visit asks you to create the author account. After that, the setup page is disabled and only that account can sign in.

For development with auto-reload:

```bash
npm run dev
```

> **Note:** Articles and uploaded images are stored in `data/` (`balledge.db` and `uploads/`). This folder is not tracked in git, so a fresh clone starts with an empty site. Back up `data/` to back up everything.

---

## Configuration

Set these as environment variables:

| Variable         | Default            | Description                                                                 |
|------------------|--------------------|-----------------------------------------------------------------------------|
| `PORT`           | `3000`             | Port the server listens on                                                  |
| `DATA_DIR`       | `./data`           | Where the database and uploads are stored                                   |
| `SITE_TIMEZONE`  | `America/New_York` | Time zone for article dates                                                 |
| `SITE_URL`       | *(auto-detected)*  | Public URL, e.g. `https://balledge.com`. Required for link previews to work |
| `TWITTER_HANDLE` | *(none)*           | X/Twitter username credited on preview cards                                |

---

## Deployment

The app needs a host with a **persistent disk** so the database and images survive restarts.

| Host                     | Setup                                                                                                         |
|--------------------------|---------------------------------------------------------------------------------------------------------------|
| **Render**               | Web Service. Build: `npm install`. Start: `npm start`. Add a Disk at `/var/data` and set `DATA_DIR=/var/data` |
| **Railway**              | Deploys from the Dockerfile (`railway.json`). Attach a Volume to the service; the app finds it automatically  |
| **Fly.io**               | Add a volume and point `DATA_DIR` at it                                                                       |
| **VPS**                  | Run with `pm2` or systemd behind Nginx/Caddy with HTTPS                                                       |
| **Docker**               | See below                                                                                                     |

```bash
docker build -t balledge .
docker run -p 3000:3000 -v balledge-data:/app/data balledge
```

Always serve over **HTTPS** in production. The session cookie is marked `Secure` automatically when HTTPS is detected.

### Link previews

- A 1200×630 copy of each hero image is generated automatically for preview cards.
- Previews only work once the site is at a public URL with `SITE_URL` set. X can't reach `localhost`.
- Articles without a hero image fall back to `public/img/share-default.jpg`.
- X caches previews for about a week, so a changed hero image may take time to update there.

---

## Backup & restore

Signed in, open **Menu → Backup & Restore**.

- **Download Backup** saves one `.tar.gz` with the database (articles, drafts, settings, author account) and every uploaded image. It's safe to run while the site is live.
- **Restore Backup** replaces the site's articles, settings and author account with the backup's and adds its images. Everyone is signed out; sign back in with the backup's username and password. A safety copy of the site as it was is saved first in `data/backups/` (the newest 3 are kept).

To move a local site to a host: download a backup on `localhost`, sign in on the new site (create a temporary account at `/setup` if it's empty), and restore it there.

---

## Account management

Reset a password from the machine running the site:

```bash
npm run reset-password -- <username> "<new password>"
```

The password and byline name can also be changed under **Menu → Account** while signed in.

---

## Security

- Passwords hashed with **scrypt**
- Server-side sessions with **HttpOnly** cookies
- Rate-limited login attempts
- All article HTML **sanitized** on the server
- Uploads restricted to real JPG / PNG / GIF / WebP images (15 MB max)

---

## Project structure

```
server.js             Routes, uploads, article API
src/
  db.js               SQLite database (built into Node)
  auth.js             Login, sessions, password hashing
  content.js          Sanitizing, code highlighting, slugs, "time ago"
  views.js            HTML templates for every page
public/
  css/site.css        Styles (theme colors at the top: --carbon, --gold)
  js/editor.js        Article editor
  js/site.js          Menu, live timestamps, copy buttons
  img/, fonts/        Logo, nameplate, self-hosted fonts
scripts/
  reset-password.js   Password reset tool
```

### Customizing

- **Colors and fonts:** CSS variables at the top of `public/css/site.css`
- **Logo:** `public/img/`
- **Sections (NFL, NBA, General):** `CATEGORIES` in `src/content.js`
- **Page layouts:** `src/views.js`
