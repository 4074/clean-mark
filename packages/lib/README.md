# @cleanmark/lib

TypeScript 图片水印库，针对图片左上角的「红底白字」标签。

```bash
npm install @cleanmark/lib
```

## API

```ts
import { has, add, clean } from '@cleanmark/lib';
import { readFile, writeFile } from 'node:fs/promises';

const input = await readFile('input.png');

// 是否存在水印
const detected: boolean = await has(input);

// 添加水印（默认红底白字，可添加多个标签）
const withWatermark = await add(input, {
  labels: ['ALI35A', 'ALI35B'],
  backgroundColor: '#e23e3e',
  textColor: '#ffffff',
});
await writeFile('watermarked.png', withWatermark);

// 清除水印
const result = await clean(input);
console.log(result.detected, result.watermarks.length, result.width, result.height);
await writeFile('cleaned.png', result.data);
```

### `has(input, options?)`

返回 `Promise<boolean>`。检测左上角是否存在符合「红底、白字、黑色背景」特征的水印。

### `add(input, options?)`

返回 `Promise<Buffer>`。在左上角绘制一个或多个红色圆角标签，并输出与原图相同格式的图片。

主要选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `labels` | `['WATERMARK']` | 标签文字，按顺序从上到下排列 |
| `backgroundColor` | `#e23e3e` | 标签背景色 |
| `textColor` | `#ffffff` | 文字颜色 |
| `fontSize` | 自适应 | 字号 |
| `padding` | 自适应 | 距左上角边距 |
| `gap` | 自适应 | 多标签间距 |
| `borderRadius` | 自适应 | 圆角半径 |
| `format` | 输入格式 | 输出格式 |
| `quality` | 格式默认值 | 有损格式质量 |

### `clean(input, options?)`

返回：

```ts
interface CleanResult {
  data: Buffer;
  detected: boolean;
  watermarks: WatermarkBox[];
  width: number;
  height: number;
  format: ImageFormat;
}
```

- 检测到水印：按原格式（或 `options.format`）重新编码
- 未检测到水印：`data` 原样返回输入 Buffer，不重新压缩
- 支持 JPEG、PNG、WebP、TIFF、AVIF

`input` 支持文件路径、`Buffer` 或 `Uint8Array`。

## 开发

```bash
npm run build
npm test
```
