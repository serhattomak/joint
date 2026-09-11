const DEFAULT_ENDPOINT = "http://127.0.0.1:48120/collect";
const endpointEl = document.getElementById("endpoint");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");

chrome.storage.local.get(
  { endpoint: DEFAULT_ENDPOINT, token: "" },
  (cfg) => {
    endpointEl.value = cfg.endpoint;
    tokenEl.value = cfg.token;
  }
);

endpointEl.addEventListener("change", () => {
  chrome.storage.local.set({ endpoint: endpointEl.value.trim() || DEFAULT_ENDPOINT });
});
tokenEl.addEventListener("change", () => {
  chrome.storage.local.set({ token: tokenEl.value.trim() });
});

// Sekme rozeti: hangi adapter çalışacak, popup açılışında göster.
(() => {
  const sites = [
    { match: ["youtube.com", "youtu.be"], name: "YouTube", hint: "Playlist sayfasını açıp Topla'ya bas.", dot: "#dc2626" },
    { match: ["instagram.com"], name: "Instagram", hint: "Kaydedilenler sayfasını açıp Topla'ya bas.", dot: "#db2777" },
    { match: ["x.com", "twitter.com"], name: "X", hint: "Yer işaretleri sayfasını açıp Topla'ya bas.", dot: "#78716c" },
  ];
  const setSite = (name, hint, dot) => {
    document.getElementById("siteName").textContent = name;
    document.getElementById("siteHint").textContent = hint;
    document.getElementById("siteDot").style.background = dot;
  };
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    const found = sites.find((s) => s.match.some((m) => (tab && tab.url ? tab.url.includes(m) : false)));
    if (found) setSite(found.name, found.hint, found.dot);
    else setSite("Bilinmeyen sekme", "Desteklenen bir kaydedilenler sayfası aç.", "#a8a29e");
  }).catch(() => setSite("Bilinmeyen sekme", "Desteklenen bir kaydedilenler sayfası aç.", "#a8a29e"));
})();

// Tekil indir: sekmeye göre tekil URL + gerçek kaliteler (yüzen buton yerine).
(() => {
  const kindEl = document.getElementById("dl-kind");
  const qualityEl = document.getElementById("dl-quality");
  const btn = document.getElementById("download");
  const hintEl = document.getElementById("dlHint");
  let single = null;

  const resolveSingle = (url) => {
    let m;
    if ((m = url.match(/\/status\/(\d+)/))) return { url: `https://x.com/i/status/${m[1]}`, site: "x" };
    if ((m = url.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/))) return { url: `https://www.instagram.com/${m[1]}/${m[2]}/`, site: "instagram" };
    if ((m = url.match(/[?&]v=([\w-]{11})/))) return { url: `https://www.youtube.com/watch?v=${m[1]}`, site: "youtube" };
    return null;
  };

  kindEl.addEventListener("change", () => {
    qualityEl.disabled = kindEl.value === "audio";
  });

  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    single = resolveSingle(tab && tab.url ? tab.url : "");
    if (!single) {
      hintEl.textContent = "Tekil içerik (tweet, post, video) sayfasında aktif olur.";
      btn.disabled = true;
      return;
    }
    hintEl.textContent = "Bu sayfadaki içerik review'e düşer.";
    try {
      const cfg = await new Promise((res) => chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: "" }, res));
      const base = (cfg.endpoint || DEFAULT_ENDPOINT).replace(/\/collect\/?$/, "/formats");
      const res = await fetch(base + "?url=" + encodeURIComponent(single.url), {
        headers: { Authorization: "Bearer " + cfg.token },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      const heights = data.heights || [];
      qualityEl.innerHTML = heights.length
        ? heights.map((h) => `<option value="${h}">${h}p</option>`).join("")
        : `<option value="720">720p</option>`;
    } catch (e) {
      qualityEl.innerHTML = `<option value="720">720p</option>`;
      hintEl.textContent = "Kalite okunamadı, varsayılan 720p: " + (e && e.message ? e.message : e);
    }
  }).catch(() => {
    btn.disabled = true;
  });

  btn.addEventListener("click", async () => {
    if (!single) return;
    const endpoint = endpointEl.value.trim() || DEFAULT_ENDPOINT;
    const token = tokenEl.value.trim();
    btn.disabled = true;
    statusEl.dataset.state = "busy";
    statusEl.textContent = "Gönderiliyor…";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          items: [{
            url: single.url,
            title: tab && tab.title ? tab.title.slice(0, 200) : null,
            thumbnail: null,
            site: single.site,
          }],
          mode: "download",
          kind: kindEl.value,
          quality: qualityEl.value || "720",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      statusEl.dataset.state = "ok";
      statusEl.textContent = "Kuyruğa alındı (" + (data.accepted ?? 1) + ")";
    } catch (e) {
      statusEl.dataset.state = "error";
      statusEl.textContent = "Error: " + (e && e.message ? e.message : e);
    } finally {
      btn.disabled = false;
    }
  });
})();

document.getElementById("collect").addEventListener("click", async () => {
  const btn = document.getElementById("collect");
  const endpoint = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  const token = tokenEl.value.trim();
  chrome.storage.local.set({ endpoint, token });
  btn.disabled = true;
  statusEl.dataset.state = "busy";
  statusEl.textContent = "Scrolling page, collecting… (keep popup open, large lists take minutes)";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error("no active tab");
    // Site router: tab URL decides the adapter, single Collect button.
    const tabUrl = tab.url || "";
    const isYT = tabUrl.includes("youtube.com") || tabUrl.includes("youtu.be");
    if (isYT && !tabUrl.includes("/playlist") && !(tabUrl.includes("/watch") && tabUrl.includes("list="))) {
      statusEl.dataset.state = "error";
      statusEl.textContent = "Önce bir YouTube playlisti aç (playlist sayfası ya da listeli izleme).";
      return;
    }
    const script = isYT
      ? "scrape-youtube.js"
      : tabUrl.includes("instagram.com")
        ? "scrape-instagram.js"
        : "scrape.js";
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [script]
    });
    const raw = (injected && injected[0] && injected[0].result) || [];
    // Yeni kontrat {items, debug}; eski dizi kontratıyla geriye uyumlu.
    const items = Array.isArray(raw) ? raw : raw.items || [];
    const debug = Array.isArray(raw) ? null : raw.debug;
    if (!items.length) {
      statusEl.dataset.state = "error";
      statusEl.textContent = "No bookmarks found on this page.";
      return;
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ items })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    statusEl.dataset.state = "ok";
    statusEl.textContent =
      "OK: " + (data.accepted != null ? data.accepted : items.length) + " accepted" +
      (debug ? ` | ${debug.v ?? "?"} tur=${debug.passes} bos=${debug.emptyHits} h=${debug.startHeight}→${debug.endHeight}` : "");
  } catch (e) {
    statusEl.dataset.state = "error";
    statusEl.textContent = "Error: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
  }
});
