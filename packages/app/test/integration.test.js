'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { processFolder } = require('../src/processor');

const fixtures = path.join(__dirname, '..', '..', 'lib', 'test', 'fixtures', 'images');

async function countRed(filePath) {
  const { data, info } = await sharp(filePath).toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let y = 0; y < Math.min(info.height, 400); y++) {
    for (let x = 0; x < Math.min(info.width, 500); x++) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 120 && r > g * 1.55 + 12 && r > b * 1.55 + 12) count++;
    }
  }
  return count;
}

async function main() {
  const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cleanmark-app-test-'));
  try {
    const summary = await processFolder({
      folderPath: fixtures,
      outputDir,
      images: [],
      onProgress: () => {},
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.watermarked, 2);
    assert.equal(summary.failed, 0);

    for (const item of summary.items) {
      assert.equal(item.status, 'done');
      assert.equal(item.watermarks.length, 2);
      assert.equal(await countRed(item.outputPath), 0, `${item.relativePath} 仍有红色残留`);
    }

    console.log('✓ app integration：processor 通过 @cleanmark/lib 清除两张图各 2 处水印');
  } finally {
    await fs.promises.rm(outputDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
