import { add as addWatermark } from './add';
import { decodeImage, encodeRaw, outputFormatFor } from './image';
import { detectWatermarks, removeWatermarks } from './watermark';
import type {
  AddWatermarkOptions,
  CleanOptions,
  CleanResult,
  DetectionOptions,
  ImageFormat,
  ImageInput,
  RemovalOptions,
  WatermarkBox,
} from './types';

export type {
  AddWatermarkOptions,
  CleanOptions,
  CleanResult,
  DetectionOptions,
  ImageFormat,
  ImageInput,
  RemovalOptions,
  WatermarkBox,
};

/**
 * 检测图片左上角是否存在红底白字水印。
 */
export async function has(
  input: ImageInput,
  options: DetectionOptions = {}
): Promise<boolean> {
  const image = await decodeImage(input);
  return detectWatermarks(image.data, image.width, image.height, image.channels, options).length > 0;
}

/**
 * 清除图片左上角的红底白字水印。
 *
 * 检测不到水印时不会重新编码，`data` 会原样返回输入 Buffer。
 */
export async function clean(
  input: ImageInput,
  options: CleanOptions = {}
): Promise<CleanResult> {
  const image = await decodeImage(input);
  const watermarks = detectWatermarks(
    image.data,
    image.width,
    image.height,
    image.channels,
    options.detection || {}
  );

  if (watermarks.length === 0) {
    return {
      data: image.inputBuffer,
      detected: false,
      watermarks: [],
      width: image.width,
      height: image.height,
      format: image.format,
    };
  }

  removeWatermarks(
    image.data,
    image.width,
    image.height,
    image.channels,
    watermarks,
    options.removal || {}
  );

  const format = outputFormatFor(image.format, options.format);
  const data = await encodeRaw(
    image.data,
    image.width,
    image.height,
    image.channels,
    format,
    options.quality
  );

  return {
    data,
    detected: true,
    watermarks,
    width: image.width,
    height: image.height,
    format,
  };
}

/**
 * 在图片左上角添加一个或多个红底白字水印标签。
 */
export async function add(
  input: ImageInput,
  options: AddWatermarkOptions = {}
): Promise<Buffer> {
  return addWatermark(input, options);
}
