const state = {
  items: window.WIFI_DROP.items || [],
  adminToken: window.WIFI_DROP.adminToken,
  statusKey: "statusListening"
};

const i18n = window.WiFiDropI18n;
const feed = document.querySelector("#feed");
const statusEl = document.querySelector("#status");
const itemCount = document.querySelector("#item-count");
const qrEl = document.querySelector("#qr");
const qrBadge = document.querySelector("#qr-badge");
const urlEl = document.querySelector("#drop-url");
const copyLink = document.querySelector("#copy-link");
const regenerate = document.querySelector("#regenerate");
const openFolder = document.querySelector("#open-folder");

i18n.init(() => {
  render();
  setStatus(state.statusKey);
});
render();
window.setInterval(refreshItems, 1500);

copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(urlEl.textContent);
  copyLink.textContent = t("copied");
  flash("statusLinkCopied");
  window.setTimeout(() => {
    copyLink.textContent = t("copy");
  }, 1800);
});

openFolder.addEventListener("click", async () => {
  await fetch(`/api/open-folder?admin=${encodeURIComponent(state.adminToken)}`, { method: "POST" });
  flash("statusFolderOpened");
});

regenerate.addEventListener("click", async () => {
  regenerate.disabled = true;
  try {
    const res = await fetch(`/api/regenerate?admin=${encodeURIComponent(state.adminToken)}`, { method: "POST" });
    const data = await res.json();
    qrEl.src = data.qr;
    urlEl.textContent = data.dropUrl;
    showQrBadge();
    flash("statusQrActive");
  } finally {
    regenerate.disabled = false;
  }
});

async function refreshItems() {
  const res = await fetch(`/api/items?admin=${encodeURIComponent(state.adminToken)}`);
  if (!res.ok) return setStatus("statusPaused");
  const data = await res.json();
  const latest = data.items || [];
  if (JSON.stringify(latest) !== JSON.stringify(state.items)) {
    state.items = latest;
    render();
  }
  setStatus("statusListening");
}

function render() {
  itemCount.textContent = state.items.length === 0
    ? t("noItems")
    : t(state.items.length === 1 ? "oneItem" : "manyItems", { count: state.items.length });

  if (!state.items.length) {
    feed.innerHTML = `
      <article class="empty-state">
        <span class="empty-icon" aria-hidden="true"></span>
        <strong>${escapeHtml(t("emptyTitle"))}</strong>
        <p>${escapeHtml(t("emptyBody"))}</p>
      </article>
    `;
    return;
  }

  feed.innerHTML = state.items.map((item) => {
    const time = new Date(item.createdAt).toLocaleString(localeForCurrentLanguage(), {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    if (item.kind === "text") {
      return `
        <article class="received-row">
          <span class="row-thumb text-thumb">TXT</span>
          <div class="row-content">
            <strong>"${escapeHtml(item.text)}"</strong>
            <span>${escapeHtml(t("textMeta"))} · ${time} · ${escapeHtml(item.source || "iPhone")}</span>
          </div>
          <button class="small-button copy-text" data-text="${escapeAttr(item.text)}" type="button">${escapeHtml(t("copy"))}</button>
        </article>
      `;
    }

    const ext = extensionLabel(item.originalName);
    const isImage = /^image\//.test(item.mimeType || "");
    return `
      <article class="received-row">
        <span class="row-thumb ${isImage ? "image-thumb" : "file-thumb"}">${isImage ? "" : escapeHtml(ext)}</span>
        <div class="row-content">
          <strong>${escapeHtml(item.originalName)}</strong>
          <span>${formatBytes(item.size)} · ${time} · ${escapeHtml(item.source || "iPhone")}</span>
        </div>
        <a class="small-button download" href="/files/${item.id}?admin=${encodeURIComponent(state.adminToken)}">${escapeHtml(t("open"))}</a>
      </article>
    `;
  }).join("");

  for (const button of feed.querySelectorAll(".copy-text")) {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.text || "");
      button.textContent = t("copied");
      flash("statusTextCopied");
      window.setTimeout(() => {
        button.textContent = t("copy");
      }, 1600);
    });
  }
}

function showQrBadge() {
  qrBadge.hidden = false;
  window.clearTimeout(showQrBadge.timer);
  showQrBadge.timer = window.setTimeout(() => {
    qrBadge.hidden = true;
  }, 2600);
}

function flash(key) {
  setStatus(key);
  window.clearTimeout(flash.timer);
  flash.timer = window.setTimeout(() => {
    setStatus("statusListening");
  }, 1800);
}

function setStatus(key) {
  state.statusKey = key;
  statusEl.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span><span>${escapeHtml(t(key))}</span>`;
}

function extensionLabel(name) {
  const ext = String(name || "").split(".").pop();
  if (!ext || ext === name) return "FILE";
  return ext.slice(0, 4).toUpperCase();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function localeForCurrentLanguage() {
  return {
    it: "it-IT",
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    pt: "pt-PT",
    zh: "zh-CN",
    ja: "ja-JP",
    ko: "ko-KR"
  }[i18n.language] || "it-IT";
}

function t(key, params) {
  return i18n.t(key, params);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
