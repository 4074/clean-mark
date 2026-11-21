'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { packager } = require('@electron/packager');


async function pruneSharpPlatforms({ buildPath, platform }) {
  const imgDir = path.join(buildPath, 'node_modules', '@img');
  if (!fs.existsSync(imgDir)) return;
  const keep = platform === 'win32'
    ? new Set(['sharp-win32-x64', 'colour'])
    : new Set(['sharp-darwin-x64', 'sharp-libvips-darwin-x64', 'colour']);
  for (const entry of await fsp.readdir(imgDir)) {
    if (!keep.has(entry)) {
      await fsp.rm(path.join(imgDir, entry), { recursive: true, force: true });
    }
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'dist');
  const zipDir = path.join(root, '.electron-zips');

  const options = {
    dir: root,
    name: 'CleanMark',
    out: outDir,
    overwrite: true,
    prune: true,
    platform: 'darwin',
    arch: process.arch,
    appBundleId: 'com.local.cleanmark',
    appVersion: '1.0.0',
    appCopyright: 'Copyright © 2026',
    icon: path.join(root, 'assets', 'icon.icns'),
    extendInfo: {
      CFBundleDisplayName: '净印',
      CFBundleName: '净印',
      NSDocumentsFolderUsageDescription:
        '净印需要读取你选择的图片文件夹，并在旁边创建 transformed 文件夹。',
      NSDesktopFolderUsageDescription:
        '净印需要读取你选择的图片文件夹，并在旁边创建 transformed 文件夹。',
      NSDownloadsFolderUsageDescription:
        '净印需要读取你选择的图片文件夹，并在旁边创建 transformed 文件夹。',
    },
    asar: {
      unpackDir: 'node_modules/@img',
    },
    ignore: [
      /^\/test($|\/)/,
      /^\/dist($|\/)/,
      /^\/\.tmp/,
      /^\/\.npm-cache($|\/)/,
      /^\/\.electron-cache($|\/)/,
      /^\/\.electron-zips($|\/)/,
      /^\/scripts($|\/)/,
      /^\/README\.md$/,
    ],
    electronZipDir: fs.existsSync(zipDir) ? zipDir : undefined,
    afterPrune: [pruneSharpPlatforms],
  };

  // 优先复用已下载的 Electron 压缩包，离线时也能打包。
  if (options.electronZipDir) {
    const expected = path.join(zipDir, `electron-v45.4.1-darwin-${process.arch}.zip`);
    if (!fs.existsSync(expected)) options.electronZipDir = undefined;
  }

  const appPaths = await packager(options);
  console.log(`\n打包完成：\n${appPaths.join('\n')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
