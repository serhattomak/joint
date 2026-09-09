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

document.getElementById("collect").addEventListener("click", async () => {
  const btn = document.getElementById("collect");
  const endpoint = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  const token = tokenEl.value.trim();
  chrome.storage.local.set({ endpoint, token });
  btn.disabled = true;
  statusEl.textContent = "Scrolling page, collecting… (keep popup open, up to ~2 min)";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error("no active tab");
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["scrape.js"]
    });
    const items = (injected && injected[0] && injected[0].result) || [];
    if (!items.length) {
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
    statusEl.textContent = "OK: " + (data.accepted != null ? data.accepted : items.length) + " accepted";
  } catch (e) {
    statusEl.textContent = "Error: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
  }
});
