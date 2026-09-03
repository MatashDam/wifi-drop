const state = {
  items: window.WIFI_DROP.items || [],
  outbox: window.WIFI_DROP.outbox || [],
  devices: window.WIFI_DROP.devices || [],
  adminToken: window.WIFI_DROP.adminToken,
  statusKey: "statusListening"
};

const i18n = window.WiFiDropI18n;
const feed = document.querySelector("#feed");
const outboxFeed = document.querySelector("#outbox-feed");
const statusEl = document.querySelector("#status");
const itemCount = document.querySelector("#item-count");
const outboxCount = document.querySelector("#outbox-count");
const deviceFeed = document.querySelector("#device-feed");
const qrEl = document.querySelector("#qr");
const qrBadge = document.querySelector("#qr-badge");
const urlEl = document.querySelector("#drop-url");
const copyLink = document.querySelector("#copy-link");
const regenerate = document.querySelector("#regenerate");
const openFolder = document.querySelector("#open-folder");
const pcTextForm = document.querySelector("#pc-text-form");
const pcText = document.querySelector("#pc-text");
const pcSendText = document.querySelector("#pc-send-text");
const pcSendClipboard = document.querySelector("#pc-send-clipboard");
const pcFileForm = document.querySelector("#pc-file-form");
const pcFiles = document.querySelector("#pc-files");
const pcDropZone = document.querySelector("#pc-drop-zone");
const pcSelectedFilesEl = document.querySelector("#pc-selected-files");
const pcSendFiles = document.querySelector("#pc-send-files");

let pcSelectedFiles = [];

i18n.init(() => {
  render();
  renderPcSelectedFiles();
  setStatus(state.statusKey);
});
render();
renderPcSelectedFiles();
updatePcTextButton();
window.setInterval(refreshItems, 1500);
window.setInterval(refreshOutbox, 1500);
window.setInterval(refreshDevices, 3000);
refreshDevices();

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

pcText.addEventListener("input", updatePcTextButton);

pcSendClipboard.addEventListener("click", async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return flash("clipboardEmpty");
    if (!await sendTextToPhone(text)) return flash("pcTextSendFailed");
    flash("clipboardSent");
  } catch (_) {
    flash("clipboardFailed");
  }
});

pcTextForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = pcText.value.trim();
  if (!text) return flash("pcTextEmpty");

  pcSendText.disabled = true;
  pcSendText.textContent = t("sending");
  try {
    if (!await sendTextToPhone(text)) return flash("pcTextSendFailed");
    pcText.value = "";
    updatePcTextButton();
    flash("pcTextSent");
  } finally {
    updatePcTextButton();
  }
});

pcFiles.addEventListener("change", () => {
  pcSelectedFiles = pcSelectedFiles.concat(Array.from(pcFiles.files || []));
  pcFiles.value = "";
  renderPcSelectedFiles();
});

for (const eventName of ["dragenter", "dragover"]) {
  pcDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    pcDropZone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  pcDropZone.addEventListener(eventName, () => {
    pcDropZone.classList.remove("drag-over");
  });
}

pcDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  pcSelectedFiles = pcSelectedFiles.concat(files);
  renderPcSelectedFiles();
  flash("filesQueued");
});

pcSelectedFilesEl.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  if (!remove) return;
  pcSelectedFiles.splice(Number(remove.dataset.remove), 1);
  renderPcSelectedFiles();
});

pcFileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (pcSelectedFiles.length === 0) return flash("chooseAtLeastOne");

  const form = new FormData();
  for (const file of pcSelectedFiles) form.append("files", file);

  pcSendFiles.disabled = true;
  pcSendFiles.textContent = t("sending");
  try {
    const res = await fetch(`/api/outbox/upload?admin=${encodeURIComponent(state.adminToken)}`, {
      method: "POST",
      body: form
    });
    if (!res.ok) return flash("pcUploadFailed");
    pcSelectedFiles = [];
    renderPcSelectedFiles();
    await refreshOutbox();
    flash("pcFilesSent");
  } finally {
    pcSendFiles.disabled = false;
    updatePcFilesButton();
  }
});

async function refreshItems() {
  const res = await fetch(`/api/items?admin=${encodeURIComponent(state.adminToken)}`);
  if (!res.ok) return setStatus("statusPaused");
  const data = await res.json();
  const latest = data.items || [];
  if (JSON.stringify(latest) !== JSON.stringify(state.items)) {
    state.items = latest;
    renderReceived();
  }
  setStatus("statusListening");
}

async function refreshOutbox() {
  const res = await fetch(`/api/outbox?admin=${encodeURIComponent(state.adminToken)}`);
  if (!res.ok) return;
  const data = await res.json();
  const latest = data.items || [];
  if (JSON.stringify(latest) !== JSON.stringify(state.outbox)) {
    state.outbox = latest;
    renderOutbox();
  }
}

async function refreshDevices() {
  const res = await fetch(`/api/devices?admin=${encodeURIComponent(state.adminToken)}`);
  if (!res.ok) return;
  const data = await res.json();
  const latest = data.devices || [];
  if (JSON.stringify(latest) !== JSON.stringify(state.devices)) {
    state.devices = latest;
    renderDevices();
  }
}

async function sendTextToPhone(text) {
  const res = await fetch(`/api/outbox/text?admin=${encodeURIComponent(state.adminToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (res.ok) await refreshOutbox();
  return res.ok;
}

function render() {
  renderReceived();
  renderOutbox();
  renderDevices();
}

function renderReceived() {
  itemCount.textContent = state.items.length === 0
    ? t("noItems")
    : t(state.items.length === 1 ? "oneItem" : "manyItems", { count: state.items.length });

  if (!state.items.length) {
    feed.innerHTML = emptyMarkup(t("emptyTitle"), t("emptyBody"));
    return;
  }

  feed.innerHTML = state.items.map((item) => receivedRow(item, {
    fileHref: `/files/${item.id}?admin=${encodeURIComponent(state.adminToken)}`,
    showCopy: true
  })).join("");

  attachCopyHandlers(feed);
}

function renderOutbox() {
  outboxCount.textContent = state.outbox.length === 0
    ? t("noOutboxItems")
    : t(state.outbox.length === 1 ? "oneOutboxItem" : "manyOutboxItems", { count: state.outbox.length });

  if (!state.outbox.length) {
    outboxFeed.innerHTML = emptyMarkup(t("outboxEmptyTitle"), t("outboxEmptyBody"));
    return;
  }

  outboxFeed.innerHTML = state.outbox.map((item) => receivedRow(item, {
    fileHref: "",
    showCopy: false,
    meta: t("readyForIphone")
  })).join("");
}

function renderDevices() {
  if (!state.devices.length) {
    deviceFeed.innerHTML = `
      <article class="device-card empty-device">
        <span class="device-icon" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(t("deviceEmptyTitle"))}</strong>
          <p>${escapeHtml(t("deviceEmptyBody"))}</p>
        </div>
      </article>
    `;
    return;
  }

  deviceFeed.innerHTML = state.devices.map((device) => {
    const online = isDeviceOnline(device.lastSeen);
    return `
      <article class="device-card">
        <span class="device-icon" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(device.name || "iPhone")}</strong>
          <p>${escapeHtml(online ? t("deviceOnline") : t("deviceOffline"))}</p>
        </div>
        <button class="small-button" type="button" data-focus-text>${escapeHtml(t("focusText"))}</button>
        <button class="small-button" type="button" data-pick-files>${escapeHtml(t("pickFiles"))}</button>
      </article>
    `;
  }).join("");

  for (const button of deviceFeed.querySelectorAll("[data-focus-text]")) {
    button.addEventListener("click", () => pcText.focus());
  }
  for (const button of deviceFeed.querySelectorAll("[data-pick-files]")) {
    button.addEventListener("click", () => pcFiles.click());
  }
}

function receivedRow(item, options = {}) {
  const time = new Date(item.createdAt).toLocaleString(localeForCurrentLanguage(), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const meta = options.meta || `${item.kind === "text" ? t("textMeta") : formatBytes(item.size)} · ${time} · ${item.source || "iPhone"}`;

  if (item.kind === "text") {
    return `
      <article class="received-row">
        <span class="row-thumb text-thumb">TXT</span>
        <div class="row-content">
          <strong>"${escapeHtml(item.text)}"</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        ${options.showCopy ? `<button class="small-button copy-text" data-text="${escapeAttr(item.text)}" type="button">${escapeHtml(t("copy"))}</button>` : ""}
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
        <span>${escapeHtml(meta)}</span>
      </div>
      ${options.fileHref ? `<a class="small-button download" href="${options.fileHref}">${escapeHtml(t("open"))}</a>` : ""}
    </article>
  `;
}

function renderPcSelectedFiles() {
  pcSelectedFilesEl.hidden = pcSelectedFiles.length === 0;
  pcSelectedFilesEl.innerHTML = pcSelectedFiles.map((file, index) => `
    <div class="selected-row">
      <span class="row-icon ${file.type.startsWith("image/") ? "photo-icon" : "file-icon"}" aria-hidden="true"></span>
      <span>
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatBytes(file.size)}</small>
      </span>
      <button type="button" data-remove="${index}" aria-label="${escapeAttr(t("removeFile", { name: file.name }))}">${escapeHtml(t("remove"))}</button>
    </div>
  `).join("");
  updatePcFilesButton();
}

function updatePcTextButton() {
  pcSendText.disabled = pcText.value.trim().length === 0;
}

function updatePcFilesButton() {
  pcSendFiles.disabled = pcSelectedFiles.length === 0;
  if (pcSelectedFiles.length === 0) pcSendFiles.textContent = t("sendToIphoneFile");
  else if (pcSelectedFiles.length === 1) pcSendFiles.textContent = t("sendToIphoneOneFile");
  else pcSendFiles.textContent = t("sendToIphoneManyFiles", { count: pcSelectedFiles.length });
}

function isDeviceOnline(lastSeen) {
  const seen = new Date(lastSeen).getTime();
  return Number.isFinite(seen) && Date.now() - seen < 12000;
}

function attachCopyHandlers(root) {
  for (const button of root.querySelectorAll(".copy-text")) {
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

function emptyMarkup(title, body) {
  return `
    <article class="empty-state">
      <span class="empty-icon" aria-hidden="true"></span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </article>
  `;
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
