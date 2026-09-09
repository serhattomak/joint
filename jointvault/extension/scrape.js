// Adapter: detect-x + generic collect shape.
// IG/TikTok adapters slot in later by adding detect-<site>() returning the same item shape.
//
// Auto-scroll (ported from bookmark-manager): fixed-step scrollBy + jittered
// wait + re-collect into a status-id-keyed Map; stops after 4 zero-yield
// passes or 60 passes, then scrolls back to top. executeScript awaits the
// returned promise. Closing the popup mid-run cancels (POST lives in popup.js).
// ponytail: X DOM changes often; empty array + warn is the graceful fallback.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function collectInto(found) {
    const anchors = document.querySelectorAll('a[href*="/status/"]');
    for (const a of anchors) {
      // One tweet carries several /status/ anchors (timestamp, ?s=20, /photo/1…).
      const m = (a.getAttribute("href") || "").match(/\/status\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (found.has(id)) continue;
      const article = a.closest("article");
      const title = article ? article.innerText.slice(0, 200).trim() || undefined : undefined;
      // ponytail: first img in article (may be an avatar); smarter filter only if users complain.
      const img = article ? article.querySelector("img") : null;
      const thumbnail = img && img.src ? img.src : undefined;
      found.set(id, { url: `https://x.com/i/status/${id}`, title, thumbnail, site: "x" });
    }
  }

  return (async () => {
    const found = new Map();
    let empty = 0;
    for (let pass = 0; pass < 60; pass++) {
      const before = found.size;
      collectInto(found);
      empty = found.size === before ? empty + 1 : 0;
      if (empty >= 4) break;
      window.scrollBy(0, window.innerHeight * 3);
      await sleep(1200 + Math.random() * 900);
    }
    window.scrollTo(0, 0);
    if (!found.size) console.warn("[jointvault] no status links found, X DOM may have changed");
    return [...found.values()];
  })();
})();
