/*
 * Sayfanın üstünde yüzen kaynak paneli — IDM'in "download this video" paneli.
 *
 * ÖNEMLİ: bu dosya `chrome.scripting.executeScript({files:['panel.js']})` ile
 * sayfaya ENJEKTE EDİLİR. Modül DEĞİLDİR: `import`/`export` kullanamaz ve her
 * şey kendi IIFE kapsamında olmalıdır.
 *
 * Sayfanın CSS'i paneli bozamaz: her şey Shadow DOM'un içinde durur ve
 * `:host { all: initial }` ile dışarıdan miras alınan özellikler (font, renk,
 * hizalama, beyaz boşluk) sıfırlanır. Yazı tipleri eklentinin kendi
 * dosyalarıdır (`chrome.runtime.getURL`), yani çevrimdışı da aynı yüz.
 */
(() => {
  if (window.__jvPanelHost) return;
  window.__jvPanelHost = true;

  const VISIBLE_ROWS = 6;

  const KIND_LABEL = {
    video: 'Video',
    audio: 'Ses',
    archive: 'Arşiv',
    document: 'Belge',
    program: 'Program',
    other: 'Dosya',
  };

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatName(resource) {
    try {
      const last = new URL(resource.url).pathname.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(last) || resource.url;
    } catch {
      return resource.url;
    }
  }

  const fontUrl = (file) => chrome.runtime.getURL(`fonts/${file}`);

  const style = document.createElement('style');
  style.textContent = `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url('${fontUrl('inter-latin.woff2')}') format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url('${fontUrl('inter-latin-ext.woff2')}') format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'JetBrains Mono';
      font-style: normal;
      font-weight: 100 800;
      font-display: swap;
      src: url('${fontUrl('jetbrains-mono-latin.woff2')}') format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2212;
    }
    @font-face {
      font-family: 'JetBrains Mono';
      font-style: normal;
      font-weight: 100 800;
      font-display: swap;
      src: url('${fontUrl('jetbrains-mono-latin-ext.woff2')}') format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF;
    }

    :host {
      all: initial;
      display: block;
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      contain: layout style;
    }

    .card {
      width: 320px;
      max-width: calc(100vw - 32px);
      border: 1px solid #3a3a3c;
      border-radius: 12px;
      background: #2c2c2e;
      color: #ffffff;
      box-shadow: 0 16px 40px rgb(0 0 0 / 0.55), 0 2px 8px rgb(0 0 0 / 0.35);
      font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 400;
      line-height: 1.5;
      letter-spacing: -0.006em;
      text-align: left;
      direction: ltr;
      animation: rise 200ms cubic-bezier(0.23, 1, 0.32, 1);
    }

    @media (prefers-color-scheme: light) {
      .card {
        border-color: #e0e0e5;
        background: #ffffff;
        color: #1d1d1f;
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.14), 0 2px 8px rgb(0 0 0 / 0.06);
      }
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; }
      .go:active, .all:active { transform: none; }
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding: 0 8px 0 12px;
      border-bottom: 1px solid #3a3a3c;
    }

    @media (prefers-color-scheme: light) {
      header { border-bottom-color: #e0e0e5; }
    }

    .mark { width: 15px; height: 15px; flex: 0 0 auto; stroke: #0a84ff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    @media (prefers-color-scheme: light) {
      .mark { stroke: #007aff; }
    }

    .title { font-weight: 600; letter-spacing: -0.018em; }

    .count {
      font-family: 'JetBrains Mono', ui-monospace, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      letter-spacing: 0.02em;
      opacity: 0.6;
    }

    .spacer { flex: 1 1 auto; }

    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
      transition: background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), opacity 150ms cubic-bezier(0.23, 1, 0.32, 1);
    }

    .close:hover { opacity: 1; background: rgb(255 255 255 / 0.08); }
    .close:focus-visible, .go:focus-visible, .all:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
    .close svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; }

    @media (prefers-color-scheme: light) {
      .close:hover { background: rgb(0 0 0 / 0.06); }
    }

    ul { margin: 0; padding: 0; list-style: none; }

    li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 10px 9px 12px;
      border-bottom: 1px solid #3a3a3c;
    }

    @media (prefers-color-scheme: light) {
      li { border-bottom-color: #e0e0e5; }
    }

    li:last-child { border-bottom: 0; }

    .info { min-width: 0; flex: 1 1 auto; }

    .name {
      display: block;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .meta {
      display: flex;
      gap: 6px;
      font-family: 'JetBrains Mono', ui-monospace, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      letter-spacing: 0.02em;
      opacity: 0.6;
    }

    .go {
      flex: 0 0 auto;
      height: 26px;
      padding: 0 9px;
      border: 1px solid #48484a;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms cubic-bezier(0.23, 1, 0.32, 1);
    }

    .go:hover { background: #3a3a3c; }
    .go:active { transform: scale(0.97); }
    .go[disabled] { opacity: 0.5; cursor: default; transform: none; }
    .go[data-done="ok"] { border-color: rgb(48 209 88 / 0.5); color: #30d158; }
    .go[data-done="offline"] { border-color: rgb(255 69 58 / 0.5); color: #ff453a; }

    @media (prefers-color-scheme: light) {
      .go { border-color: #d1d1d6; }
      .go:hover { background: #e9e9ee; }
      .go[data-done="ok"] { color: #248a3d; }
      .go[data-done="offline"] { color: #d70015; }
    }

    footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 10px 9px 12px;
      border-top: 1px solid #3a3a3c;
    }

    @media (prefers-color-scheme: light) {
      footer { border-top-color: #e0e0e5; }
    }

    .note {
      font-size: 11px;
      line-height: 1.35;
      opacity: 0.6;
    }

    .all {
      flex: 0 0 auto;
      height: 28px;
      padding: 0 10px;
      border: 0;
      border-radius: 6px;
      background: #0a84ff;
      color: #ffffff;
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 150ms cubic-bezier(0.23, 1, 0.32, 1);
    }

    .all:hover { background: rgb(10 132 255 / 0.85); }
    .all:active { transform: scale(0.97); }
    .all[disabled] { opacity: 0.5; cursor: default; transform: none; }

    @media (prefers-color-scheme: light) {
      .all { background: #007aff; }
    }
  `;

  /*
   * Konum ve sıfırlama YALNIZCA `:host` kuralında: satır içi bir `all: initial`
   * aynı özellikleri satır içi seviyeye çeker ve `:host`'taki `right`/`bottom`u
   * geçersiz kılar (panel köşeye kaçardı).
   */
  const host = document.createElement('div');
  window.__jvPanelHost = host;
  const root = host.attachShadow({ mode: 'open' });
  root.append(style);

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'JointVault kaynakları');
  card.innerHTML = `
    <header>
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="3" width="20" height="5" rx="1"></rect>
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path>
        <path d="M10 12h4"></path>
      </svg>
      <span class="title">JointVault</span>
      <span class="count" data-num></span>
      <span class="spacer"></span>
      <button class="close" type="button" aria-label="Paneli kapat">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
      </button>
    </header>
    <ul></ul>
    <footer>
      <span class="note"></span>
      <span class="spacer"></span>
      <button class="all" type="button">Tümünü devral</button>
    </footer>
  `;
  root.append(card);

  const listEl = card.querySelector('ul');
  const countEl = card.querySelector('.count');
  const noteEl = card.querySelector('.note');
  const allBtn = card.querySelector('.all');
  const closeBtn = card.querySelector('.close');

  /** url → gönderim sonucu (`ok` · `offline` · `rejected`) */
  const sent = new Map();

  function render(items) {
    countEl.textContent = String(items.length);
    const shown = items.slice(-VISIBLE_ROWS).reverse();
    listEl.replaceChildren();

    for (const item of shown) {
      const li = document.createElement('li');

      const info = document.createElement('span');
      info.className = 'info';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = formatName(item);
      name.title = item.url;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = [KIND_LABEL[item.kind] || 'Dosya', formatSize(item.size)]
        .filter(Boolean)
        .join(' · ');
      info.append(name, meta);

      const go = document.createElement('button');
      go.className = 'go';
      go.type = 'button';
      const state = sent.get(item.url);
      go.textContent = state === 'ok' ? 'Devralındı' : state === 'offline' ? 'Uygulama kapalı' : 'Devral';
      if (state) go.dataset.done = state === 'ok' ? 'ok' : 'offline';
      if (state === 'ok') go.disabled = true;
      go.addEventListener('click', () => void handOff([item], go));

      li.append(info, go);
      listEl.append(li);
    }

    const hidden = items.length - shown.length;
    noteEl.textContent =
      hidden > 0 ? `${hidden} kaynak daha — tümü eklenti penceresinde` : '';
    allBtn.disabled = items.length === 0;
  }

  async function handOff(items, button) {
    if (button) button.disabled = true;
    let last = 'rejected';
    for (const item of items) {
      let accepted = 'rejected';
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'jv-handoff',
          url: item.url,
          referer: location.href,
        });
        if (res && res.outcome === 'ok') accepted = 'ok';
        else if (res && res.outcome === 'offline') accepted = 'offline';
      } catch {
        accepted = 'offline';
      }
      sent.set(item.url, accepted);
      last = accepted;
      if (button) {
        button.textContent =
          accepted === 'ok' ? 'Devralındı' : accepted === 'offline' ? 'Uygulama kapalı' : 'Reddedildi';
        button.dataset.done = accepted === 'ok' ? 'ok' : 'offline';
      }
    }
    if (button) button.disabled = last === 'ok';
    void refresh();
  }

  let items = [];

  async function refresh() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'jv-resources' });
      items = (res && res.items) || [];
    } catch {
      items = [];
    }
    render(items);
  }

  closeBtn.addEventListener('click', () => {
    host.remove();
    window.__jvPanelHost = null;
    void chrome.runtime.sendMessage({ type: 'jv-hide-panel' }).catch(() => {});
  });

  allBtn.addEventListener('click', () => void handOff(items, null));

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'jv-resources-updated') render(msg.items || []);
  });

  (document.body || document.documentElement).append(host);
  void refresh();
})();
