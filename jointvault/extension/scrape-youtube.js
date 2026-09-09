// Adapter: youtube-playlist. Same item shape + scroll-collect driver as scrape.js.
// Runs on youtube.com/playlist (and watch+list): rows carry full titles in DOM,
// thumbnails are synthesized (i.ytimg.com is stable, no DOM read needed).
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function collectInto(found, scope) {
    // SADECE seçili playlist kabı: yan öneriler ve ana akış dışarıda.
    const anchors = scope.querySelectorAll('a[href*="watch?v="]');
    for (const a of anchors) {
      const m = (a.getAttribute("href") || "").match(/[?&]v=([\w-]{11})/);
      if (!m) continue;
      const id = m[1];
      if (found.has(id)) continue;
      const row = a.closest("ytd-playlist-video-renderer, ytd-video-renderer, ytd-rich-item-renderer");
      const titleEl = row ? row.querySelector("#video-title") : null;
      const title =
        (titleEl && titleEl.innerText.trim().slice(0, 200)) ||
        (a.getAttribute("title") || "").trim().slice(0, 200) ||
        undefined;
      // ponytail: synthesized hqdefault instead of parsing lazy srcsets.
      found.set(id, {
        url: `https://www.youtube.com/watch?v=${id}`,
        title,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        site: "youtube",
      });
    }
  }

  return (async () => {
    const found = new Map();
    // YouTube gizli/kapalı kopyalar barındırabilir (yüksekliği 0 olanlar).
    // Gerçek kap = en büyük scrollHeight'lı playlist kökü; kaydırıcı =
    // içinde kaydırılabilir ilk düğüm, yoksa window.
    const roots = [
      ...document.querySelectorAll("ytd-playlist-panel-renderer"),
      ...document.querySelectorAll("ytd-playlist-video-list-renderer"),
    ];
    let scope = null;
    let bestH = 0;
    for (const el of roots) {
      if (el.scrollHeight > bestH) {
        bestH = el.scrollHeight;
        scope = el;
      }
    }
    // En sağlam tetikleme: son satırı görüntüye kaydır + scope'tan pencereye
    // kadar TÜM ataları dibe it. Hangi kap dinliyorsa o ateşler.
    const scrollStep = () => {
      const rows = scope.querySelectorAll('a[href*="watch?v="]');
      const last = rows[rows.length - 1];
      if (last) last.scrollIntoView({ block: "end" });
      else window.scrollBy(0, window.innerHeight * 3);
      let n = scope.parentElement;
      while (n && n !== document.body) {
        try {
          n.scrollTop = n.scrollHeight;
        } catch {
          /* kaydırılamayan düğüm — yoksay */
        }
        n = n.parentElement;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    };
    // Teşhis: erken durursa nedenini popup statüsünde gösterelim.
    const debug = {
      v: "yt-8",
      startHeight: scope ? scope.scrollHeight : 0,
      endHeight: 0,
      passes: 0,
      emptyHits: 0,
    };
    if (!scope) {
      console.warn("[jointvault] no playlist container found, page or DOM may have changed");
      return { items: [], debug };
    }
    let empty = 0;
    // Büyük listeler (600+ video) için tavan yüksek; küçüklerde boş-tur erken çıkar.
    // YT partiler halinde (~100'lük) ve gecikmeli yükler: bekleme uzun, tolerans yüksek.
    for (let pass = 0; pass < 200; pass++) {
      const before = found.size;
      collectInto(found, scope);
      empty = found.size === before ? empty + 1 : 0;
      debug.passes = pass + 1;
      debug.emptyHits = empty;
      if (empty >= 8) break;
      scrollStep();
      // Üretken turdan sonra parti yükleniyor olabilir (uzun bekle);
      // üst üste boşlarda sadece onayla (kısa) — kuyruk ~24sn değil ~9sn sürer.
      await sleep(empty === 0 ? 2500 + Math.random() * 1500 : 800);
    }
    window.scrollTo(0, 0);
    debug.endHeight = scope.scrollHeight;
    if (!found.size) console.warn("[jointvault] no video links found, YT DOM may have changed");
    return { items: [...found.values()], debug };
  })();
})();
