export type ImageInput = Buffer | Uint8Array | string;

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'tiff' | 'avif';

export interface DetectionOptions {
  /** 搜索区域宽度占图片宽度的比例，默认 0.52。 */
  searchWidthRatio?: number;
  /** 搜索区域高度占图片高度的比例，默认 0.34。 */
  searchHeightRatio?: number;
  minWidthRatio?: number;
  maxWidthRatio?: number;
  minHeightRatio?: number;
  maxHeightRatio?: number;
  minAspect?: number;
  maxAspect?: number;
  minRedDensity?: number;
  minWhiteRatio?: number;
  maxWhiteRatio?: number;
  minDarkRingRatio?: number;
  maxDarkRingMean?: number;
  maxCount?: number;
}

export interface WatermarkBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  score: number;
  whiteRatio: number;
  redDensity: number;
  ringDarkRatio: number;
}

export interface RemovalOptions {
  /** 水印包围盒额外扩展的像素数，默认 5。 */
  padding?: number;
}

export interface CleanOptions {
  detection?: DetectionOptions;
  removal?: RemovalOptions;
  /** 强制输出格式；默认沿用输入格式。 */
  format?: ImageFormat;
  /** JPEG / WebP / AVIF / TIFF 的输出质量。 */
  quality?: number;
}

export interface CleanResult {
  /** 编码后的图片。无水印时原样返回输入 Buffer。 */
  data: Buffer;
  detected: boolean;
  watermarks: WatermarkBox[];
  width: number;
  height: number;
  format: ImageFormat;
}

export interface AddWatermarkOptions {
  /** 标签文字，按顺序从上到下排列，默认 ['WATERMARK']。 */
  labels?: string[];
  /** 标签距离图片左上角的像素，默认按图片尺寸缩放。 */
  padding?: number;
  /** 多个标签之间的间距，默认按字号缩放。 */
  gap?: number;
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number | string;
  borderRadius?: number;
  format?: ImageFormat;
  quality?: number;
}
