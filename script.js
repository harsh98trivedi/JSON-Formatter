(() => {
  const $ = (id) => document.getElementById(id);

  const input = $("json-input");
  const output = $("json-output");

  const btnFormat = $("btn-format");
  const btnCancel = $("btn-cancel");
  const btnCancelOverlay = $("btn-cancel-overlay");
  const btnCopy = $("btn-copy");
  const btnFile = $("btn-file");
  const fileInput = $("file-input");
  const btnUrl = $("btn-url");
  const btnClear = $("btn-clear");

  const progress = $("progress");
  const bar = $("bar");
  const stage = $("stage");
  const detail = $("detail");
  const toast = $("toast");

  const modal = $("modal");
  const urlInput = $("url-input");
  const urlLoad = $("url-load");
  const urlCancel = $("url-cancel");

  const stats = $("input-stats");
  const sourceInfo = $("source-info");

  let worker = new Worker("worker.js");
  let jobId = 0;
  let busy = false;
  let prettyText = "";

  worker.onmessage = (e) => {
    const { type, jobId: id } = e.data || {};
    if (id !== jobId) return;

    if (type === "progress") {
      showProgress(true, e.data.percent, e.data.stage, e.data.detail);
    } else if (type === "chunk") {
      // Use a fragment to minimize reflows
      const frag = document
        .createRange()
        .createContextualFragment(e.data.html + "\n");
      output.appendChild(frag);
    } else if (type === "done") {
      const { formatted, totalLines, ms } = e.data;
      prettyText = formatted;
      btnCopy.disabled = false;
      showProgress(false);
      busy = false;
      info(`Done in ${ms}ms • ${totalLines.toLocaleString()} lines`);
    } else if (type === "error") {
      showProgress(false);
      busy = false;
      error(`Invalid JSON: ${e.data.message}`);
    }
  };

  btnFormat.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) {
      error("Input is empty.");
      return;
    }
    runFormat(text);
  });

  const cancelJob = () => {
    jobId += 1; // invalidate current job
    showProgress(false);
    busy = false;
    info("Cancelled.");
  };
  btnCancel.addEventListener("click", cancelJob);
  btnCancelOverlay?.addEventListener("click", cancelJob);

  btnCopy.addEventListener("click", async () => {
    if (!prettyText) return;
    try {
      await navigator.clipboard.writeText(prettyText);
      flash(btnCopy, "✅ Copied!", "📋 Copy");
    } catch {
      error("Copy failed.");
    }
  });

  btnFile.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", onFilePicked);

  btnUrl.addEventListener("click", () => {
    urlInput.value = "";
    modal.classList.remove("hidden");
    urlInput.focus();
  });
  urlCancel.addEventListener("click", () => modal.classList.add("hidden"));
  urlLoad.addEventListener("click", loadFromUrl);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadFromUrl();
    else if (e.key === "Escape") modal.classList.add("hidden");
  });

  btnClear.addEventListener("click", () => {
    input.value = "";
    output.textContent = "";
    prettyText = "";
    btnCopy.disabled = true;
    sourceInfo.textContent = "";
    sourceInfo.title = "";
    updateStats();
    if (window.gsap) {
      gsap.fromTo(
        input,
        { backgroundColor: "#35171a" },
        { backgroundColor: "#0e172a", duration: 0.45 }
      );
    }
    input.focus();
  });

  input.addEventListener("input", updateStats);
  window.addEventListener("load", updateStats);

  function runFormat(text) {
    if (busy) return;
    busy = true;
    jobId += 1;
    btnCopy.disabled = true;
    output.innerHTML = "";
    showProgress(true, 8, "Starting…");
    worker.postMessage({ type: "format", jobId, text });
  }

  async function onFilePicked(ev) {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      input.value = text;

      const hint =
        f.webkitRelativePath && f.webkitRelativePath.length > 0
          ? f.webkitRelativePath
          : f.name;
      const sizeStr = formatBytes(f.size);
      const dateStr = new Date(f.lastModified).toLocaleString();

      sourceInfo.title = hint;
      sourceInfo.textContent = `File: ${hint} • ${sizeStr} • ${dateStr}`;
      updateStats();
    } catch {
      error("Unable to read file.");
    }
  }

  async function loadFromUrl() {
    const url = urlInput.value.trim();
    if (!url) return;

    modal.classList.add("hidden");
    try {
      showProgress(true, 5, "Fetching…");
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      input.value = text;

      const safeHref = encodeURI(url);
      const safeText = escapeHtml(url);
      sourceInfo.innerHTML = `URL: <a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
      sourceInfo.title = url;

      updateStats();
      showProgress(false);
    } catch (e) {
      showProgress(false);
      error(`Fetch failed: ${e.message}`);
    }
  }

  function escapeHtml(str) {
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024,
      sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
  }
  function updateStats() {
    const len = input.value.length;
    if (!len) {
      stats.textContent = "";
      return;
    }
    const kb = (len / 1024).toFixed(1);
    const lines = input.value.split("\n").length;
    stats.textContent = `${kb}KB • ${len.toLocaleString()} chars • ${lines.toLocaleString()} lines`;
  }
  function showProgress(on, percent = 0, msg = "", extra = "") {
    progress.classList.toggle("hidden", !on);
    btnCancel.classList.toggle("hidden", !on);
    btnFormat.disabled = on;
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    stage.textContent = msg || "Working…";
    detail.textContent = extra || "";
  }
  function error(msg) {
    toast.textContent = msg;
    toast.style.background = "#b91c1c";
    pop();
  }
  function info(msg) {
    toast.textContent = msg;
    toast.style.background = "#0f766e";
    pop(2200);
  }
  function pop(ms = 3200) {
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.opacity = "0";
    }, ms);
  }
  function flash(btn, tmp, orig) {
    const o = btn.textContent;
    btn.textContent = tmp;
    setTimeout(() => (btn.textContent = orig || o), 1200);
  }
})();
