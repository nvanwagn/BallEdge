// Article editor: hero image upload, rich text, inline images and code boxes.
(function () {
  const data = JSON.parse(document.getElementById('editorData').textContent);
  const form = document.getElementById('editorForm');
  const editor = document.getElementById('editor');
  const toolbar = document.getElementById('toolbar');
  const saveState = document.getElementById('saveState');
  const isAbout = data.mode === 'about';
  let articleId = data.id;
  let status = data.status || 'draft';
  let slug = data.slug || '';
  let dirty = false;
  let lastRange = null;

  const LANGS = { sql: 'SQL', r: 'R', python: 'Python', plaintext: 'Text' };
  const toast = (m, err) => window.beToast && window.beToast(m, err);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const markDirty = () => { dirty = true; saveState.textContent = 'Unsaved changes'; };

  document.execCommand('defaultParagraphSeparator', false, 'p');

  /* ---------------- Auto-growing headline/subheadline ---------------- */
  form.querySelectorAll('textarea.title-input, textarea.dek-input').forEach((ta) => {
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (ta.nextElementSibling && ta.nextElementSibling.focus) ? ta.nextElementSibling.focus() : editor.focus(); } });
    requestAnimationFrame(grow);
  });
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

  /* ---------------- Uploading (with gentle client-side resize) ---------------- */
  const MAX_W = 2400;
  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = typeof file === 'string' ? file : URL.createObjectURL(file);
    });
  }
  async function shrink(file) {
    if (!/image\/(jpeg|png|webp)/.test(file.type)) return file;
    try {
      const img = await loadImage(file);
      if (img.naturalWidth <= MAX_W) return file;
      const scale = MAX_W / img.naturalWidth;
      const c = document.createElement('canvas');
      c.width = MAX_W; c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, file.type, 0.9));
      return blob ? new File([blob], file.name, { type: file.type }) : file;
    } catch { return file; }
  }
  async function uploadImage(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
    const fd = new FormData();
    fd.append('image', await shrink(file));
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Upload failed.');
    return out.url;
  }

  /* ---------------- Hero image ---------------- */
  const heroDrop = document.getElementById('heroDrop');
  const heroFile = document.getElementById('heroFile');
  const heroPreview = document.getElementById('heroPreview');
  const heroInput = form.querySelector('input[name="hero_image"]');
  const shareInput = form.querySelector('input[name="share_image"]');

  // Link previews (X/Twitter "large image" cards, Facebook, iMessage…) look best at exactly
  // 1200×630. Make a centered crop of the hero at that size and upload it alongside.
  async function makeShareImage(source) {
    const img = await loadImage(source);
    const W = 1200, H = 630;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const sw = W / scale, sh = H / scale;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Could not create share image');
    return uploadImage(new File([blob], 'share.jpg', { type: 'image/jpeg' }));
  }

  async function setHero(file) {
    heroDrop.classList.add('uploading');
    try {
      const url = await uploadImage(file);
      heroInput.value = url; heroPreview.src = url;
      heroDrop.classList.add('has-image'); markDirty();
      if (shareInput) {
        shareInput.value = '';
        try { shareInput.value = await makeShareImage(file); } catch { /* falls back to the hero itself */ }
      }
    } catch (err) { toast(err.message, true); }
    heroDrop.classList.remove('uploading');
  }
  heroDrop.addEventListener('click', (e) => {
    if (e.target.closest('[data-hero-remove]')) { heroInput.value = ''; if (shareInput) shareInput.value = ''; heroPreview.removeAttribute('src'); heroDrop.classList.remove('has-image'); markDirty(); return; }
    if (!heroDrop.classList.contains('has-image') || e.target.closest('[data-hero-change]')) heroFile.click();
  });
  heroFile.addEventListener('change', () => { if (heroFile.files[0]) setHero(heroFile.files[0]); heroFile.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => heroDrop.addEventListener(ev, (e) => { e.preventDefault(); heroDrop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => heroDrop.addEventListener(ev, () => heroDrop.classList.remove('drag')));
  heroDrop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setHero(f); });

  /* ---------------- Widgets: code boxes & inline images ---------------- */
  function codeWidget(lang = 'sql', code = '') {
    const w = document.createElement('div');
    w.className = 'w w-code';
    w.contentEditable = 'false';
    w.innerHTML = `<div class="w-head">
        <span class="w-label">Code Box</span>
        <select aria-label="Language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span class="w-spacer"></span>
        <button type="button" class="w-btn" data-w-up title="Move up">↑</button>
        <button type="button" class="w-btn" data-w-down title="Move down">↓</button>
        <button type="button" class="w-btn danger" data-w-remove title="Remove code box">Remove</button>
      </div>
      <textarea spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Paste or type your SQL / R code here…"></textarea>`;
    const ta = w.querySelector('textarea');
    ta.value = code;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(110, ta.scrollHeight + 2) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en } = ta;
        ta.setRangeText('  ', s, en, 'end'); grow(); markDirty();
      }
    });
    requestAnimationFrame(grow);
    return w;
  }

  function imageWidget(src = '', caption = '', size = 'fig-full') {
    const w = document.createElement('div');
    w.className = 'w w-img ' + size;
    w.contentEditable = 'false';
    w.innerHTML = `<div class="w-head">
        <span class="w-label">Image</span>
        <div class="w-seg" role="group" aria-label="Image size">
          <button type="button" data-size="fig-full" class="${size === 'fig-full' ? 'on' : ''}">Full width</button>
          <button type="button" data-size="fig-inset" class="${size === 'fig-inset' ? 'on' : ''}">Inset (text wraps)</button>
        </div>
        <span class="w-spacer"></span>
        <button type="button" class="w-btn" data-w-up title="Move up">↑</button>
        <button type="button" class="w-btn" data-w-down title="Move down">↓</button>
        <button type="button" class="w-btn danger" data-w-remove title="Remove image">Remove</button>
      </div>
      <div class="w-img-frame"><img alt=""><span class="w-loading">Uploading…</span></div>
      <input class="w-caption" type="text" placeholder="Caption or source (optional)" maxlength="300">`;
    if (src) w.querySelector('img').src = src; else w.classList.add('loading');
    w.dataset.src = src;
    w.querySelector('.w-caption').value = caption;
    return w;
  }

  // Widget controls
  editor.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (!w) return;
    if (e.target.closest('[data-w-remove]')) {
      if (confirm('Remove this ' + (w.classList.contains('w-code') ? 'code box' : 'image') + '?')) { w.remove(); ensureTrailingParagraph(); markDirty(); }
    } else if (e.target.closest('[data-w-up]') && w.previousElementSibling) {
      w.parentNode.insertBefore(w, w.previousElementSibling); markDirty();
    } else if (e.target.closest('[data-w-down]') && w.nextElementSibling) {
      w.parentNode.insertBefore(w.nextElementSibling, w); markDirty();
    } else if (e.target.closest('[data-size]')) {
      const size = e.target.closest('[data-size]').dataset.size;
      w.classList.remove('fig-full', 'fig-inset'); w.classList.add(size);
      w.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', b.dataset.size === size));
      markDirty();
    }
  });
  // Protect images/code boxes from being wiped out by Backspace/Delete in the text around them.
  editor.addEventListener('keydown', (e) => {
    if (e.target.closest('.w') || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
    const sel = document.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const block = topBlock(r.startContainer);
    if (!block || block.classList.contains('w')) return;
    const probe = document.createRange();
    probe.selectNodeContents(block);
    if (e.key === 'Backspace') {
      probe.setEnd(r.startContainer, r.startOffset);
      const prev = block.previousElementSibling;
      if (probe.toString() === '' && prev && prev.classList.contains('w')) {
        e.preventDefault();
        if (!block.textContent.trim()) { block.remove(); ensureTrailingParagraph(); }
      }
    } else {
      probe.setStart(r.startContainer, r.startOffset);
      const next = block.nextElementSibling;
      if (probe.toString() === '' && next && next.classList.contains('w')) {
        e.preventDefault();
        if (!block.textContent.trim()) { block.remove(); ensureTrailingParagraph(); }
      }
    }
  });

  /* ---------------- Inserting at the cursor (splits paragraphs) ---------------- */
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode) && !(sel.anchorNode.closest ? sel.anchorNode : sel.anchorNode.parentElement).closest('.w')) {
      lastRange = sel.getRangeAt(0).cloneRange();
      syncBlockSelect();
    }
  });

  function topBlock(node) {
    while (node && node.parentNode !== editor) node = node.parentNode;
    return node && node.parentNode === editor ? node : null;
  }

  function placeCaret(el, atStart = true) {
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(atStart);
    const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    lastRange = r.cloneRange();
  }

  function updateEmpty() {
    editor.classList.toggle('is-empty', editor.children.length === 1 && editor.firstElementChild.nodeName === 'P' && !editor.textContent.trim());
  }
  function ensureTrailingParagraph() {
    const last = editor.lastElementChild;
    if (!last || last.classList.contains('w')) { const p = document.createElement('p'); p.innerHTML = '<br>'; editor.appendChild(p); }
    if (!editor.firstElementChild) editor.innerHTML = '<p><br></p>';
    updateEmpty();
  }

  function insertWidget(widget) {
    const range = lastRange && editor.contains(lastRange.startContainer) ? lastRange : null;
    let block = range ? topBlock(range.startContainer) : null;

    if (!block) {
      editor.appendChild(widget);
    } else if (block.classList && block.classList.contains('w') || /^(UL|OL|TABLE)$/.test(block.nodeName)) {
      block.after(widget);
    } else {
      // Split the current paragraph at the cursor and drop the widget in between.
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(block, block.childNodes.length);
      const frag = tail.extractContents();
      const after = document.createElement(block.nodeName === 'BLOCKQUOTE' ? 'blockquote' : block.nodeName.toLowerCase());
      after.appendChild(frag);
      block.after(widget);
      if (after.textContent.trim()) widget.after(after);
      if (!block.textContent.trim() && !block.querySelector('img')) block.remove();
    }
    ensureTrailingParagraph();
    const next = widget.nextElementSibling;
    if (next) placeCaret(next, true);
    markDirty();
    return widget;
  }

  async function insertImageFile(file) {
    const local = URL.createObjectURL(file);
    const w = insertWidget(imageWidget('', ''));
    w.querySelector('img').src = local;
    try {
      const url = await uploadImage(file);
      w.dataset.src = url; w.querySelector('img').src = url; w.classList.remove('loading');
      markDirty();
    } catch (err) { w.remove(); toast(err.message, true); }
  }

  const inlineFile = document.getElementById('inlineFile');
  inlineFile.addEventListener('change', () => { if (inlineFile.files[0]) insertImageFile(inlineFile.files[0]); inlineFile.value = ''; });

  /* ---------------- Toolbar ---------------- */
  // Keep the editor's selection when pressing toolbar buttons.
  toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

  function restoreSelection() {
    editor.focus();
    if (lastRange) { const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(lastRange); }
  }

  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.insert === 'image') { inlineFile.click(); return; }
    if (b.dataset.insert === 'code') { const w = insertWidget(codeWidget()); w.querySelector('textarea').focus(); return; }
    restoreSelection();
    const cmd = b.dataset.cmd;
    if (cmd === 'link') {
      const sel = document.getSelection();
      if (!sel.toString()) { toast('Select some text to turn into a link first.'); return; }
      let url = prompt('Link address (https://…)', 'https://');
      if (!url || url === 'https://') return;
      if (!/^(https?:|mailto:|\/)/i.test(url)) url = 'https://' + url;
      document.execCommand('createLink', false, url);
    } else if (cmd === 'quote') {
      const block = lastRange && topBlock(lastRange.startContainer);
      document.execCommand('formatBlock', false, block && block.nodeName === 'BLOCKQUOTE' ? 'p' : 'blockquote');
    } else {
      document.execCommand(cmd, false, null);
    }
    markDirty();
  });

  const blockSelect = toolbar.querySelector('[data-block]');
  blockSelect.addEventListener('change', () => {
    restoreSelection();
    document.execCommand('formatBlock', false, blockSelect.value);
    markDirty();
  });
  function syncBlockSelect() {
    const block = lastRange && topBlock(lastRange.startContainer);
    const tag = block ? block.nodeName.toLowerCase() : 'p';
    blockSelect.value = ['h2', 'h3'].includes(tag) ? tag : 'p';
    toolbar.querySelectorAll('[data-cmd]').forEach((btn) => {
      const c = btn.dataset.cmd;
      if (['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].includes(c)) {
        try { btn.classList.toggle('on', document.queryCommandState(c)); } catch {}
      }
      if (c === 'quote') btn.classList.toggle('on', tag === 'blockquote');
    });
  }

  editor.addEventListener('keydown', (e) => {
    if (e.target.closest('.w')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); toolbar.querySelector('[data-cmd="link"]').click(); }
  });
  editor.addEventListener('input', () => { ensureTrailingParagraph(); markDirty(); });

  /* ---------------- Paste & drop ---------------- */
  const ALLOWED = new Set(['P', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
  function cleanPasted(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (node) => {
      [...node.childNodes].forEach((ch) => {
        if (ch.nodeType === 8) { ch.remove(); return; }
        if (ch.nodeType !== 1) return;
        walk(ch);
        let tag = ch.nodeName;
        if (tag === 'H1' || tag === 'H4' || tag === 'H5' || tag === 'H6') tag = tag === 'H1' ? 'H2' : 'H3';
        if (tag === 'DIV') tag = 'P';
        if (/^(SCRIPT|STYLE|META|LINK|TITLE|IMG|SVG|IFRAME|OBJECT)$/.test(tag)) { ch.remove(); return; }
        if (!ALLOWED.has(tag)) { ch.replaceWith(...ch.childNodes); return; }
        const el = doc.createElement(tag);
        if (tag === 'A' && ch.getAttribute('href')) el.setAttribute('href', ch.getAttribute('href'));
        el.append(...ch.childNodes);
        ch.replaceWith(el);
      });
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }

  editor.addEventListener('paste', (e) => {
    if (e.target.closest('.w')) return; // code boxes & captions take plain paste
    const cd = e.clipboardData;
    const imgItem = [...(cd.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (imgItem) { e.preventDefault(); insertImageFile(imgItem.getAsFile()); return; }
    e.preventDefault();
    const html = cd.getData('text/html');
    if (html) document.execCommand('insertHTML', false, cleanPasted(html));
    else {
      const text = cd.getData('text/plain');
      const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      if (paras.length > 1) document.execCommand('insertHTML', false, paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
      else document.execCommand('insertText', false, text);
    }
  });

  editor.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  editor.addEventListener('drop', (e) => {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (r && editor.contains(r.startContainer)) lastRange = r;
    insertImageFile(file);
  });

  /* ---------------- Load existing content ---------------- */
  function hydrate(html) {
    editor.innerHTML = html || '<p><br></p>';
    editor.querySelectorAll('pre[data-lang]').forEach((pre) => {
      pre.replaceWith(codeWidget(pre.dataset.lang, pre.textContent));
    });
    editor.querySelectorAll('figure').forEach((fig) => {
      const img = fig.querySelector('img');
      if (!img) { fig.remove(); return; }
      const cap = fig.querySelector('figcaption');
      fig.replaceWith(imageWidget(img.getAttribute('src'), cap ? cap.textContent : '', fig.classList.contains('fig-inset') ? 'fig-inset' : 'fig-full'));
    });
    // Wrap any stray top-level text into paragraphs.
    [...editor.childNodes].forEach((n) => {
      if (n.nodeType === 3 && n.textContent.trim()) { const p = document.createElement('p'); n.replaceWith(p); p.appendChild(n); }
    });
    ensureTrailingParagraph();
  }
  hydrate(data.bodyHtml);

  /* ---------------- Serialize for saving ---------------- */
  function serialize() {
    const live = [...editor.querySelectorAll('.w')];
    live.forEach((w, i) => (w.dataset.idx = i));
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.w').forEach((cw) => {
      const w = live[Number(cw.dataset.idx)];
      if (w.classList.contains('w-code')) {
        const code = w.querySelector('textarea').value.replace(/\s+$/, '');
        if (!code) { cw.remove(); return; }
        cw.outerHTML = `<pre data-lang="${w.querySelector('select').value}"><code>${esc(code)}</code></pre>`;
      } else {
        const src = w.dataset.src;
        if (!src) { cw.remove(); return; }
        const cap = w.querySelector('.w-caption').value.trim();
        const size = w.classList.contains('fig-inset') ? 'fig-inset' : 'fig-full';
        cw.outerHTML = `<figure class="${size}"><img src="${esc(src)}" alt="${esc(cap)}">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
      }
    });
    clone.querySelectorAll('div').forEach((d) => { const p = document.createElement('p'); p.innerHTML = d.innerHTML; d.replaceWith(p); });
    // Trim empty paragraphs at the end
    let last = clone.lastElementChild;
    while (last && last.nodeName === 'P' && !last.textContent.trim() && !last.querySelector('img')) { last.remove(); last = clone.lastElementChild; }
    return clone.innerHTML.replace(/<p><br><\/p>/g, '<p></p>').replace(/<p><\/p>/g, '');
  }

  /* ---------------- Saving ---------------- */
  let saving = false;
  async function save(target) {
    if (saving) return false;
    if (editor.querySelector('.w-img.loading')) { toast('Wait for the image upload to finish.', true); return false; }
    // Articles saved before share images existed get one made automatically.
    if (shareInput && heroInput.value && !shareInput.value) {
      try { shareInput.value = await makeShareImage(heroInput.value); } catch { /* hero is used instead */ }
    }
    const fd = new FormData(form);
    const payload = {
      title: (fd.get('title') || '').trim(),
      dek: (fd.get('dek') || '').trim(),
      category: fd.get('category'),
      hero_image: fd.get('hero_image') || '',
      share_image: fd.get('share_image') || '',
      hero_caption: (fd.get('hero_caption') || '').trim(),
      body_html: serialize(),
      status: target,
    };
    saving = true; saveState.textContent = 'Saving…';
    try {
      const url = isAbout ? '/api/about' : articleId ? '/api/articles/' + articleId : '/api/articles';
      const res = await fetch(url, { method: isAbout || articleId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Save failed.');
      dirty = false;
      if (!isAbout) {
        articleId = out.id; slug = out.slug; status = out.status;
        if (location.pathname === '/admin/new') history.replaceState(null, '', '/admin/edit/' + articleId);
        const pv = form.querySelector('[data-preview]'); if (pv) pv.disabled = false;
        updateButtons();
      }
      saveState.textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return out;
    } catch (err) {
      saveState.textContent = 'Not saved';
      toast(err.message, true);
      return false;
    } finally { saving = false; }
  }

  function updateButtons() {
    const pub = form.querySelector('[data-save="publish"]');
    const dr = form.querySelector('[data-save="draft"]');
    if (isAbout || !pub) return;
    pub.textContent = status === 'published' ? 'Update' : 'Publish';
    dr.textContent = status === 'published' ? 'Unpublish' : 'Save Draft';
  }
  updateButtons();

  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-save]');
    if (b) {
      const target = b.dataset.save === 'publish' ? 'published' : 'draft';
      if (!isAbout && target === 'draft' && status === 'published' && !confirm('Unpublish this article? It will be hidden from the site until you publish it again.')) return;
      const out = await save(target);
      if (!out) return;
      if (isAbout) { location.href = '/about'; return; }
      if (target === 'published') location.href = '/article/' + out.slug;
      else toast(status === 'draft' ? 'Draft saved' : 'Saved');
    }
    if (e.target.closest('[data-preview]')) {
      const win = window.open('about:blank', '_blank');
      const out = await save(status);
      if (out && win) win.location = '/article/' + out.slug; else if (win) win.close();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(isAbout ? 'published' : status).then((o) => o && toast('Saved')); }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
})();
