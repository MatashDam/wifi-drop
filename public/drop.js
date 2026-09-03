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
const i18n = window.WiFiDropI18n;

let selectedFiles = [];

i18n.init(() => {
  updateTextButton();
  renderSelectedFiles();
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

textArea.addEventListener("input", updateTextButton);
updateTextButton();
renderSelectedFiles();

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

function t(key, params) {
  return i18n.t(key, params);
}
