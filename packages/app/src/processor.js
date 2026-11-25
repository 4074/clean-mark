'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { clean } = require('@cleanmark/lib');

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.avif',
]);

const FORMAT_BY_EXTENSION = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.jfif': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.avif': 'avif',
};

const OUTPUT_SUFFIX = '-transformed';

function isImageFile(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getOutputDirectory(folderPath) {
  const resolved = path.resolve(folderPath);
  const parsed = path.parse(resolved);
  return path.join(parsed.dir, `${parsed.name}${OUTPUT_SUFFIX}`);
}

function naturalCompare(a, b) {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

async function collectImageFiles(folderPath, baseFolder = folderPath, results = []) {
  const entries = await fsp.readdir(folderPath, { withFileTypes: true });
  entries.sort((a, b) => naturalCompare(a.name, b.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;

    const fullPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      await collectImageFiles(fullPath, baseFolder, results);
    } else if (entry.isFile() && isImageFile(fullPath)) {
      const stat = await fsp.stat(fullPath);
      const relativePath = path.relative(baseFolder, fullPath);
      results.push({
        path: fullPath,
        relativePath,
        name: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        format: FORMAT_BY_EXTENSION[path.extname(entry.name).toLowerCase()],
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return results;
}

async function scanFolder(folderPath) {
  const resolved = path.resolve(folderPath);
  const stat = await fsp.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error('请选择一个文件夹，而不是单个文件。');
  }

  const images = await collectImageFiles(resolved);
  return {
    folderPath: resolved,
    folderName: path.basename(resolved),
    outputDir: getOutputDirectory(resolved),
    images,
  };
}

/**
 * 读取图片 -> 交给 lib 检测并清除水印 -> 写入原格式结果。
 * 没有检测到水印时由 lib 原样返回 Buffer，这里直接复制原文件。
 */
async function transformImage(inputPath, outputPath, options = {}) {
  const startedAt = Date.now();
  const inputStat = await fsp.stat(inputPath);
  const inputBuffer = await fsp.readFile(inputPath);
  const format = options.format || FORMAT_BY_EXTENSION[path.extname(inputPath).toLowerCase()];

  const result = await clean(inputBuffer, {
    detection: options.detection,
    removal: options.removal,
    format,
    quality: options.quality,
  });

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  if (result.detected) {
    const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsp.writeFile(tempPath, result.data);
      await fsp.rename(tempPath, outputPath);
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  } else {
    // 没有水印时不重新编码，保留原始字节和元数据。
    await fsp.copyFile(inputPath, outputPath);
  }

  try {
    await fsp.utimes(outputPath, inputStat.atime, inputStat.mtime);
  } catch {
    // 修改时间只是锦上添花，失败不影响结果。
  }

  return {
    detected: result.detected,
    watermarks: result.watermarks,
    outputPath,
    width: result.width,
    height: result.height,
    outputBytes: result.detected ? result.data.length : inputStat.size,
    originalBytes: inputStat.size,
    durationMs: Date.now() - startedAt,
    format: result.format,
  };
}

/**
 * 批量处理. onProgress 会收到每一张图片的 processing / done / skipped / error.
 */
async function processFolder({ folderPath, outputDir, images, onProgress, signal, options = {} }) {
  const resolvedFolder = path.resolve(folderPath);
  const resolvedOutput = outputDir ? path.resolve(outputDir) : getOutputDirectory(resolvedFolder);
  const list = Array.isArray(images) && images.length > 0 ? images : (await scanFolder(resolvedFolder)).images;
  const startedAt = Date.now();

  await fsp.mkdir(resolvedOutput, { recursive: true });

  const summary = {
    total: list.length,
    completed: 0,
    watermarked: 0,
    noWatermark: 0,
    failed: 0,
    cancelled: false,
    outputDir: resolvedOutput,
    durationMs: 0,
    items: [],
    error: null,
  };

  for (let index = 0; index < list.length; index++) {
    if (signal && signal.aborted) {
      summary.cancelled = true;
      break;
    }

    const image = list[index];
    const relativePath = image.relativePath || path.basename(image.path);
    const outputPath = path.join(resolvedOutput, relativePath);

    if (onProgress) {
      onProgress({
        phase: 'start',
        index,
        total: list.length,
        path: image.path,
        relativePath,
        outputPath,
      });
    }

    try {
      const result = await transformImage(image.path, outputPath, {
        ...options,
        format: FORMAT_BY_EXTENSION[path.extname(image.path).toLowerCase()],
      });

      summary.completed++;
      if (result.detected) summary.watermarked++;
      else summary.noWatermark++;

      const item = {
        path: image.path,
        relativePath,
        outputPath,
        detected: result.detected,
        watermarks: result.watermarks,
        width: result.width,
        height: result.height,
        outputBytes: result.outputBytes,
        originalBytes: result.originalBytes,
        durationMs: result.durationMs,
        status: result.detected ? 'done' : 'skipped',
      };
      summary.items.push(item);

      if (onProgress) {
        onProgress({
          phase: result.detected ? 'done' : 'skipped',
          index,
          total: list.length,
          ...item,
        });
      }
    } catch (error) {
      summary.failed++;
      const item = {
        path: image.path,
        relativePath,
        outputPath,
        detected: false,
        watermarks: [],
        status: 'error',
        error: error && error.message ? error.message : String(error),
      };
      summary.items.push(item);

      if (onProgress) {
        onProgress({ phase: 'error', index, total: list.length, ...item });
      }
    }
  }

  summary.durationMs = Date.now() - startedAt;
  if (signal && signal.aborted) summary.cancelled = true;
  return summary;
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  FORMAT_BY_EXTENSION,
  OUTPUT_SUFFIX,
  isImageFile,
  getOutputDirectory,
  scanFolder,
  transformImage,
  processFolder,
};
