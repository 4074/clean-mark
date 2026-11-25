import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import type { ImageFormat, ImageInput } from './types';

const FORMAT_MAP: Record<string, ImageFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  tif: 'tiff',
  tiff: 'tiff',
  avif: 'avif',
};

export type PixelChannels = 3 | 4;

export interface DecodedImage {
  inputBuffer: Buffer;
  data: Uint8Array;
  width: number;
  height: number;
  channels: PixelChannels;
  format: ImageFormat;
}

export function normalizeFormat(value?: string | null): ImageFormat | null {
  if (!value) return null;
  return FORMAT_MAP[value.toLowerCase()] || null;
}

export async function coerceInput(input: ImageInput): Promise<Buffer> {
  if (typeof input === 'string') return fs.readFile(input);
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('图片输入必须是文件路径、Buffer 或 Uint8Array。');
}

export async function decodeImage(input: ImageInput): Promise<DecodedImage> {
  const inputBuffer = await coerceInput(input);
  const meta = await sharp(inputBuffer, { failOn: 'none', animated: false }).metadata();
  const { data, info } = await sharp(inputBuffer, { failOn: 'none', animated: false })
    .rotate()
    .toColorspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height || (info.channels !== 3 && info.channels !== 4)) {
    throw new Error('不支持的图片像素格式。');
  }

  return {
    inputBuffer,
    data,
    width: info.width,
    height: info.height,
    channels: info.channels as PixelChannels,
    format: normalizeFormat(meta.format) || 'png',
  };
}

export function encodePipeline(
  pipeline: Sharp,
  format: ImageFormat,
  quality?: number
): Promise<Buffer> {
  switch (format) {
    case 'png':
      return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    case 'webp':
      return pipeline.webp({ quality: quality ?? 95, effort: 4 }).toBuffer();
    case 'tiff':
      return pipeline.tiff({ quality: quality ?? 95, compression: 'lzw' }).toBuffer();
    case 'avif':
      return pipeline.avif({ quality: quality ?? 68, effort: 4 }).toBuffer();
    case 'jpeg':
    default: {
      const output = pipeline.removeAlpha();
      return output
        .jpeg({ quality: quality ?? 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
    }
  }
}

export function encodeRaw(
  data: Uint8Array,
  width: number,
  height: number,
  channels: PixelChannels,
  format: ImageFormat,
  quality?: number
): Promise<Buffer> {
  const pipeline = sharp(data, { raw: { width, height, channels } }).toColorspace('srgb');
  return encodePipeline(pipeline, format, quality);
}

export function outputFormatFor(
  inputFormat: ImageFormat,
  requested?: ImageFormat
): ImageFormat {
  return requested || inputFormat;
}
