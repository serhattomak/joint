// Adapter: instagram-saved. Same item shape + scroll-collect driver as scrape.js.
// Runs on instagram.com/<user>/saved (thumbnail grid, no captions in DOM):
// title comes from img alt text (often empty) — app falls back to OG preview.
// Single pool: IG collection tabs are ignored, everything lands in review.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function collectInto(found) {
    const anchors = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    for (const a of anchors) {
      const m = (a.getAttribute("href") || "").match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      if (!m) continue;
      const key = `${m[1]}:${m[2]}`;
      if (found.has(key)) continue;
      // ponytail: grid thumb only; opening each post for captions is slow + ban-prone.
      const img = a.querySelector("img");
      const title = img && img.alt ? img.alt.trim().slice(0, 200) || undefined : undefined;
      // ponytail: img.src may be a small thumb; srcset parsing only if users complain.
      const thumbnail = img && img.src ? img.src : undefined;
      found.set(key, { url: `https://www.instagram.com/${m[1]}/${m[2]}/`, title, thumbnail, site: "instagram" });
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
    if (!found.size) console.warn("[jointvault] no post links found, IG DOM may have changed");
    return [...found.values()];
  })();
})();
