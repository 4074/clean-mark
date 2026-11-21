'use strict';

/**
 * 左上角红色标签水印的识别与背景修复。
 *
 * 这里刻意不依赖任何图像处理原生库：传入 sharp 解出来的 RGB(A) 裸数据即可。
 * 这样算法可以单独用 node 脚本测试，也方便后续换成 worker_threads。
 */

const DEFAULTS = {
  // 水印只会出现在左上角，收窄搜索区域可以减少误判。
  searchWidthRatio: 0.52,
  searchHeightRatio: 0.34,
  minWidthRatio: 0.035,
  maxWidthRatio: 0.56,
  minHeightRatio: 0.01,
  maxHeightRatio: 0.16,
  minAspect: 1.35,
  maxAspect: 7,
  minRedDensity: 0.3,
  minWhiteRatio: 0.002,
  maxWhiteRatio: 0.42,
  minDarkRingRatio: 0.66,
  maxDarkRingMean: 70,
  maxCount: 4,
};

function isRedWatermarkPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 78) return false;
  if (r < 105) return false;

  const saturation = max === 0 ? 0 : (max - min) / max;
  return (
    r > g * 1.55 + 12 &&
    r > b * 1.55 + 12 &&
    g < 170 &&
    b < 170 &&
    saturation > 0.38
  );
}

function isNearWhite(r, g, b) {
  return r > 172 && g > 172 && b > 172 && Math.max(r, g, b) - Math.min(r, g, b) < 46;
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function dilateBinary(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) out[row + xx] = 1;
      }
    }
  }
  return out;
}

/**
 * 8 邻域连通域。返回每个域的面积与包围盒。
 */
function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  const neighbors = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      area++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let n = 0; n < neighbors.length; n++) {
        const next = index + neighbors[n];
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    components.push({
      area,
      minX,
      minY,
      maxX,
      maxY,
      centerX: sumX / area,
      centerY: sumY / area,
    });
  }

  return components;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 在候选框外围取一圈像素，判断是否是黑色背景。
 * 只统计接近中性色的暗像素，避免把标签的红色边缘算进来。
 */
function ringDarkness(data, width, height, channels, box, padding) {
  const x0 = Math.max(0, box.x0 - padding);
  const y0 = Math.max(0, box.y0 - padding);
  const x1 = Math.min(width - 1, box.x1 + padding);
  const y1 = Math.min(height - 1, box.y1 + padding);

  let count = 0;
  let dark = 0;
  let sum = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const inside =
        x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
      if (inside) continue;

      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      const value = luma(r, g, b);
      const neutral = max - min <= 40;
      // 背景必须是暗色。彩色产品/边缘不能算作黑色背景，
      // 但极暗的彩色像素（例如带轻微色偏的黑布）仍然放行。
      if (value < 58 && (neutral || value < 34)) dark++;
      sum += value;
      count++;
    }
  }

  if (count < 12) return { ratio: 0, mean: 255, count };
  return { ratio: dark / count, mean: sum / count, count };
}

function bboxStats(data, width, height, channels, box) {
  let red = 0;
  let white = 0;
  let total = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      total++;
      if (isRedWatermarkPixel(r, g, b)) red++;
      else if (isNearWhite(r, g, b)) white++;
    }
  }
  return {
    total,
    red,
    white,
    redDensity: total ? red / total : 0,
    whiteRatio: total ? white / total : 0,
  };
}

/**
 * 检测左上角的“红底白字”标签。
 * @param {Buffer|Uint8Array} data RGB 或 RGBA 像素
 * @returns {Array<{x0:number,y0:number,x1:number,y1:number,score:number}>}
 */
function detectWatermarks(data, width, height, channels, options = {}) {
  if (!width || !height || !data) return [];
  const cfg = { ...DEFAULTS, ...options };

  const searchW = Math.min(width, Math.max(1, Math.ceil(width * cfg.searchWidthRatio)));
  const searchH = Math.min(height, Math.max(1, Math.ceil(height * cfg.searchHeightRatio)));

  const redMask = new Uint8Array(width * height);
  for (let y = 0; y < searchH; y++) {
    for (let x = 0; x < searchW; x++) {
      const i = (y * width + x) * channels;
      if (isRedWatermarkPixel(data[i], data[i + 1], data[i + 2])) {
        redMask[y * width + x] = 1;
      }
    }
  }

  // 轻度膨胀可以连接被文字分割的红色区域，也能避免把一个标签识别成两块。
  const workMask = dilateBinary(redMask, width, height, 1);
  const components = connectedComponents(workMask, width, height);

  const candidates = [];
  for (const comp of components) {
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    if (bw < 24 || bh < 10) continue;

    const widthRatio = bw / width;
    const heightRatio = bh / height;
    const aspect = bw / bh;

    if (widthRatio < cfg.minWidthRatio || widthRatio > cfg.maxWidthRatio) continue;
    if (heightRatio < cfg.minHeightRatio || heightRatio > cfg.maxHeightRatio) continue;
    if (aspect < cfg.minAspect || aspect > cfg.maxAspect) continue;

    // 标签中心必须在左上区域。
    if (comp.centerX > width * 0.43 || comp.centerY > height * 0.24) continue;

    const stats = bboxStats(data, width, height, channels, {
      x0: comp.minX,
      y0: comp.minY,
      x1: comp.maxX,
      y1: comp.maxY,
    });

    if (stats.redDensity < cfg.minRedDensity) continue;
    if (stats.whiteRatio < cfg.minWhiteRatio || stats.whiteRatio > cfg.maxWhiteRatio) continue;

    const ring = ringDarkness(
      data,
      width,
      height,
      channels,
      { x0: comp.minX, y0: comp.minY, x1: comp.maxX, y1: comp.maxY },
      9
    );
    if (ring.count < 20 || ring.ratio < cfg.minDarkRingRatio) continue;
    if (ring.mean > cfg.maxDarkRingMean) continue;

    // 综合评分，主要用于排序和选择最可信的框。
    const score =
      stats.redDensity * 0.46 +
      Math.min(1, ring.ratio) * 0.28 +
      Math.min(1, stats.whiteRatio / 0.16) * 0.16 +
      (1 - Math.min(1, Math.abs(aspect - 3.25) / 4)) * 0.1;

    candidates.push({
      x0: comp.minX,
      y0: comp.minY,
      x1: comp.maxX,
      y1: comp.maxY,
      width: bw,
      height: bh,
      score: Math.round(score * 1000) / 1000,
      whiteRatio: Math.round(stats.whiteRatio * 1000) / 1000,
      redDensity: Math.round(stats.redDensity * 1000) / 1000,
      ringDarkRatio: Math.round(ring.ratio * 1000) / 1000,
    });
  }

  // 同一标签可能因为抗锯齿/文字而被拆成几个候选框，合并重叠框。
  candidates.sort((a, b) => b.score - a.score || a.y0 - b.y0);
  const merged = [];
  for (const candidate of candidates) {
    const duplicate = merged.some((other) => {
      const ix = Math.max(0, Math.min(candidate.x1, other.x1) - Math.max(candidate.x0, other.x0));
      const iy = Math.max(0, Math.min(candidate.y1, other.y1) - Math.max(candidate.y0, other.y0));
      const overlap = ix * iy;
      const smaller = Math.min(
        (candidate.x1 - candidate.x0 + 1) * (candidate.y1 - candidate.y0 + 1),
        (other.x1 - other.x0 + 1) * (other.y1 - other.y0 + 1)
      );
      return overlap > smaller * 0.4;
    });
    if (!duplicate) merged.push(candidate);
  }

  return merged
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .slice(0, cfg.maxCount)
    .map(({ score, whiteRatio, redDensity, ringDarkRatio, ...box }) => ({
      ...box,
      score,
      whiteRatio,
      redDensity,
      ringDarkRatio,
    }));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * 估算黑色背景的高频噪声强度，让修复区域不会看起来像一块“磨皮”过的塑料。
 */
function estimateNoiseSigma(data, width, height, channels, mask, boxes) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (const box of boxes) {
    minX = Math.min(minX, box.x0);
    minY = Math.min(minY, box.y0);
    maxX = Math.max(maxX, box.x1);
    maxY = Math.max(maxY, box.y1);
  }

  const ring = 18;
  const x0 = Math.max(1, minX - ring);
  const y0 = Math.max(1, minY - ring);
  const x1 = Math.min(width - 2, maxX + ring);
  const y1 = Math.min(height - 2, maxY + ring);

  const diffs = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const index = y * width + x;
      if (mask[index]) continue;
      const right = index + 1;
      const down = index + width;
      if (mask[right] || mask[down]) continue;

      const i = index * channels;
      const ir = right * channels;
      const id = down * channels;
      const center = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const r = (data[ir] + data[ir + 1] + data[ir + 2]) / 3;
      const d = (data[id] + data[id + 1] + data[id + 2]) / 3;
      diffs.push(Math.abs(center - r), Math.abs(center - d));
    }
  }

  if (diffs.length < 30) return 0.9;
  diffs.sort((a, b) => a - b);
  // 中位数绝对相邻差 ≈ 0.954 * sigma（对高斯噪声）
  const median = diffs[(diffs.length / 2) | 0];
  return clamp(median / 0.954, 0.35, 2.6);
}

/**
 * 修复水印区域。
 *
 * 思路：把标签（含抗锯齿边缘）扩张成矩形 mask，用四周真实背景做
 * 调和插值（Laplace inpaint），最后叠加从背景环带采样的细颗粒噪声。
 * 由于水印周围是纯黑背景，这种方式比模糊或直接涂黑更自然。
 */
function removeWatermarks(data, width, height, channels, watermarks, options = {}) {
  if (!watermarks || watermarks.length === 0) {
    return { removedPixels: 0, mask: null, boxes: [] };
  }

  const padding = options.padding == null ? 5 : options.padding;
  const mask = new Uint8Array(width * height);
  const boxes = [];

  for (const watermark of watermarks) {
    const box = {
      x0: clamp(Math.floor(watermark.x0) - padding, 0, width - 1),
      y0: clamp(Math.floor(watermark.y0) - padding, 0, height - 1),
      x1: clamp(Math.ceil(watermark.x1) + padding, 0, width - 1),
      y1: clamp(Math.ceil(watermark.y1) + padding, 0, height - 1),
    };
    if (box.x1 <= box.x0 || box.y1 <= box.y0) continue;
    boxes.push({ ...watermark, ...box });

    for (let y = box.y0; y <= box.y1; y++) {
      const row = y * width;
      for (let x = box.x0; x <= box.x1; x++) mask[row + x] = 1;
    }
  }

  if (boxes.length === 0) return { removedPixels: 0, mask: null, boxes: [] };

  const random = mulberry32(
    boxes.reduce((seed, box) => (seed * 31 + box.x0 * 17 + box.y0 * 13 + box.x1 + box.y1) >>> 0, 7)
  );

  // 1. 取所有标签外围的暗色中性像素，估算背景基色。
  const samples = [[], [], []];
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (const box of boxes) {
    minX = Math.min(minX, box.x0);
    minY = Math.min(minY, box.y0);
    maxX = Math.max(maxX, box.x1);
    maxY = Math.max(maxY, box.y1);
  }
  const pad = 26;
  for (let y = Math.max(0, minY - pad); y <= Math.min(height - 1, maxY + pad); y++) {
    for (let x = Math.max(0, minX - pad); x <= Math.min(width - 1, maxX + pad); x++) {
      const index = y * width + x;
      if (mask[index]) continue;
      const i = index * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 42 || luma(r, g, b) > 128) continue;
      samples[0].push(r);
      samples[1].push(g);
      samples[2].push(b);
    }
  }
  const base = samples.map((values) => {
    if (values.length === 0) return 0;
    values.sort((a, b) => a - b);
    return values[(values.length / 2) | 0];
  });

  const sigma = estimateNoiseSigma(data, width, height, channels, mask, boxes);

  // 2. 在独立的 Float32 缓冲区里求解拉普拉斯方程，避免 Buffer 写入时的取模回绕。
  //    mask 外的真实像素是固定边界，mask 内从背景基色开始扩散。
  const work = new Float32Array(data.length);
  work.set(data);
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const d = index * channels;
    work[d] = base[0];
    work[d + 1] = base[1];
    work[d + 2] = base[2];
  }

  const omega = 1.78;
  const solveX0 = Math.max(1, minX - 1);
  const solveY0 = Math.max(1, minY - 1);
  const solveX1 = Math.min(width - 2, maxX + 1);
  const solveY1 = Math.min(height - 2, maxY + 1);
  for (let iteration = 0; iteration < 140; iteration++) {
    for (let y = solveY0; y <= solveY1; y++) {
      const row = y * width;
      for (let x = solveX0; x <= solveX1; x++) {
        const index = row + x;
        if (!mask[index]) continue;

        const d = index * channels;
        const left = d - channels;
        const right = d + channels;
        const up = d - width * channels;
        const down = d + width * channels;

        for (let c = 0; c < 3; c++) {
          const next = (work[left + c] + work[right + c] + work[up + c] + work[down + c]) * 0.25;
          work[d + c] += (next - work[d + c]) * omega;
        }
      }
    }
  }

  // 3. 补上背景原本就有的细颗粒，再写回结果。
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const d = index * channels;
    const n = gaussianNoise(random) * sigma;
    data[d] = clamp(work[d] + n, 0, 255);
    data[d + 1] = clamp(work[d + 1] + n, 0, 255);
    data[d + 2] = clamp(work[d + 2] + n, 0, 255);
  }

  return { removedPixels: mask.reduce((sum, value) => sum + value, 0), mask, boxes };
}

module.exports = {
  DEFAULTS,
  detectWatermarks,
  removeWatermarks,
  isRedWatermarkPixel,
  isNearWhite,
};
