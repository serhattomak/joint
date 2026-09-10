// JointVault in-page download trigger (content script, 3 site).
// Floating button → inline Video/Ses + quality menu → single-content URL → POST.
// ponytail: prefixli class/id, tek <style> enjeksiyonu; shadow DOM yok.
(() => {
  if (window.__jvDownloadLoaded) return;
  window.__jvDownloadLoaded = true;

  const DEFAULT_ENDPOINT = "http://127.0.0.1:48120/collect";
  const FORMATS_ENDPOINT = "http://127.0.0.1:48120/formats";

  function endpointBase(endpoint) {
    // /collect → /formats (aynı host/port/token).
    return endpoint.replace(/\/collect\/?$/, "/formats");
  }

  // Content script'ten fetch CORS'a takılır; background üzerinden geç.
  function jvFetch(url, options) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "jv-fetch", url, options }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp) return reject(new Error("no response"));
        if (!resp.ok) return reject(new Error(resp.data && resp.data.error ? resp.data.error : "HTTP " + resp.status));
        resolve(resp.data);
      });
    });
  }

  const style = document.createElement("style");
  style.textContent = `
    .jv-fab{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:44px;height:44px;border-radius:50%;
      border:1px solid #e0d7c0;background:#fffdf8;color:#9a3412;cursor:pointer;box-shadow:0 4px 14px rgba(28,25,23,.18);
      display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;transition:transform .15s ease}
    .jv-fab:hover{transform:translateY(-1px)}
    .jv-menu{position:fixed;right:16px;bottom:68px;z-index:2147483647;width:200px;background:#fffdf8;color:#1c1917;
      border:1px solid #e0d7c0;border-radius:12px;box-shadow:0 8px 24px rgba(28,25,23,.22);padding:10px;font:13px/1.4 system-ui,sans-serif}
    .jv-menu .jv-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    .jv-menu label{font-size:12px;color:#78716c}
    .jv-menu select{background:#fffdf8;border:1px solid #e0d7c0;border-radius:8px;padding:4px 6px;font-size:12px;color:#1c1917}
    .jv-menu button.jv-send{width:100%;border:0;border-radius:8px;background:#9a3412;color:#fff7ed;padding:7px;font-size:13px;font-weight:600;cursor:pointer}
    .jv-menu button.jv-send:disabled{opacity:.6;cursor:wait}
    .jv-status{margin-top:6px;font-size:12px;min-height:1.2em}
    .jv-status.ok{color:#3f6212;font-weight:600}
    .jv-status.err{color:#b91c1c}
    .jv-warn{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#1c1917;color:#faf7f1;
      padding:10px 16px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)}
  `;
  document.head.appendChild(style);

  function resolveContent() {
    const href = location.href;
    let m;
    if ((m = href.match(/\/status\/(\d+)/))) return { url: `https://x.com/i/status/${m[1]}`, site: "x" };
    if ((m = href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/))) return { url: `https://www.instagram.com/${m[1]}/${m[2]}/`, site: "instagram" };
    if ((m = href.match(/[?&]v=([\w-]{11})/))) return { url: `https://www.youtube.com/watch?v=${m[1]}`, site: "youtube" };
    return null;
  }

  function warn(msg) {
    const el = document.createElement("div");
    el.className = "jv-warn";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  const fab = document.createElement("button");
  fab.className = "jv-fab";
  fab.title = "JointVault indir";
  fab.textContent = "↓";
  document.body.appendChild(fab);

  let menu = null;
  fab.addEventListener("click", () => {
    if (menu) { menu.remove(); menu = null; return; }
    const content = resolveContent();
    if (!content) {
      warn("Tekil içerik sayfası aç: tweet, Instagram postu veya YouTube videosu.");
      return;
    }
    menu = document.createElement("div");
    menu.className = "jv-menu";
    menu.innerHTML = `
      <div class="jv-row"><label>Format</label>
        <select class="jv-kind"><option value="video">Video</option><option value="audio">Ses</option></select></div>
      <div class="jv-row"><label>Kalite</label>
        <select class="jv-quality"><option value="">Yükleniyor…</option></select></div>
      <button class="jv-send">Gönder</button>
      <div class="jv-status"></div>`;
    document.body.appendChild(menu);

    const kindEl = menu.querySelector(".jv-kind");
    const qualityEl = menu.querySelector(".jv-quality");
    const sendEl = menu.querySelector(".jv-send");
    const statusEl = menu.querySelector(".jv-status");

    // Ses için kalite anlamsız — devre dışı bırak.
    kindEl.addEventListener("change", () => {
      qualityEl.disabled = kindEl.value === "audio";
    });

    // Gerçek yükseklikleri bridge'den çek (linkin sunduğu seçenekler).
    (async () => {
      try {
        const cfg = await new Promise((res) => chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: "" }, res));
        const data = await jvFetch(endpointBase(cfg.endpoint) + "?url=" + encodeURIComponent(content.url), {
          headers: { Authorization: "Bearer " + cfg.token },
        });
        const heights = data.heights || [];
        qualityEl.innerHTML = heights.length
          ? heights.map((h) => `<option value="${h}">${h}p</option>`).join("")
          : `<option value="">Yok</option>`;
      } catch (e) {
        qualityEl.innerHTML = `<option value="">Hata</option>`;
        statusEl.className = "jv-status err";
        statusEl.textContent = "Kalite okunamadı: " + (e && e.message ? e.message : e);
      }
    })();

    sendEl.addEventListener("click", async () => {
      sendEl.disabled = true;
      statusEl.textContent = "Gönderiliyor…";
      statusEl.className = "jv-status";
      try {
        const cfg = await new Promise((res) => chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: "" }, res));
        const data = await jvFetch(cfg.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.token },
          body: JSON.stringify({
            items: [{ url: content.url, title: document.title.slice(0, 200), thumbnail: null, site: content.site }],
            mode: "download",
            kind: kindEl.value,
            quality: qualityEl.value,
          }),
        });
        statusEl.className = "jv-status ok";
        statusEl.textContent = "Kuyruğa alındı (" + (data.accepted ?? 1) + ")";
        setTimeout(() => { menu.remove(); menu = null; }, 1500);
      } catch (e) {
        statusEl.className = "jv-status err";
        statusEl.textContent = "Hata: " + (e && e.message ? e.message : e);
      } finally {
        sendEl.disabled = false;
      }
    });
  });
})();