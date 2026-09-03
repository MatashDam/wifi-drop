const state = {
  items: window.WIFI_DROP.items || [],
  adminToken: window.WIFI_DROP.adminToken
};

const feed = document.querySelector("#feed");
const statusEl = document.querySelector("#status");
const itemCount = document.querySelector("#item-count");
const qrEl = document.querySelector("#qr");
const qrBadge = document.querySelector("#qr-badge");
const urlEl = document.querySelector("#drop-url");
const copyLink = document.querySelector("#copy-link");
const regenerate = document.querySelector("#regenerate");
const openFolder = document.querySelector("#open-folder");

render();
window.setInterval(refreshItems, 1500);

copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(urlEl.textContent);
  copyLink.textContent = "Copiato";
  flash("Link copiato");
  window.setTimeout(() => {
    copyLink.textContent = "Copia";
  }, 1800);
});

openFolder.addEventListener("click", async () => {
  await fetch(`/api/open-folder?admin=${encodeURIComponent(state.adminToken)}`, { method: "POST" });
  flash("Cartella aperta");
});

regenerate.addEventListener("click", async () => {
  regenerate.disabled = true;
  try {
    const res = await fetch(`/api/regenerate?admin=${encodeURIComponent(state.adminToken)}`, { method: "POST" });
    const data = await res.json();
    qrEl.src = data.qr;
    urlEl.textContent = data.dropUrl;
    showQrBadge();
    flash("Nuovo QR attivo");
  } finally {
    regenerate.disabled = false;
  }
});

async function refreshItems() {
  const res = await fetch(`/api/items?admin=${encodeURIComponent(state.adminToken)}`);
  if (!res.ok) return setStatus("Connessione in pausa");
  const data = await res.json();
  const latest = data.items || [];
  if (JSON.stringify(latest) !== JSON.stringify(state.items)) {
    state.items = latest;
    render();
  }
  setStatus("In ascolto");
}

function render() {
  itemCount.textContent = state.items.length === 0
    ? "Nessun elemento"
    : `${state.items.length} ${state.items.length === 1 ? "elemento" : "elementi"}`;

  if (!state.items.length) {
    feed.innerHTML = `
      <article class="empty-state">
        <span class="empty-icon" aria-hidden="true"></span>
        <strong>Nessun elemento</strong>
        <p>Scansiona il QR con la fotocamera dell'iPhone: quello che invii appare qui.</p>
      </article>
    `;
    return;
  }

  feed.innerHTML = state.items.map((item) => {
    const time = new Date(item.createdAt).toLocaleString("it-IT", {
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
            <span>Testo · ${time} · ${escapeHtml(item.source || "iPhone")}</span>
          </div>
          <button class="small-button copy-text" data-text="${escapeAttr(item.text)}" type="button">Copia</button>
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
        <a class="small-button download" href="/files/${item.id}?admin=${encodeURIComponent(state.adminToken)}">Apri</a>
      </article>
    `;
  }).join("");

  for (const button of feed.querySelectorAll(".copy-text")) {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.text || "");
      button.textContent = "Copiato";
      flash("Testo copiato");
      window.setTimeout(() => {
        button.textContent = "Copia";
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

function flash(message) {
  setStatus(message);
  window.clearTimeout(flash.timer);
  flash.timer = window.setTimeout(() => {
    setStatus("In ascolto");
  }, 1800);
}

function setStatus(message) {
  statusEl.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
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
