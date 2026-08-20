/* stemsplit Web UI — 画面まわりの処理(ライブラリ不使用) */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    config: null,
    files: [],
    selectedStems: new Set(),
    polling: new Map(),
  };

  // ---------------------------------------------------------------- 起動
  async function boot() {
    try {
      state.config = await (await fetch("/api/config")).json();
    } catch (err) {
      $("env-list").innerHTML = "<li>サーバーに接続できませんでした</li>";
      return;
    }
    renderModels();
    renderEnvironment();
    bindEvents();
    refreshJobs();
  }

  function renderModels() {
    const select = $("model");
    select.innerHTML = "";
    for (const model of state.config.models) {
      const option = document.createElement("option");
      option.value = model.name;
      option.textContent = `${model.name}（${model.stems.length}パート・品質 ${model.quality}）`
        + (model.available ? "" : " ※利用不可");
      option.disabled = !model.available;
      select.appendChild(option);
    }
    const usable = state.config.models.find((m) => m.name === state.config.defaults.model && m.available)
      || state.config.models.find((m) => m.available);
    if (usable) select.value = usable.name;
    $("format").value = state.config.defaults.format || "wav";
    onModelChange();
  }

  function currentModel() {
    return state.config.models.find((m) => m.name === $("model").value);
  }

  function onModelChange() {
    const model = currentModel();
    if (!model) return;
    $("model-hint").textContent = model.available
      ? model.description
      : `${model.description}\n→ ${model.reason}`;
    renderStemChips(model);
    $("hq").parentElement.hidden = model.engine !== "demucs";
  }

  function renderStemChips(model) {
    const container = $("stem-chips");
    container.innerHTML = "";
    const available = new Set(model.stems.map((s) => s.key));
    for (const stem of state.config.stems) {
      if (stem.key === "instrumental") continue;
      const chip = document.createElement("span");
      chip.className = "chip" + (available.has(stem.key) ? "" : " off");
      chip.textContent = stem.label;
      chip.title = stem.description;
      if (available.has(stem.key)) {
        if (state.selectedStems.has(stem.key)) chip.classList.add("on");
        chip.onclick = () => {
          chip.classList.toggle("on");
          if (chip.classList.contains("on")) state.selectedStems.add(stem.key);
          else state.selectedStems.delete(stem.key);
        };
      }
      container.appendChild(chip);
    }
    // モデルが出せないパートは選択から外す
    for (const key of [...state.selectedStems]) {
      if (!available.has(key)) state.selectedStems.delete(key);
    }
  }

  function renderEnvironment() {
    const caps = state.config.capabilities;
    const demucs = state.config.models.find((m) => m.engine === "demucs");
    const items = [
      `読み込める形式: <b>${caps.soundfile_formats.join(", ")}</b>`
        + (caps.ffmpeg ? "(ffmpeg あり → mp4/m4a/wma なども可)" : "(ffmpeg なし)"),
      `MP3 書き出し: <b>${caps.mp3_write ? "できます" : "できません"}</b>`,
      `高品質分離(Demucs): <b>${demucs && demucs.available ? "使えます" : "使えません"}</b>`
        + (demucs && !demucs.available ? `<br>${escapeHtml(demucs.reason.split("\n")[0])}` : ""),
    ];
    $("env-list").innerHTML = items.map((text) => `<li>${text}</li>`).join("");
  }

  // ------------------------------------------------------------ イベント
  function bindEvents() {
    const zone = $("dropzone");
    ["dragenter", "dragover"].forEach((name) =>
      zone.addEventListener(name, (event) => {
        event.preventDefault();
        zone.classList.add("hover");
      }));
    ["dragleave", "drop"].forEach((name) =>
      zone.addEventListener(name, (event) => {
        event.preventDefault();
        zone.classList.remove("hover");
      }));
    zone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
    $("file-input").addEventListener("change", (event) => addFiles(event.target.files));
    $("model").addEventListener("change", onModelChange);
    $("format").addEventListener("change", () => {
      $("bitrate-wrap").hidden = $("format").value !== "mp3";
    });
    $("start").addEventListener("click", startAll);
  }

  function addFiles(fileList) {
    state.files = [...fileList];
    const names = state.files.map((file) => file.name).join(" / ");
    $("queue-hint").textContent = state.files.length
      ? `${state.files.length} 曲を選択中: ${names}`
      : "";
    $("start").disabled = state.files.length === 0;
  }

  async function startAll() {
    const files = state.files;
    if (!files.length) return;
    $("start").disabled = true;
    for (const file of files) {
      try {
        await submit(file);
      } catch (err) {
        alert(`${file.name} の送信に失敗しました: ${err.message}`);
      }
    }
    state.files = [];
    $("file-input").value = "";
    $("queue-hint").textContent = "";
  }

  async function submit(file) {
    const options = {
      model: $("model").value,
      format: $("format").value,
      bitrate: Number($("bitrate").value),
      only: [...state.selectedStems],
      instrumental: $("instrumental").checked,
      shifts: $("hq").checked ? 2 : 0,
    };
    const form = new FormData();
    form.append("file", file);
    form.append("options", JSON.stringify(options));
    const response = await fetch("/api/jobs", { method: "POST", body: form });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "不明なエラー");
    upsertJob(job);
    poll(job.id);
  }

  // -------------------------------------------------------------- ジョブ
  async function refreshJobs() {
    try {
      const data = await (await fetch("/api/jobs")).json();
      for (const job of data.jobs.reverse()) {
        upsertJob(job);
        if (job.status === "queued" || job.status === "running") poll(job.id);
      }
    } catch (err) { /* 起動直後は無視 */ }
  }

  function poll(id) {
    if (state.polling.has(id)) return;
    const timer = setInterval(async () => {
      try {
        const job = await (await fetch(`/api/jobs/${id}`)).json();
        upsertJob(job);
        if (job.status === "done" || job.status === "error") {
          clearInterval(timer);
          state.polling.delete(id);
        }
      } catch (err) {
        clearInterval(timer);
        state.polling.delete(id);
      }
    }, 600);
    state.polling.set(id, timer);
  }

  function upsertJob(job) {
    $("jobs-panel").hidden = false;
    let node = document.getElementById(`job-${job.id}`);
    if (!node) {
      node = document.createElement("div");
      node.id = `job-${job.id}`;
      $("jobs").prepend(node);
    }
    node.className = `job ${job.status}`;
    node.innerHTML = renderJob(job);
  }

  function renderJob(job) {
    const percent = Math.round(job.fraction * 100);
    const stems = job.stems.map((stem) => `
      <div class="stem">
        <span class="stem-name">${escapeHtml(stem.label)}</span>
        <audio controls preload="none" src="${stem.url}"></audio>
        <a href="${stem.url}" download>保存 (${formatSize(stem.size)})</a>
      </div>`).join("");
    const actions = job.status === "done"
      ? `<div class="job-actions">
           <a class="button" href="/api/jobs/${job.id}/zip">まとめてZIPで保存</a>
         </div>`
      : "";
    const warnings = (job.warnings || [])
      .map((text) => `<p class="job-msg">! ${escapeHtml(text)}</p>`).join("");
    return `
      <div class="job-head">
        <span class="job-name">${escapeHtml(job.filename)}</span>
        <span class="job-meta">${escapeHtml(job.model)} / ${job.elapsed}秒</span>
      </div>
      <div class="bar"><span style="width:${percent}%"></span></div>
      <p class="job-msg ${job.status === "error" ? "error" : ""}">
        ${escapeHtml(job.error || job.message)}${job.status === "running" ? ` (${percent}%)` : ""}
      </p>
      ${warnings}${stems}${actions}`;
  }

  // ---------------------------------------------------------------- 補助
  function formatSize(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  boot();
})();
