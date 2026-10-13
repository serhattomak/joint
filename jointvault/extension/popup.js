import { enqueue, pendingCount } from "./outbox.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:48120/collect";
const endpointEl = document.getElementById("endpoint");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const permBanner = document.getElementById("permBanner");
const serverDot = document.getElementById("serverDot");
const serverStatusText = document.getElementById("serverStatusText");
const versionChip = document.getElementById("versionChip");
const pendingChip = document.getElementById("pendingChip");
const pendingCountEl = document.getElementById("pendingCount");

// outbox.js `chrome`'a bağımlı değil; depolama adaptörü burada verilir.
const outboxStore = {
  get: (key) => chrome.storage.local.get(key),
  set: (values) => chrome.storage.local.set(values),
};

// Bekleyen kaydı çipte göster; sürüm çipi yerini ona bırakır (tek satır korunur).
async function refreshPending() {
  const n = await pendingCount(outboxStore);
  versionChip.hidden = n > 0;
  pendingChip.hidden = n === 0;
  pendingChip.title = n > 0 ? `${n} kayıt aktarım bekliyor` : "";
  pendingCountEl.textContent = String(n);
  return n;
}

// Arka plan aktarıcıyı dürt: uygulama ayaktaysa kuyruk tek partide gider.
async function flushBacklog() {
  try {
    return await chrome.runtime.sendMessage({ type: "jv-flush" });
  } catch {
    return { state: "unknown" };
  }
}

// Load stored settings
chrome.storage.local.get(
  { endpoint: DEFAULT_ENDPOINT, token: "" },
  (cfg) => {
    endpointEl.value = cfg.endpoint;
    tokenEl.value = cfg.token;
    checkServerConnection(cfg.endpoint);
    // Açılışta bekleyeni dene: uygulama kapalıysa kuyruk yerinde kalır.
    void refreshPending().then(async (before) => {
      if (before === 0) return before;
      const res = await flushBacklog();
      await refreshPending();
      if (res && res.state === "sent") {
        statusEl.dataset.state = "ok";
        statusText.textContent = `Bekleyen ${res.sent} kayıt JointVault'a aktarıldı.`;
      } else if (res && res.state === "unauthorized") {
        statusEl.dataset.state = "error";
        statusText.textContent =
          "Eşleşme anahtarı geçersiz: bekleyen kayıtlar aktarılamadı. Ayarlar bölümünden anahtarı güncelle.";
      }
      return before;
    });
  }
);

endpointEl.addEventListener("change", () => {
  const ep = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  chrome.storage.local.set({ endpoint: ep });
  checkServerConnection(ep);
});

tokenEl.addEventListener("change", () => {
  chrome.storage.local.set({ token: tokenEl.value.trim() });
});

// Check if chrome.cookies permission is loaded (Chrome 127+ requires extension reload when manifest changes)
if (!chrome.cookies && permBanner) {
  permBanner.style.display = "flex";
}

// Ping JointVault desktop bridge
async function checkServerConnection(endpoint) {
  try {
    const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/collect\/?$/, "/formats?url=ping");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(base, { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);
    if (res && res.status !== 0) {
      serverDot.classList.add("online");
      serverStatusText.textContent = "Arşiv Bağlı";
    } else {
      serverDot.classList.remove("online");
      serverStatusText.textContent = "Arşiv Kapalı";
    }
  } catch {
    serverDot.classList.remove("online");
    serverStatusText.textContent = "Arşiv Kapalı";
  }
}

// Sekme algılayıcı ve rozet güncelleme
(() => {
  const badgeEl = document.getElementById("platformBadge");
  const nameEl = document.getElementById("siteName");
  const hintEl = document.getElementById("siteHint");

  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    const url = tab && tab.url ? tab.url : "";

    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      badgeEl.style.background = "var(--color-src-youtube)";
      if (url.includes("/playlist") || url.includes("list=")) {
        nameEl.textContent = "YouTube - Oynatma Listesi";
        hintEl.textContent = "Topla'ya basarak listeyi JointVault'a aktarın.";
      } else {
        nameEl.textContent = "YouTube";
        hintEl.textContent = "Tekil videoyu aşağıdan indirebilir veya playlist açabilirsiniz.";
      }
    } else if (url.includes("instagram.com")) {
      badgeEl.style.background = "var(--color-src-instagram)";
      if (url.includes("/saved")) {
        nameEl.textContent = "Instagram - Kaydedilenler";
        hintEl.textContent = "Topla'ya basarak tüm kaydedilenleri çekin.";
      } else {
        nameEl.textContent = "Instagram";
        hintEl.textContent = "Kaydedilenler sayfasını açıp Topla'ya basın.";
      }
    } else if (url.includes("x.com") || url.includes("twitter.com")) {
      badgeEl.style.background = "var(--color-src-x)";
      if (url.includes("/bookmarks") || url.includes("/i/bookmarks")) {
        nameEl.textContent = "X (Twitter) - Yer İmleri";
        hintEl.textContent = "Topla'ya basarak tüm yer imlerini çekin.";
      } else {
        nameEl.textContent = "X (Twitter)";
        hintEl.textContent = "Yer imleri sayfasını (/i/bookmarks) açıp Topla'ya basın.";
      }
    } else {
      badgeEl.style.background = "var(--color-src-other)";
      nameEl.textContent = "Desteklenmeyen Sekme";
      hintEl.textContent = "X, Instagram veya YouTube sekmesinde çalışır.";
    }
  }).catch(() => {
    nameEl.textContent = "Sekme okunamadı";
  });
})();

// Tekil indirici modülü
(() => {
  const kindEl = document.getElementById("dl-kind");
  const qualityEl = document.getElementById("dl-quality");
  const btn = document.getElementById("download");
  const hintEl = document.getElementById("dlHint");
  const badgeEl = document.getElementById("dlBadge");
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
      badgeEl.textContent = "Pasif";
      hintEl.textContent = "Tekil tweet, reel/post veya YouTube videosunda aktif olur.";
      btn.disabled = true;
      return;
    }

    badgeEl.textContent = "Aktif";
    badgeEl.dataset.tone = "local";
    btn.disabled = false;
    hintEl.textContent = "Bu sayfadaki medya içeriği algılandı. Doğrudan Arşive indirebilirsiniz.";

    try {
      const cfg = await new Promise((res) => chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: "" }, res));
      const base = (cfg.endpoint || DEFAULT_ENDPOINT).replace(/\/collect\/?$/, "/formats");
      const res = await fetch(base + "?url=" + encodeURIComponent(single.url), {
        headers: { Authorization: "Bearer " + cfg.token },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.heights) && data.heights.length > 0) {
        qualityEl.innerHTML = data.heights.map((h) => `<option value="${h}">${h}p</option>`).join("");
      } else {
        qualityEl.innerHTML = `<option value="720">720p (Varsayılan)</option><option value="1080">1080p</option><option value="480">480p</option>`;
      }
    } catch {
      qualityEl.innerHTML = `<option value="720">720p (Varsayılan)</option><option value="1080">1080p</option>`;
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
    statusText.textContent = "İçerik Arşive aktarılıyor…";
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
      if (res.status === 401) {
        throw new Error("Yetkilendirme hatası (401). Lütfen Ayarlar kısmından JointVault eşleşme anahtarını girin.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      statusEl.dataset.state = "ok";
      statusText.textContent = "Başarılı: İçerik Arşive alındı ve indirme başlatıldı!";
    } catch (e) {
      statusEl.dataset.state = "error";
      statusText.textContent = "Hata: " + (e && e.message ? e.message : e);
    } finally {
      btn.disabled = false;
    }
  });
})();

// Topla butonu (DOM Scraper)
document.getElementById("collect").addEventListener("click", async () => {
  const btn = document.getElementById("collect");
  const endpoint = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  const token = tokenEl.value.trim();
  chrome.storage.local.set({ endpoint, token });
  btn.disabled = true;
  statusEl.dataset.state = "busy";
  statusText.textContent = "Sayfa taranıyor ve kaydırılıyor… (Pencereyi açık tutun)";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error("Aktif sekme bulunamadı.");

    const tabUrl = tab.url || "";
    const isYT = tabUrl.includes("youtube.com") || tabUrl.includes("youtu.be");
    if (isYT && !tabUrl.includes("/playlist") && !(tabUrl.includes("/watch") && tabUrl.includes("list="))) {
      statusEl.dataset.state = "error";
      statusText.textContent = "Önce bir YouTube playlisti açın (oynatma listesi sayfası ya da listeli izleme).";
      return;
    }

    const script = isYT
      ? "scrape-youtube.js"
      : tabUrl.includes("instagram.com")
        ? "scrape-instagram.js"
        : "scrape.js";

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [script],
    });

    const raw = (injected && injected[0] && injected[0].result) || [];
    const items = Array.isArray(raw) ? raw : raw.items || [];
    const _debug = Array.isArray(raw) ? null : raw.debug;

    if (!items.length) {
      statusEl.dataset.state = "error";
      statusText.textContent = "Bu sayfada toplanacak kayıt bulunamadı. Lütfen yer imleri veya kaydedilenler sayfasında olduğunuzdan emin olun.";
      return;
    }

    // Uygulama kapalıysa istek hiç ulaşmaz: partiyi kuyruğa al, arka plan aktarıcıya bırak.
    let res = null;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ items }),
      });
    } catch {
      res = null;
    }

    if (!res) {
      const { added, total, dropped } = await enqueue(outboxStore, items);
      await refreshPending();
      statusEl.dataset.state = "info";
      statusText.textContent =
        `Arşiv kapalı: ${added} kayıt kuyruğa alındı (${total} bekliyor). Uygulamayı açtığınızda aktarılacak.` +
        (dropped > 0 ? ` Kuyruk tavanı aşıldı: ${dropped} eski kayıt düşürüldü.` : "");
      return;
    }

    if (res.status === 401) {
      throw new Error("Yetkilendirme hatası (401). Lütfen Ayarlar kısmından JointVault eşleşme anahtarını girin.");
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));

    const accepted = data.accepted != null ? data.accepted : items.length;
    statusEl.dataset.state = "ok";
    statusText.textContent = `Başarılı: ${accepted} içerik toplandı ve JointVault'a aktarıldı!`;
    // Uygulama ayakta: bekleyenleri de boşalt.
    void flushBacklog().then(refreshPending);
  } catch (e) {
    statusEl.dataset.state = "error";
    statusText.textContent = "Hata: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
  }
});

// Tarayıcıdan devralma: anahtar + uzantı listesi (IDM'in "File Types" ayarı).
(() => {
  const toggleEl = document.getElementById("capture-toggle");
  const extEl = document.getElementById("capture-ext");
  const badgeEl = document.getElementById("captureBadge");
  const lastEl = document.getElementById("captureLast");
  if (!toggleEl || !extEl) return;

  // Liste boş bırakılırsa arka plan varsayılan listeyi kullanır; burada
  // varsayılanlar TEKRAR EDİLMEZ (tek gerçek arka plandadır).
  const readStored = () =>
    new Promise((res) => chrome.storage.local.get({ capture: null, lastCapture: null }, res));

  const paintBadge = () => {
    const on = toggleEl.checked;
    if (badgeEl) {
      badgeEl.textContent = on ? "Açık" : "Kapalı";
      if (on) badgeEl.dataset.tone = "local";
      else delete badgeEl.dataset.tone;
    }
  };

  const paintLast = (last) => {
    if (!lastEl) return;
    if (!last) {
      lastEl.textContent = "Son devralınan: —";
      return;
    }
    const when = new Date(last.at || Date.now()).toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const state =
      last.outcome === "ok"
        ? "devralındı"
        : last.outcome === "offline"
          ? "uygulama kapalıydı"
          : "devredilemedi";
    lastEl.textContent = `Son devralınan: ${last.filename || last.url} · ${state} · ${when}`;
  };

  const save = () => {
    const extensions = extEl.value
      .split(",")
      .map((s) => s.trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    chrome.storage.local.set({ capture: { enabled: toggleEl.checked, extensions } });
    paintBadge();
  };

  void readStored().then((cfg) => {
    toggleEl.checked = cfg.capture ? cfg.capture.enabled !== false : true;
    extEl.value =
      cfg.capture && Array.isArray(cfg.capture.extensions) ? cfg.capture.extensions.join(", ") : "";
    paintBadge();
    paintLast(cfg.lastCapture);
  });

  toggleEl.addEventListener("change", save);
  extEl.addEventListener("change", save);
})();

// Sağ tık menüsü ayarları: her öğe ayrı açılıp kapatılabilir.
(() => {
  const badgeEl = document.getElementById("menuBadge");
  const cardEl = document.getElementById("menuCard");
  if (!cardEl) return;

  // Varsayılanlar arka plandadır (tek gerçek orada); burada yalnız anahtarlar.
  const KEYS = ["link", "image", "media", "selection", "pageAsk", "pageSilent", "batch"];
  const inputs = {};
  for (const key of KEYS) {
    const el = document.getElementById(`menu-${key}`);
    if (el) inputs[key] = el;
  }

  const paint = (menus) => {
    let on = 0;
    for (const key of KEYS) {
      const value = menus[key] !== false;
      if (inputs[key]) inputs[key].checked = value;
      if (value) on += 1;
    }
    if (badgeEl) badgeEl.textContent = `${on}/${KEYS.length}`;
  };

  const save = () => {
    const menus = {};
    for (const key of KEYS) menus[key] = inputs[key] ? inputs[key].checked : true;
    chrome.storage.local.set({ menus });
    paint(menus);
  };

  for (const key of KEYS) inputs[key]?.addEventListener("change", save);

  void chrome.storage.local
    .get({ menus: null })
    .then((cfg) => paint(cfg.menus || {}))
    .catch(() => paint({}));
})();

// Sayfadaki kaynaklar (koklama): sekme başına liste, panelin tam hâli.
(() => {
  const cardEl = document.getElementById("sniffCard");
  const listEl = document.getElementById("sniffList");
  const badgeEl = document.getElementById("sniffBadge");
  const hintEl = document.getElementById("sniffHint");
  const allBtn = document.getElementById("sniff-all");
  if (!cardEl || !listEl) return;

  const KIND_LABEL = {
    video: "Video",
    audio: "Ses",
    archive: "Arşiv",
    document: "Belge",
    program: "Program",
    other: "Dosya",
  };

  let tabId = null;
  let tabUrl = "";
  let items = [];

  const nameOf = (resource) => {
    try {
      const last = new URL(resource.url).pathname.split("/").filter(Boolean).pop() || "";
      return decodeURIComponent(last) || resource.url;
    } catch {
      return resource.url;
    }
  };

  const sizeOf = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  /** Devral: uygulama kabul ederse dosya çok kanallı motorla iner. */
  async function handOff(url, button) {
    if (button) button.disabled = true;
    let accepted = "rejected";
    try {
      const res = await chrome.runtime.sendMessage({
        type: "jv-handoff",
        url,
        referer: tabUrl,
      });
      if (res && res.outcome === "ok") accepted = "ok";
      else if (res && res.outcome === "offline") accepted = "offline";
    } catch {
      accepted = "offline";
    }
    if (button) {
      button.textContent =
        accepted === "ok" ? "Devralındı" : accepted === "offline" ? "Uygulama kapalı" : "Reddedildi";
      if (accepted === "ok") button.dataset.done = "ok";
      else button.disabled = false;
    }
    if (accepted === "offline") {
      statusEl.dataset.state = "error";
      statusText.textContent =
        "JointVault kapalı görünüyor: devralınan indirme başlatılamadı. Uygulamayı açıp tekrar dene.";
    } else if (accepted === "ok") {
      statusEl.dataset.state = "ok";
      statusText.textContent = `JointVault'a devredildi: ${nameOf({ url })}`;
    }
    return accepted;
  }

  function render() {
    cardEl.hidden = items.length === 0;
    badgeEl.textContent = String(items.length);
    allBtn.hidden = items.length < 2;
    hintEl.hidden = items.length > 0;
    listEl.replaceChildren();

    for (const item of items.slice().reverse()) {
      const li = document.createElement("li");
      const info = document.createElement("span");
      info.className = "sniff-info";
      const name = document.createElement("span");
      name.className = "sniff-name";
      name.textContent = nameOf(item);
      name.title = item.url;
      const meta = document.createElement("span");
      meta.className = "sniff-meta";
      meta.textContent = [KIND_LABEL[item.kind] || "Dosya", sizeOf(item.size)]
        .filter(Boolean)
        .join(" · ");
      info.append(name, meta);

      const go = document.createElement("button");
      go.className = "btn btn-outline btn-compact";
      go.type = "button";
      go.textContent = "Devral";
      go.addEventListener("click", () => void handOff(item.url, go));

      li.append(info, go);
      listEl.append(li);
    }
  }

  allBtn?.addEventListener("click", async () => {
    allBtn.disabled = true;
    for (const item of items) await handOff(item.url, null);
    allBtn.disabled = false;
  });

  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(async ([tab]) => {
      tabId = tab && typeof tab.id === "number" ? tab.id : null;
      tabUrl = (tab && tab.url) || "";
      if (tabId === null) return;
      const res = await chrome.runtime
        .sendMessage({ type: "jv-resources", tabId })
        .catch(() => null);
      items = (res && res.items) || [];
      render();
    })
    .catch(() => {
      cardEl.hidden = true;
    });
})();

// Çerezleri Aktar butonu
document.getElementById("sync-cookies")?.addEventListener("click", async () => {
  const btn = document.getElementById("sync-cookies");
  const endpoint = (endpointEl.value.trim() || DEFAULT_ENDPOINT).replace(/\/collect\/?$/, "/cookies");
  const token = tokenEl.value.trim();
  btn.disabled = true;
  statusEl.dataset.state = "busy";
  statusText.textContent = "Oturum çerezleri ayıklanıyor…";

  try {
    if (!chrome.cookies) {
      if (permBanner) permBanner.style.display = "flex";
      throw new Error("Yeni izinlerin etkinleşmesi için lütfen chrome://extensions sayfasından JointVault eklentisindeki Yenile butonuna bir kez tıklayın.");
    }

    const targets = [
      { url: "https://x.com", domain: "x.com" },
      { url: "https://twitter.com", domain: "twitter.com" },
      { url: "https://www.instagram.com", domain: "instagram.com" },
      { url: "https://www.youtube.com", domain: "youtube.com" },
    ];

    let lines = ["# Netscape HTTP Cookie File", "# Created by JointVault Extension", ""];
    const seen = new Set();
    let count = 0;

    for (const t of targets) {
      const byUrl = await chrome.cookies.getAll({ url: t.url }).catch(() => []);
      const byDomain = await chrome.cookies.getAll({ domain: t.domain }).catch(() => []);
      for (const c of [...byUrl, ...byDomain]) {
        const key = `${c.domain}|${c.name}|${c.path}`;
        if (!seen.has(key)) {
          seen.add(key);
          count++;
          const flag = c.domain.startsWith(".") ? "TRUE" : "FALSE";
          const secure = c.secure ? "TRUE" : "FALSE";
          const expires = c.expirationDate ? Math.round(c.expirationDate) : Math.round(Date.now() / 1000) + 86400 * 30;
          lines.push(`${c.domain}\t${flag}\t${c.path}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
        }
      }
    }

    if (count === 0) {
      throw new Error("Tarayıcınızda aktif X, Instagram veya YouTube oturumu/çerezi bulunamadı.");
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ content: lines.join("\n") }),
    });

    if (res.status === 401) {
      throw new Error("Yetkilendirme hatası (401). Lütfen Ayarlar kısmından JointVault eşleşme anahtarını girin.");
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || ("HTTP " + res.status));
    }

    statusEl.dataset.state = "ok";
    statusText.textContent = `Başarılı: ${count} çerez JointVault'a aktarıldı! Artık kilitlenme olmadan doğrudan tarama yapabilirsiniz.`;
  } catch (e) {
    statusEl.dataset.state = "error";
    statusText.textContent = "Hata: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
  }
});
