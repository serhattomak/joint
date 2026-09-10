// JointVault background: content script'ten gelen fetch isteklerini
// extension origin'inde çalıştırır (CORS/preflight sorunlarını aşar).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "jv-fetch") return;
  (async () => {
    try {
      const res = await fetch(msg.url, msg.options || {});
      const data = await res.json().catch(() => ({}));
      sendResponse({ ok: res.ok, status: res.status, data });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
  return true; // async sendResponse
});