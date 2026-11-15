// Site-wide behaviour: left dropdown menu, live "time ago" labels, copy buttons.
(function () {
  // ----- Dropdown menu -----
  const btn = document.getElementById('menuBtn');
  const menu = document.getElementById('siteMenu');
  if (btn && menu) {
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
  }

  // ----- "x hours ago" labels stay current without reloading -----
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'Just now';
    for (const [name, secs] of units) {
      const n = Math.floor(s / secs);
      if (n >= 1) return n + ' ' + name + (n > 1 ? 's' : '') + ' ago';
    }
    return 'Just now';
  }
  function refreshTimes() {
    document.querySelectorAll('time[data-ts]').forEach((t) => { t.textContent = ago(Number(t.dataset.ts)); });
  }
  refreshTimes();
  setInterval(refreshTimes, 60000);

  // ----- Toast helper (shared with editor) -----
  window.beToast = function (msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }

  // ----- Copy buttons on code boxes -----
  document.addEventListener('click', async (e) => {
    const codeBtn = e.target.closest('.code-copy');
    if (codeBtn) {
      const code = codeBtn.closest('.code-box').querySelector('code').innerText;
      if (await copy(code)) { codeBtn.textContent = 'Copied'; setTimeout(() => (codeBtn.textContent = 'Copy'), 1600); }
    }
    const linkBtn = e.target.closest('[data-copy-link]');
    if (linkBtn) {
      const wrap = linkBtn.closest('[data-share]');
      if (await copy(wrap ? wrap.dataset.url : location.href)) window.beToast('Link copied');
      closeShares();
    }
  });

  // ----- Share button -----
  // Phones/tablets: open the device's own share sheet (Messages, X app, Instagram, etc.).
  // Desktop: show the menu of X / Facebook / LinkedIn / Email / Copy link.
  function closeShares(except) {
    document.querySelectorAll('[data-share]').forEach((w) => {
      if (w === except) return;
      w.querySelector('.share-pop').hidden = true;
      w.querySelector('.share-main').setAttribute('aria-expanded', 'false');
    });
  }
  const touch = window.matchMedia('(pointer: coarse)').matches;
  document.addEventListener('click', async (e) => {
    const main = e.target.closest('.share-main');
    if (!main) {
      if (!e.target.closest('.share-pop')) closeShares();
      else if (e.target.closest('a')) closeShares();
      return;
    }
    const wrap = main.closest('[data-share]');
    if (touch && navigator.share) {
      try { await navigator.share({ title: wrap.dataset.title, url: wrap.dataset.url }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const pop = wrap.querySelector('.share-pop');
    const open = pop.hidden;
    closeShares(wrap);
    pop.hidden = !open;
    main.setAttribute('aria-expanded', String(open));
    if (open) pop.querySelector('a, button').focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShares(); });
})();
