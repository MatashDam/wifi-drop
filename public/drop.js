const token = window.DROP_TOKEN;
const textForm = document.querySelector("#text-form");
const fileForm = document.querySelector("#file-form");
const statusEl = document.querySelector("#mobile-status");
const textArea = document.querySelector("#text");
const sendText = document.querySelector("#send-text");
const sendFiles = document.querySelector("#send-files");
const selectedFilesEl = document.querySelector("#selected-files");
const fileSources = document.querySelectorAll(".file-source");
const segments = document.querySelectorAll(".segment");
const panels = document.querySelectorAll(".mode-panel");
const phoneOutbox = document.querySelector("#phone-outbox");
const phoneOutboxCount = document.querySelector("#phone-outbox-count");
const i18n = window.WiFiDropI18n;

let selectedFiles = [];
let outbox = [];
const device = getDevice();

i18n.init(() => {
  updateTextButton();
  renderSelectedFiles();
  renderOutbox();
});

for (const segment of segments) {
  segment.addEventListener("click", () => setMode(segment.dataset.mode));
}

for (const input of fileSources) {
  input.addEventListener("change", () => {
    selectedFiles = selectedFiles.concat(Array.from(input.files || []));
    input.value = "";
    renderSelectedFiles();
  });
}

selectedFilesEl.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  if (!remove) return;
  selectedFiles.splice(Number(remove.dataset.remove), 1);
  renderSelectedFiles();
});

phoneOutbox.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-pc-text]");
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.copyPcText || "");
  button.textContent = t("copied");
  showToast(t("copiedFromPc"));
  window.setTimeout(() => {
    button.textContent = t("copy");
  }, 1600);
});

textArea.addEventListener("input", updateTextButton);
updateTextButton();
renderSelectedFiles();
refreshOutbox();
sendDeviceHello();
window.setInterval(refreshOutbox, 1500);
window.setInterval(sendDeviceHello, 4000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/public/sw.js").catch(() => {});
}

textForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = textArea.value.trim();
  if (!text) return showToast(t("textEmpty"), true);

  sendText.disabled = true;
  sendText.textContent = t("sending");
  showToast(t("textSending"));
  const res = await fetch(`/api/text/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  sendText.disabled = false;
  sendText.textContent = t("sendText");
  if (!res.ok) return showToast(t("textSendFailed"), true);
  textArea.value = "";
  updateTextButton();
  showToast(t("textSent"));
});

fileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (selectedFiles.length === 0) return showToast(t("chooseAtLeastOne"), true);

  const form = new FormData();
  for (const file of selectedFiles) form.append("files", file);

  sendFiles.disabled = true;
  sendFiles.textContent = t("sending");
  showToast(t("uploadSending"));
  const res = await fetch(`/api/upload/${encodeURIComponent(token)}`, {
    method: "POST",
    body: form
  });

  sendFiles.disabled = false;
  if (!res.ok) {
    updateFilesButton();
    return showToast(t("uploadFailed"), true);
  }

  selectedFiles = [];
  renderSelectedFiles();
  showToast(t("filesSent"));
});

async function refreshOutbox() {
  const res = await fetch(`/api/phone-outbox/${encodeURIComponent(token)}`);
  if (!res.ok) return;
  const data = await res.json();
  const latest = data.items || [];
  if (JSON.stringify(latest) !== JSON.stringify(outbox)) {
    outbox = latest;
    renderOutbox();
  }
}

async function sendDeviceHello() {
  await fetch(`/api/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: device.id,
      name: device.name,
      userAgent: navigator.userAgent
    })
  }).catch(() => {});
}

function setMode(mode) {
  for (const segment of segments) {
    const active = segment.dataset.mode === mode;
    segment.classList.toggle("active", active);
    segment.setAttribute("aria-selected", String(active));
  }

  for (const panel of panels) {
    panel.hidden = panel.dataset.panel !== mode;
  }
}

function renderSelectedFiles() {
  selectedFilesEl.hidden = selectedFiles.length === 0;
  selectedFilesEl.innerHTML = selectedFiles.map((file, index) => `
    <div class="selected-row">
      <span class="row-icon ${file.type.startsWith("image/") ? "photo-icon" : "file-icon"}" aria-hidden="true"></span>
      <span>
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatBytes(file.size)}</small>
      </span>
      <button type="button" data-remove="${index}" aria-label="${escapeAttr(t("removeFile", { name: file.name }))}">${escapeHtml(t("remove"))}</button>
    </div>
  `).join("");
  updateFilesButton();
}

function renderOutbox() {
  phoneOutboxCount.textContent = outbox.length === 0
    ? t("phoneInboxEmpty")
    : t(outbox.length === 1 ? "phoneInboxOne" : "phoneInboxMany", { count: outbox.length });

  if (!outbox.length) {
    phoneOutbox.innerHTML = `
      <article class="empty-state">
        <span class="empty-icon" aria-hidden="true"></span>
        <strong>${escapeHtml(t("phoneInboxEmpty"))}</strong>
        <p>${escapeHtml(t("phoneInboxEmptyBody"))}</p>
      </article>
    `;
    return;
  }

  phoneOutbox.innerHTML = outbox.map((item) => {
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
            <span>${escapeHtml(t("sentFromPc"))} · ${time}</span>
          </div>
          <button class="small-button" data-copy-pc-text="${escapeAttr(item.text)}" type="button">${escapeHtml(t("copy"))}</button>
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
          <span>${formatBytes(item.size)} · ${time}</span>
        </div>
        <a class="small-button download" href="/outbox-files/${encodeURIComponent(token)}/${encodeURIComponent(item.id)}">${escapeHtml(t("open"))}</a>
      </article>
    `;
  }).join("");
}

function updateTextButton() {
  sendText.disabled = textArea.value.trim().length === 0;
}

function updateFilesButton() {
  sendFiles.disabled = selectedFiles.length === 0;
  if (selectedFiles.length === 0) sendFiles.textContent = t("sendFile");
  else if (selectedFiles.length === 1) sendFiles.textContent = t("sendOneFile");
  else sendFiles.textContent = t("sendManyFiles", { count: selectedFiles.length });
}

function showToast(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    statusEl.hidden = true;
    statusEl.classList.remove("error");
  }, 2400);
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

function t(key, params) {
  return i18n.t(key, params);
}

function getDevice() {
  const id = readSaved("wifi-drop-device-id") || makeDeviceId();
  saveValue("wifi-drop-device-id", id);
  return {
    id,
    name: readSaved("wifi-drop-device-name") || defaultDeviceName()
  };
}

function defaultDeviceName() {
  const ua = navigator.userAgent || "";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  return "Phone";
}

function readSaved(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function saveValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_) {}
}

function makeDeviceId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
