import sharp from 'sharp';
import { decodeImage, encodePipeline, outputFormatFor } from './image';
import type { AddWatermarkOptions, ImageInput } from './types';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeLabels(labels: string[] | undefined): string[] {
  const result = (labels && labels.length ? labels : ['WATERMARK'])
    .map((label) => String(label).trim())
    .filter(Boolean);
  if (!result.length) throw new Error('至少需要一个非空的水印标签。');
  return result;
}

function buildOverlay(
  imageWidth: number,
  imageHeight: number,
  labels: string[],
  options: AddWatermarkOptions
): Buffer {
  const base = Math.min(imageWidth, imageHeight);
  const fontSize = Math.max(11, Math.round(options.fontSize ?? base * 0.03));
  const fontWeight = options.fontWeight ?? 700;
  const padding = Math.max(
    6,
    Math.round(options.padding ?? Math.min(imageWidth, imageHeight) * 0.025)
  );
  const gap = Math.max(3, Math.round(options.gap ?? fontSize * 0.38));
  const hPadding = Math.max(8, Math.round(fontSize * 0.6));
  const height = Math.max(fontSize + 14, Math.round(fontSize * 1.88));
  const radius = Math.max(3, Math.round(options.borderRadius ?? height * 0.22));
  const backgroundColor = options.backgroundColor || '#e23e3e';
  const textColor = options.textColor || '#ffffff';
  const maxWidth = Math.max(40, imageWidth - padding * 2);

  let top = padding;
  const pieces: string[] = [];
  for (const label of labels) {
    const estimated = Math.round(label.length * fontSize * 0.7 + hPadding * 2);
    const width = Math.min(maxWidth, Math.max(height, estimated));
    pieces.push(
      `<rect x="${padding}" y="${top}" width="${width}" height="${height}" rx="${radius}" fill="${backgroundColor}"/>`,
      `<text x="${padding + width / 2}" y="${top + height * 0.68}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${textColor}">${escapeXml(label)}</text>`
    );
    top += height + gap;
  }

  return Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">${pieces.join('')}</svg>`
  );
}

/**
 * 在图片左上角添加一个或多个红底白字标签。
 */
export async function add(
  input: ImageInput,
  options: AddWatermarkOptions = {}
): Promise<Buffer> {
  const decoded = await decodeImage(input);
  const labels = normalizeLabels(options.labels);
  const overlay = buildOverlay(decoded.width, decoded.height, labels, options);
  const pipeline = sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels,
    },
  })
    .toColorspace('srgb')
    .composite([{ input: overlay, top: 0, left: 0 }]);

  return encodePipeline(
    pipeline,
    outputFormatFor(decoded.format, options.format),
    options.quality
  );
}
