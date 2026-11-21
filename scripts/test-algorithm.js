'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { detectWatermarks, removeWatermarks, isRedWatermarkPixel } = require('../src/watermark');
const { getOutputDirectory, isImageFile } = require('../src/processor');

const root = path.resolve(__dirname, '..');

function countRed(data, width, height, channels, maxY = 500, maxX = 500) {
  let count = 0;
  for (let y = 0; y < Math.min(height, maxY); y++) {
    for (let x = 0; x < Math.min(width, maxX); x++) {
      const i = (y * width + x) * channels;
      if (isRedWatermarkPixel(data[i], data[i + 1], data[i + 2])) count++;
    }
  }
  return count;
}

async function loadRaw(filePath) {
  const { data, info } = await sharp(filePath)
    .rotate()
    .toColorspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

async function testProvidedImages() {
  const files = ['ALI35A.png', 'ALI36A+B.png'];
  for (const name of files) {
    const filePath = path.join(root, 'test', 'images', name);
    assert.ok(fs.existsSync(filePath), `缺少测试图片 ${name}`);
    const { data, info } = await loadRaw(filePath);
    const boxes = detectWatermarks(data, info.width, info.height, info.channels);
    assert.strictEqual(boxes.length, 2, `${name} 应识别到 2 个水印，实际 ${boxes.length}`);

    const beforeRed = countRed(data, info.width, info.height, info.channels);
    assert.ok(beforeRed > 1000, `${name} 原图应包含红色水印`);

    removeWatermarks(data, info.width, info.height, info.channels, boxes);
    const afterRed = countRed(data, info.width, info.height, info.channels);
    assert.strictEqual(afterRed, 0, `${name} 去除后左上角不应残留红色像素`);

    console.log(`✓ ${name}：识别 2 处水印，修补后无红色残留`);
  }
}

async function testSyntheticVariants() {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cleanmark-test-'));
  try {
    const width = 900;
    const height = 1200;

    const label = (color, widthPx, heightPx, fontSize, top = 30) => Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="28" y="${top}" width="${widthPx}" height="${heightPx}" rx="${heightPx * 0.22}" fill="${color}"/>
        <text x="${28 + widthPx / 2}" y="${top + heightPx * 0.68}" text-anchor="middle"
          font-family="Helvetica Neue, Arial" font-size="${fontSize}" font-weight="700"
          fill="#ffffff">ALI99A</text>
      </svg>
    `);

    const banner = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="20" y="25" width="600" height="48" rx="10" fill="#e23e3e"/>
        <text x="320" y="58" text-anchor="middle" font-family="Helvetica Neue, Arial"
          font-size="24" font-weight="700" fill="#ffffff">LONG BANNER</text>
      </svg>
    `);

    const productTag = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="120" cy="80" rx="90" ry="75" fill="#7a4a3a"/>
        <rect x="50" y="50" width="140" height="48" rx="10" fill="#e23e3e"/>
        <text x="120" y="83" text-anchor="middle" font-family="Helvetica Neue, Arial"
          font-size="24" font-weight="700" fill="#ffffff">TAG</text>
      </svg>
    `);

    const files = [
      { name: 'one.png', labels: [label('#e23e3e', 186, 64, 34)], expected: 1 },
      {
        name: 'two.png',
        labels: [label('#c0392b', 160, 56, 30, 30), label('#ff4d4d', 220, 76, 40, 106)],
        expected: 2,
      },
      { name: 'none.png', labels: [], expected: 0 },
      { name: 'banner.png', labels: [banner], expected: 0 },
      { name: 'product-tag.png', labels: [productTag], expected: 0 },
    ];

    for (const item of files) {
      const base = Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="#080808"/>
          <ellipse cx="520" cy="720" rx="250" ry="400" fill="#588a64" opacity=".2"/>
        </svg>
      `);
      const filePath = path.join(tempDir, item.name);
      await sharp(base)
        .composite(item.labels.map((input) => ({ input })))
        .png()
        .toFile(filePath);

      const { data, info } = await loadRaw(filePath);
      const boxes = detectWatermarks(data, info.width, info.height, info.channels);
      assert.strictEqual(boxes.length, item.expected, `${item.name} 水印数量不正确`);
      if (boxes.length > 0) {
        removeWatermarks(data, info.width, info.height, info.channels, boxes);
        assert.strictEqual(countRed(data, info.width, info.height, info.channels, 300, 400), 0);
      }
    }

    console.log('✓ 合成图片：单个、两个、零个水印均符合预期');
    console.log('✓ 负样本：超长横幅、非黑底标签不会被误判');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function testNamingAndFormats() {
  assert.strictEqual(
    getOutputDirectory('/tmp/product-photos'),
    path.join('/', 'tmp', 'product-photos-transformed')
  );
  assert.strictEqual(isImageFile('/tmp/a.JPG'), true);
  assert.strictEqual(isImageFile('/tmp/a.png'), true);
  assert.strictEqual(isImageFile('/tmp/a.txt'), false);
  console.log('✓ 输出目录命名与图片格式判断正确');
}

(async () => {
  await testProvidedImages();
  await testSyntheticVariants();
  await testNamingAndFormats();
  console.log('\n全部测试通过。');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
