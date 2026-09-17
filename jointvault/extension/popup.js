const DEFAULT_ENDPOINT = "http://127.0.0.1:48120/collect";
const endpointEl = document.getElementById("endpoint");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");
const permBanner = document.getElementById("permBanner");
const serverDot = document.getElementById("serverDot");
const serverStatusText = document.getElementById("serverStatusText");

// Load stored settings
chrome.storage.local.get(
  { endpoint: DEFAULT_ENDPOINT, token: "" },
  (cfg) => {
    endpointEl.value = cfg.endpoint;
    tokenEl.value = cfg.token;
    checkServerConnection(cfg.endpoint);
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
      serverStatusText.textContent = "Kasa Bağlı";
    } else {
      serverDot.classList.remove("online");
      serverStatusText.textContent = "Kasa Kapalı";
    }
  } catch {
    serverDot.classList.remove("online");
    serverStatusText.textContent = "Kasa Kapalı";
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
      badgeEl.textContent = "▶";
      badgeEl.style.color = "#ef4444";
      badgeEl.style.borderColor = "rgba(239, 68, 68, 0.3)";
      if (url.includes("/playlist") || url.includes("list=")) {
        nameEl.textContent = "YouTube - Oynatma Listesi";
        hintEl.textContent = "Topla'ya basarak listeyi JointVault'a aktarın.";
      } else {
        nameEl.textContent = "YouTube";
        hintEl.textContent = "Tekil videoyu aşağıdan indirebilir veya playlist açabilirsiniz.";
      }
    } else if (url.includes("instagram.com")) {
      badgeEl.textContent = "IG";
      badgeEl.style.color = "#ec4899";
      badgeEl.style.borderColor = "rgba(236, 72, 153, 0.3)";
      if (url.includes("/saved")) {
        nameEl.textContent = "Instagram - Kaydedilenler";
        hintEl.textContent = "Topla'ya basarak tüm kaydedilenleri çekin.";
      } else {
        nameEl.textContent = "Instagram";
        hintEl.textContent = "Kaydedilenler sayfasını açıp Topla'ya basın.";
      }
    } else if (url.includes("x.com") || url.includes("twitter.com")) {
      badgeEl.textContent = "𝕏";
      badgeEl.style.color = "#f3f4f6";
      badgeEl.style.borderColor = "rgba(255, 255, 255, 0.25)";
      if (url.includes("/bookmarks") || url.includes("/i/bookmarks")) {
        nameEl.textContent = "X (Twitter) - Yer İmleri";
        hintEl.textContent = "Topla'ya basarak tüm yer imlerini çekin.";
      } else {
        nameEl.textContent = "X (Twitter)";
        hintEl.textContent = "Yer imleri sayfasını (/i/bookmarks) açıp Topla'ya basın.";
      }
    } else {
      badgeEl.textContent = "🌐";
      badgeEl.style.color = "#9ca3af";
      badgeEl.style.borderColor = "var(--border)";
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
    badgeEl.style.color = "#34d399";
    badgeEl.style.background = "rgba(16, 185, 129, 0.15)";
    btn.disabled = false;
    hintEl.textContent = "Bu sayfadaki medya içeriği algılandı. Doğrudan Kasa'ya indirebilirsiniz.";

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
    statusEl.textContent = "İçerik Kasa'ya aktarılıyor…";
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
      statusEl.textContent = "✅ Başarılı: İçerik Kasa'ya alındı ve indirme başlatıldı!";
    } catch (e) {
      statusEl.dataset.state = "error";
      statusEl.textContent = "Hata: " + (e && e.message ? e.message : e);
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
  statusEl.textContent = "Sayfa taranıyor ve kaydırılıyor… (Pencereyi açık tutun)";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error("Aktif sekme bulunamadı.");

    const tabUrl = tab.url || "";
    const isYT = tabUrl.includes("youtube.com") || tabUrl.includes("youtu.be");
    if (isYT && !tabUrl.includes("/playlist") && !(tabUrl.includes("/watch") && tabUrl.includes("list="))) {
      statusEl.dataset.state = "error";
      statusEl.textContent = "Önce bir YouTube playlisti açın (oynatma listesi sayfası ya da listeli izleme).";
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
    const debug = Array.isArray(raw) ? null : raw.debug;

    if (!items.length) {
      statusEl.dataset.state = "error";
      statusEl.textContent = "Bu sayfada toplanacak kayıt bulunamadı. Lütfen yer imleri veya kaydedilenler sayfasında olduğunuzdan emin olun.";
      return;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ items }),
    });

    if (res.status === 401) {
      throw new Error("Yetkilendirme hatası (401). Lütfen Ayarlar kısmından JointVault eşleşme anahtarını girin.");
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));

    const accepted = data.accepted != null ? data.accepted : items.length;
    statusEl.dataset.state = "ok";
    statusEl.textContent = `✅ Başarılı: ${accepted} içerik toplandı ve JointVault'a aktarıldı!`;
  } catch (e) {
    statusEl.dataset.state = "error";
    statusEl.textContent = "Hata: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
  }
});

// Çerezleri Aktar butonu
document.getElementById("sync-cookies")?.addEventListener("click", async () => {
  const btn = document.getElementById("sync-cookies");
  const endpoint = (endpointEl.value.trim() || DEFAULT_ENDPOINT).replace(/\/collect\/?$/, "/cookies");
  const token = tokenEl.value.trim();
  btn.disabled = true;
  statusEl.dataset.state = "busy";
  statusEl.textContent = "Oturum çerezleri ayıklanıyor…";

  try {
    if (!chrome.cookies) {
      if (permBanner) permBanner.style.display = "flex";
      throw new Error("Yeni izinlerin etkinleşmesi için lütfen chrome://extensions sayfasından JointVault eklentisindeki 🔄 (Yenile) butonuna bir kez tıklayın.");
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
    statusEl.textContent = `✅ Başarılı: ${count} çerez JointVault'a aktarıldı! Artık kilitlenme olmadan doğrudan tarama yapabilirsiniz.`;
  } catch (e) {
    statusEl.dataset.state = "error";
    statusEl.textContent = "Hata: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
  }
});
