'use strict';

const api = window.cleanmark;
const $ = (id) => document.getElementById(id);

const state = {
  folderPath: null,
  folderName: '',
  outputDir: '',
  images: [],
  results: new Map(),
  infoCache: new Map(),
  rowMap: new Map(),
  selectedPath: null,
  processing: false,
  cancelling: false,
  completed: false,
  outputReady: false,
  lastSummary: null,
  cacheBust: Date.now(),
  comparePosition: 50,
  scanToken: 0,
  previewToken: 0,
};

const els = {
  emptyView: $('emptyView'),
  workspace: $('workspace'),
  dropzone: $('dropzone'),
  chooseFolderTop: $('chooseFolderTop'),
  themeLight: $('themeLight'),
  themeDark: $('themeDark'),
  dragOverlay: $('dragOverlay'),
  scanOverlay: $('scanOverlay'),
  folderName: $('folderName'),
  folderPath: $('folderPath'),
  statCount: $('statCount'),
  statDone: $('statDone'),
  statWatermarks: $('statWatermarks'),
  outputCard: $('outputCard'),
  outputName: $('outputName'),
  outputPath: $('outputPath'),
  progressBox: $('progressBox'),
  progressLabel: $('progressLabel'),
  progressPercent: $('progressPercent'),
  progressFill: $('progressFill'),
  processBtn: $('processBtn'),
  processBtnText: $('processBtnText'),
  cancelBtn: $('cancelBtn'),
  reselectBtn: $('reselectBtn'),
  runState: $('runState'),
  countChip: $('countChip'),
  listSummary: $('listSummary'),
  fileList: $('fileList'),
  listEmpty: $('listEmpty'),
  inspectorEmpty: $('inspectorEmpty'),
  inspectorContent: $('inspectorContent'),
  inspectName: $('inspectName'),
  inspectStatus: $('inspectStatus'),
  compareShell: $('compareShell'),
  compareFrame: $('compareFrame'),
  beforeImg: $('beforeImg'),
  afterImg: $('afterImg'),
  compareDivider: $('compareDivider'),
  tagBefore: $('tagBefore'),
  tagAfter: $('tagAfter'),
  compareControls: $('compareControls'),
  compareRange: $('compareRange'),
  previewLoading: $('previewLoading'),
  metaSize: $('metaSize'),
  metaDimensions: $('metaDimensions'),
  metaDetected: $('metaDetected'),
  metaDuration: $('metaDuration'),
  inspectError: $('inspectError'),
  inspectErrorText: $('inspectErrorText'),
  inspectOutput: $('inspectOutput'),
  inspectOutputPath: $('inspectOutputPath'),
  revealOutput: $('revealOutput'),
  toastStack: $('toastStack'),
};

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function friendlyError(error) {
  let message = error && error.message ? error.message : String(error || '未知错误');
  message = message.replace(/^Error invoking remote method '[^']+':\s*/, '');
  message = message.replace(/^Error:\s*/, '');
  return message;
}

function imageUrl(filePath, width, cacheKey) {
  const params = new URLSearchParams({
    path: filePath,
    w: String(width),
    v: String(cacheKey || '1'),
  });
  return `cleanimg://image/?${params.toString()}`;
}

function outputBaseName() {
  if (!state.outputDir) return '—';
  const parts = state.outputDir.split(/[\\/]/);
  return parts[parts.length - 1] || state.outputDir;
}

function resultFor(imagePath) {
  return state.results.get(imagePath) || null;
}

function statusView(result) {
  if (!result) return { className: 'pending', label: '待处理' };
  switch (result.status) {
    case 'processing':
      return { className: 'processing', label: '处理中' };
    case 'done':
      return {
        className: 'success',
        label: result.watermarks && result.watermarks.length ? `已去除 ${result.watermarks.length} 处` : '已去除',
      };
    case 'skipped':
      return { className: 'skipped', label: '无水印' };
    case 'error':
      return { className: 'error', label: '失败' };
    default:
      return { className: 'pending', label: '待处理' };
  }
}

function applyStatusPill(element, result) {
  const view = statusView(result);
  element.className = `status-pill ${view.className}`;
  element.textContent = view.label;
  element.title = view.label;
}

function toast(message, type = 'info', duration = 4200) {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' error' : ''}`;
  node.textContent = message;
  els.toastStack.appendChild(node);

  while (els.toastStack.children.length > 4) {
    els.toastStack.firstElementChild.remove();
  }

  window.setTimeout(() => {
    node.classList.add('out');
    window.setTimeout(() => node.remove(), 220);
  }, duration);
}

function revealLabel() {
  return api.platform === 'darwin' ? '在访达中显示' : '在文件夹中显示';
}

/* ------------------------------------------------------------------ */
/* Folder loading                                                      */
/* ------------------------------------------------------------------ */

async function chooseFolder() {
  if (state.processing) {
    toast('正在处理图片，请完成或取消后再切换文件夹。', 'error');
    return;
  }

  try {
    const folderPath = await api.chooseFolder();
    if (folderPath) await loadFolder(folderPath);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

async function loadFolder(folderPath) {
  if (state.processing) {
    toast('正在处理图片，请完成或取消后再切换文件夹。', 'error');
    return;
  }
  if (typeof folderPath !== 'string' || !folderPath.trim()) return;

  const token = ++state.scanToken;
  els.scanOverlay.hidden = false;
  const permissionHint = window.setTimeout(() => {
    if (token !== state.scanToken) return;
    toast(
      '如果 macOS 询问文件夹访问权限，请选择「允许」，否则读取会停在这里。',
      'error',
      8000
    );
  }, 8000);

  try {
    const data = await api.scanFolder(folderPath);
    if (token !== state.scanToken) return;

    state.folderPath = data.folderPath;
    state.folderName = data.folderName;
    state.outputDir = data.outputDir;
    state.images = Array.isArray(data.images) ? data.images : [];
    state.results.clear();
    state.infoCache.clear();
    state.selectedPath = state.images[0] ? state.images[0].path : null;
    state.processing = false;
    state.completed = false;
    state.outputReady = false;
    state.lastSummary = null;
    state.cacheBust = Date.now();
    state.comparePosition = 50;

    els.emptyView.hidden = true;
    els.workspace.hidden = false;
    els.folderName.textContent = state.folderName;
    els.folderPath.textContent = state.folderPath;
    els.folderPath.title = state.folderPath;
    els.outputName.textContent = outputBaseName();
    els.outputPath.textContent = '开始处理后创建';
    els.outputPath.title = state.outputDir;
    els.outputCard.disabled = true;
    els.revealOutput.textContent = revealLabel();

    renderList();
    updateAllStatusUi();
    renderInspector();

    if (state.images.length === 0) {
      toast('这个文件夹里没有找到支持的图片。');
    } else {
      const hasSubfolders = state.images.some((image) => image.relativePath.includes('/') || image.relativePath.includes('\\'));
      toast(`已读取 ${state.images.length} 张图片${hasSubfolders ? '（包含子文件夹）' : ''}。`);
    }
  } catch (error) {
    if (token === state.scanToken) toast(friendlyError(error), 'error');
  } finally {
    window.clearTimeout(permissionHint);
    if (token === state.scanToken) els.scanOverlay.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* File list                                                           */
/* ------------------------------------------------------------------ */

function renderList() {
  state.rowMap.clear();
  els.fileList.innerHTML = '';

  if (state.images.length === 0) {
    els.listEmpty.hidden = false;
    return;
  }
  els.listEmpty.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const image of state.images) {
    const result = resultFor(image.path);
    const view = statusView(result);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'file-row';
    row.dataset.path = image.path;
    row.setAttribute('role', 'listitem');
    if (state.selectedPath === image.path) row.classList.add('selected');
    if (result && result.status === 'error') row.classList.add('error-state');

    row.innerHTML = `
      <span class="file-thumb">
        <img src="${escapeHtml(imageUrl(image.path, 150, image.mtimeMs))}" alt="" loading="lazy" decoding="async" draggable="false" />
      </span>
      <span class="file-info">
        <span class="file-name">${escapeHtml(image.name)}</span>
        <span class="file-sub">
          <span>${formatBytes(image.size)}</span>
          <i></i>
          <span>${escapeHtml(image.extension.replace('.', '').toUpperCase())}</span>
        </span>
      </span>
      <span class="status-pill ${view.className}" title="${escapeHtml(view.label)}">${escapeHtml(view.label)}</span>
    `;

    row.addEventListener('click', () => selectImage(image.path));
    fragment.appendChild(row);
    state.rowMap.set(image.path, row);
  }

  els.fileList.appendChild(fragment);

  els.fileList.querySelectorAll('.file-thumb img').forEach((img) => {
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('loaded');
    } else {
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.addEventListener('error', () => img.closest('.file-thumb').classList.add('thumb-error'), { once: true });
    }
  });
}

function updateRowStatus(imagePath) {
  const row = state.rowMap.get(imagePath);
  if (!row) return;
  const result = resultFor(imagePath);
  const view = statusView(result);
  const pill = row.querySelector('.status-pill');
  if (pill) applyStatusPill(pill, result);
  row.classList.toggle('error-state', Boolean(result && result.status === 'error'));
}

function selectImage(imagePath) {
  if (state.selectedPath === imagePath) return;
  state.selectedPath = imagePath;

  state.rowMap.forEach((row, path) => {
    row.classList.toggle('selected', path === imagePath);
  });

  renderInspector();
}

/* ------------------------------------------------------------------ */
/* Inspector                                                           */
/* ------------------------------------------------------------------ */

function updateDimensionsCell() {
  const imagePath = state.selectedPath;
  if (!imagePath) {
    els.metaDimensions.textContent = '—';
    return;
  }

  const result = resultFor(imagePath);
  if (result && result.width && result.height) {
    els.metaDimensions.textContent = `${result.width} × ${result.height}`;
    return;
  }

  const info = state.infoCache.get(imagePath);
  if (info && info.width && info.height) {
    els.metaDimensions.textContent = `${info.width} × ${info.height}`;
    return;
  }

  els.metaDimensions.textContent = '读取中…';
  loadImageInfo(imagePath);
}

async function loadImageInfo(imagePath) {
  if (state.infoCache.has(imagePath)) return state.infoCache.get(imagePath);

  const promise = api
    .getImageInfo(imagePath)
    .then((info) => {
      state.infoCache.set(imagePath, info);
      return info;
    })
    .catch(() => {
      state.infoCache.set(imagePath, null);
      return null;
    });

  state.infoCache.set(imagePath, promise);
  const info = await promise;

  // 永久缓存结果，避免重复 IPC；如果当前选中的还是它，刷新尺寸。
  if (info) {
    state.infoCache.set(imagePath, info);
    if (state.selectedPath === imagePath) updateDimensionsCell();
  }
  return info;
}

function setImageSource(img, source, isPrimary) {
  const token = ++state.previewToken;
  img.classList.remove('loaded');
  img.dataset.source = source;

  return new Promise((resolve) => {
    const finish = (loaded) => {
      if (img.dataset.source !== source) return;
      if (loaded) img.classList.add('loaded');
      if (isPrimary && token === state.previewToken) {
        els.previewLoading.hidden = true;
      }
      resolve(loaded);
    };

    if (img.src === source && img.complete && img.naturalWidth > 0) {
      finish(true);
      return;
    }

    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = source;

    if (img.complete && img.naturalWidth > 0) finish(true);
  });
}

function applyComparePosition(position) {
  const clamped = Math.max(0, Math.min(100, Number(position) || 0));
  state.comparePosition = clamped;
  els.compareRange.value = String(clamped);
  els.beforeImg.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
  els.compareDivider.style.left = `${clamped}%`;
}

function renderInspector() {
  const image = state.images.find((item) => item.path === state.selectedPath);
  if (!image) {
    els.inspectorEmpty.hidden = false;
    els.inspectorContent.hidden = true;
    return;
  }

  els.inspectorEmpty.hidden = true;
  els.inspectorContent.hidden = false;
  els.inspectName.textContent = image.name;
  els.inspectName.title = image.relativePath;

  const result = resultFor(image.path);
  applyStatusPill(els.inspectStatus, result);

  const isDone = Boolean(result && result.status === 'done' && result.outputPath);
  const isSkipped = Boolean(result && result.status === 'skipped' && result.outputPath);
  const hasOutput = Boolean(result && result.outputPath && (isDone || isSkipped));
  const showCompare = isDone;

  els.previewLoading.hidden = false;
  const beforeSource = imageUrl(image.path, 1500, image.mtimeMs);
  const afterSource = hasOutput
    ? imageUrl(result.outputPath, 1500, isDone ? `${state.cacheBust}-${result.outputBytes || result.durationMs || 0}` : `${result.outputBytes || 0}`)
    : null;

  if (showCompare && afterSource) {
    els.afterImg.hidden = false;
    els.beforeImg.hidden = false;
    els.afterImg.style.clipPath = 'none';
    els.compareDivider.hidden = false;
    els.compareControls.hidden = false;
    els.tagBefore.hidden = false;
    els.tagAfter.hidden = false;
    els.compareFrame.classList.add('is-comparing');
    applyComparePosition(state.comparePosition);
    setImageSource(els.afterImg, afterSource, false);
    setImageSource(els.beforeImg, beforeSource, true);
  } else if (isSkipped && afterSource) {
    // 未发现水印时输出是原图副本，直接展示处理结果，避免无意义的对比。
    els.afterImg.hidden = false;
    els.beforeImg.hidden = true;
    els.beforeImg.style.clipPath = 'none';
    els.compareDivider.hidden = true;
    els.compareControls.hidden = true;
    els.tagBefore.hidden = true;
    els.tagAfter.hidden = true;
    els.compareFrame.classList.remove('is-comparing');
    setImageSource(els.afterImg, afterSource, true);
  } else {
    els.afterImg.hidden = true;
    els.beforeImg.hidden = false;
    els.beforeImg.style.clipPath = 'none';
    els.compareDivider.hidden = true;
    els.compareControls.hidden = true;
    els.tagBefore.hidden = true;
    els.tagAfter.hidden = true;
    els.compareFrame.classList.remove('is-comparing');
    setImageSource(els.beforeImg, beforeSource, true);
  }

  const sourceSize = result && result.originalBytes ? result.originalBytes : image.size;
  els.metaSize.textContent = formatBytes(sourceSize);
  updateDimensionsCell();

  if (!result) {
    els.metaDetected.textContent = '待处理';
    els.metaDuration.textContent = '—';
  } else if (result.status === 'processing') {
    els.metaDetected.textContent = '正在检测…';
    els.metaDuration.textContent = '—';
  } else if (result.status === 'done') {
    const count = result.watermarks ? result.watermarks.length : 0;
    els.metaDetected.textContent = count ? `去除 ${count} 处` : '已处理';
    els.metaDuration.textContent = formatDuration(result.durationMs);
  } else if (result.status === 'skipped') {
    els.metaDetected.textContent = '未发现水印';
    els.metaDuration.textContent = formatDuration(result.durationMs);
  } else if (result.status === 'error') {
    els.metaDetected.textContent = '处理失败';
    els.metaDuration.textContent = formatDuration(result.durationMs);
  }

  const isError = Boolean(result && result.status === 'error');
  els.inspectError.hidden = !isError;
  els.inspectErrorText.textContent = isError ? result.error || '未知错误' : '';

  els.inspectOutput.hidden = !hasOutput;
  if (hasOutput) {
    els.inspectOutputPath.textContent = result.outputPath;
    els.inspectOutputPath.title = result.outputPath;
    els.revealOutput.textContent = revealLabel();
  }
}

/* ------------------------------------------------------------------ */
/* Aggregate UI                                                        */
/* ------------------------------------------------------------------ */

function summarizeResults() {
  let completed = 0;
  let watermarks = 0;
  let errors = 0;
  for (const result of state.results.values()) {
    if (result.status === 'done' || result.status === 'skipped') completed++;
    if (result.status === 'error') errors++;
    if (result.status === 'done' && Array.isArray(result.watermarks)) {
      watermarks += result.watermarks.length;
    }
  }
  return { completed, watermarks, errors };
}

function updateRunState() {
  const { completed, errors } = summarizeResults();

  if (state.processing) {
    const total = state.images.length;
    els.runState.textContent = `处理中 ${completed}/${total}`;
    els.runState.className = 'run-state running';
    return;
  }

  if (state.completed) {
    if (state.lastSummary && state.lastSummary.cancelled) {
      els.runState.textContent = '已取消';
      els.runState.className = 'run-state warning';
    } else if (errors > 0) {
      els.runState.textContent = '部分完成';
      els.runState.className = 'run-state warning';
    } else {
      els.runState.textContent = '已完成';
      els.runState.className = 'run-state success';
    }
    return;
  }

  els.runState.textContent = '等待处理';
  els.runState.className = 'run-state';
}

function updateProgressUi(payload) {
  if (!payload || !payload.total) {
    els.progressBox.hidden = true;
    return;
  }

  els.progressBox.hidden = false;
  const finished = payload.phase === 'start' ? payload.index : payload.index + 1;
  const percent = Math.max(0, Math.min(100, Math.round((finished / payload.total) * 100)));
  els.progressLabel.textContent = `第 ${Math.min(payload.index + 1, payload.total)} / ${payload.total} 张`;
  els.progressPercent.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
}

function updateAllStatusUi() {
  const { completed, watermarks } = summarizeResults();

  els.statCount.textContent = String(state.images.length);
  els.statDone.textContent = String(completed);
  els.statWatermarks.textContent = String(watermarks);
  els.countChip.textContent = String(state.images.length);
  els.listSummary.textContent = state.images.length
    ? `${state.images.length} 个文件${completed ? ` · ${completed} 已完成` : ''}`
    : '0 个文件';

  updateRunState();

  const processDisabled = state.processing || state.images.length === 0;
  els.processBtn.disabled = processDisabled;
  els.processBtn.classList.toggle('busy', state.processing);
  els.cancelBtn.hidden = !state.processing;
  els.cancelBtn.disabled = Boolean(state.cancelling);
  els.cancelBtn.textContent = state.cancelling ? '正在停止…' : '取消处理';

  if (state.processing) {
    els.processBtnText.textContent = '正在处理…';
  } else if (state.completed) {
    els.processBtnText.textContent = '重新处理全部图片';
  } else {
    els.processBtnText.textContent = '开始去除水印';
  }

  els.outputCard.disabled = !state.outputReady;
  els.outputName.textContent = outputBaseName();
  if (state.outputReady) {
    els.outputPath.textContent = state.outputDir;
  } else {
    els.outputPath.textContent = state.outputDir ? '开始处理后创建' : '—';
  }
  els.outputPath.title = state.outputDir || '';

  if (!els.progressBox.hidden && !state.processing) {
    els.progressBox.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Processing                                                          */
/* ------------------------------------------------------------------ */

async function startProcessing() {
  if (state.processing || !state.folderPath || state.images.length === 0) return;

  state.processing = true;
  state.cancelling = false;
  state.completed = false;
  state.outputReady = false;
  state.lastSummary = null;
  state.results.clear();
  state.cacheBust = Date.now();

  renderList();
  updateAllStatusUi();
  renderInspector();

  els.progressBox.hidden = false;
  els.progressLabel.textContent = '准备中…';
  els.progressPercent.textContent = '0%';
  els.progressFill.style.width = '0%';

  try {
    const summary = await api.startProcessing(state.folderPath);
    state.lastSummary = summary;

    if (summary && Array.isArray(summary.items)) {
      for (const item of summary.items) {
        state.results.set(item.path, item);
      }
    }

    state.completed = true;
    state.outputReady = Boolean(summary && (summary.total > 0 || summary.completed > 0));
    state.cacheBust = Date.now();

    // 用最终结果校准一次列表，避免进度事件丢失导致状态不一致。
    renderList();
    updateAllStatusUi();
    if (state.selectedPath) renderInspector();

    if (!summary || summary.total === 0) {
      toast('这个文件夹里没有可处理的图片。');
    } else if (summary.cancelled) {
      toast(`已取消处理，已完成 ${summary.completed} 张。`);
    } else {
      const parts = [];
      parts.push(`${summary.watermarked} 张已去除水印`);
      if (summary.noWatermark > 0) parts.push(`${summary.noWatermark} 张未发现水印`);
      if (summary.failed > 0) parts.push(`${summary.failed} 张失败`);
      const seconds = (summary.durationMs / 1000).toFixed(1);
      toast(`处理完成：${parts.join('，')}。耗时 ${seconds} 秒。`, summary.failed > 0 ? 'error' : 'info', 6000);
    }
  } catch (error) {
    state.completed = false;
    for (const [imagePath, result] of state.results.entries()) {
      if (result.status === 'processing') state.results.delete(imagePath);
    }
    renderList();
    updateAllStatusUi();
    if (state.selectedPath) renderInspector();
    toast(friendlyError(error), 'error', 6000);
  } finally {
    state.processing = false;
    state.cancelling = false;
    els.progressBox.hidden = true;
    updateAllStatusUi();
    if (state.selectedPath) renderInspector();
  }
}

async function cancelProcessing() {
  if (!state.processing || state.cancelling) return;
  state.cancelling = true;
  updateAllStatusUi();
  try {
    await api.cancelProcessing();
  } catch (error) {
    state.cancelling = false;
    updateAllStatusUi();
    toast(friendlyError(error), 'error');
  }
}

function onProcessProgress(payload) {
  if (!payload || !payload.path) return;

  if (payload.phase === 'start') {
    state.results.set(payload.path, {
      status: 'processing',
      path: payload.path,
      relativePath: payload.relativePath,
      outputPath: payload.outputPath,
    });
    updateRowStatus(payload.path);
    updateProgressUi(payload);
    updateAllStatusUi();
    return;
  }

  state.results.set(payload.path, payload);
  updateRowStatus(payload.path);
  updateProgressUi(payload);
  updateAllStatusUi();

  if (state.selectedPath === payload.path) renderInspector();
}

/* ------------------------------------------------------------------ */
/* Output actions                                                      */
/* ------------------------------------------------------------------ */

async function openOutputFolder() {
  if (!state.folderPath || !state.outputReady) {
    if (!state.outputReady) toast('开始处理后会创建输出文件夹。');
    return;
  }
  try {
    await api.openOutputFolder(state.folderPath);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

async function revealSelectedOutput() {
  const result = resultFor(state.selectedPath);
  if (!result || !result.outputPath) {
    toast('这张图片还没有输出文件。');
    return;
  }
  try {
    await api.revealOutput(result.outputPath);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Drag & drop                                                         */
/* ------------------------------------------------------------------ */

let dragDepth = 0;

function hasFiles(event) {
  return Array.from(event.dataTransfer ? event.dataTransfer.types : []).includes('Files');
}

function showDragOverlay(show) {
  els.dragOverlay.hidden = !show;
}

function bindDragAndDrop() {
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    showDragOverlay(true);
  });

  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) showDragOverlay(false);
  });

  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    showDragOverlay(false);

    const files = Array.from(event.dataTransfer ? event.dataTransfer.files : []);
    if (files.length === 0) return;
    if (files.length > 1) {
      toast('一次只能读取一个文件夹。', 'error');
      return;
    }

    const droppedPath = api.getPathForFile(files[0]);
    if (!droppedPath) {
      toast('无法读取拖入的文件夹路径。', 'error');
      return;
    }
    await loadFolder(droppedPath);
  });
}

/* ------------------------------------------------------------------ */
/* Bindings & init                                                     */
/* ------------------------------------------------------------------ */

function syncThemeUi() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  els.themeLight.classList.toggle('active', theme === 'light');
  els.themeDark.classList.toggle('active', theme === 'dark');
  els.themeLight.setAttribute('aria-pressed', String(theme === 'light'));
  els.themeDark.setAttribute('aria-pressed', String(theme === 'dark'));
}

function bindThemeEvents() {
  syncThemeUi();
  els.themeLight.addEventListener('click', () => window.cleanmarkTheme.set('light'));
  els.themeDark.addEventListener('click', () => window.cleanmarkTheme.set('dark'));
  window.addEventListener('cleanmark:themechange', syncThemeUi);
}

function bindEvents() {
  $('chooseFolderTop').addEventListener('click', chooseFolder);
  els.reselectBtn.addEventListener('click', chooseFolder);
  els.dropzone.addEventListener('click', chooseFolder);

  els.processBtn.addEventListener('click', startProcessing);
  els.cancelBtn.addEventListener('click', cancelProcessing);
  els.outputCard.addEventListener('click', openOutputFolder);
  els.revealOutput.addEventListener('click', revealSelectedOutput);

  els.compareRange.addEventListener('input', (event) => {
    applyComparePosition(event.target.value);
  });

  api.onProgress(onProcessProgress);

  document.addEventListener('keydown', (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      chooseFolder();
      return;
    }
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      window.cleanmarkTheme.toggle();
      return;
    }
    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      if (!state.processing) startProcessing();
      return;
    }
    if (event.key === 'Escape' && state.processing) {
      event.preventDefault();
      cancelProcessing();
    }
  });

  bindDragAndDrop();
}

function init() {
  document.body.classList.add(`platform-${api.platform}`);
  els.revealOutput.textContent = revealLabel();
  bindThemeEvents();
  bindEvents();
}

init();
