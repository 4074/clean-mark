'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const sharp = require('sharp');
const { add, clean, has } = require('../dist');

const fixtures = path.join(__dirname, 'fixtures', 'images');
const redPixel = (r, g, b) => r > 120 && r > g * 1.55 + 12 && r > b * 1.55 + 12;

async function countRed(buffer, maxX = 500, maxY = 400) {
  const { data, info } = await sharp(buffer).toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let y = 0; y < Math.min(info.height, maxY); y++) {
    for (let x = 0; x < Math.min(info.width, maxX); x++) {
      const i = (y * info.width + x) * info.channels;
      if (redPixel(data[i], data[i + 1], data[i + 2])) count++;
    }
  }
  return count;
}

async function main() {
  const original = await fs.readFile(path.join(fixtures, 'ALI35A.png'));
  assert.equal(await has(original), true, '示例图应检测到水印');

  const result = await clean(original);
  assert.equal(result.detected, true);
  assert.equal(result.watermarks.length, 2);
  assert.equal(await countRed(result.data), 0, '清除后左上角不应残留红色');
  assert.equal(await has(result.data), false, '清除后不应再检测到水印');
  console.log('✓ has / clean：示例图识别到 2 处水印，清除后无残留');

  const second = await fs.readFile(path.join(fixtures, 'ALI36A+B.png'));
  const secondResult = await clean(second);
  assert.equal(secondResult.detected, true);
  assert.equal(secondResult.watermarks.length, 2);
  assert.equal(await countRed(secondResult.data), 0);
  console.log('✓ clean：第二张示例图同样通过');

  const cleanCanvas = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#080808' },
  }).png().toBuffer();
  assert.equal(await has(cleanCanvas), false);
  const untouched = await clean(cleanCanvas);
  assert.equal(untouched.detected, false);
  assert.equal(Buffer.compare(untouched.data, cleanCanvas), 0, '无水印时应原样返回 Buffer');
  console.log('✓ has / clean：无水印图片原样返回');

  const watermarked = await add(cleanCanvas, {
    labels: ['ALI99A', 'ALI99B'],
    fontSize: 34,
  });
  assert.equal(await has(watermarked), true, 'add 后应检测到水印');
  const cleaned = await clean(watermarked);
  assert.equal(cleaned.detected, true);
  assert.equal(cleaned.watermarks.length, 2);
  assert.equal(await countRed(cleaned.data), 0);
  assert.equal(await has(cleaned.data), false);
  console.log('✓ add / has / clean：添加双标签后可再次识别并清除');

  const jpeg = await sharp(cleanCanvas).jpeg().toBuffer();
  const jpegWatermarked = await add(jpeg, { labels: ['JPEG'], fontSize: 30 });
  assert.equal((await sharp(jpegWatermarked).metadata()).format, 'jpeg');
  assert.equal(await has(jpegWatermarked), true);
  console.log('✓ add：JPEG 输入保持 JPEG 输出');

  console.log('\n全部 lib 测试通过。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
