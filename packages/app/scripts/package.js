'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { packager } = require('@electron/packager');


async function pruneStagedApp({ buildPath, platform }) {
  // lib 是 workspace 符号链接。打包后删除它自带的 node_modules 和源码，
  // 让 @cleanmark/lib 复用 app 的 sharp（以及目标平台运行库），避免原生模块重复。
  const libDir = path.join(buildPath, 'node_modules', '@cleanmark', 'lib');
  for (const junk of ['node_modules', 'src', 'test', 'tsconfig.json', 'package-lock.json']) {
    await fsp.rm(path.join(libDir, junk), { recursive: true, force: true });
  }

  const imgDirs = [
    path.join(buildPath, 'node_modules', '@img'),
    path.join(buildPath, 'node_modules', 'sharp', 'node_modules', '@img'),
  ];
  const keep = platform === 'win32'
    ? new Set(['sharp-win32-x64', 'colour'])
    : new Set(['sharp-darwin-x64', 'sharp-libvips-darwin-x64', 'colour']);
  for (const imgDir of imgDirs) {
    if (!fs.existsSync(imgDir)) continue;
    for (const entry of await fsp.readdir(imgDir)) {
      if (!keep.has(entry)) {
        await fsp.rm(path.join(imgDir, entry), { recursive: true, force: true });
      }
    }
  }
}

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(appRoot, '..', '..');
  const outDir = path.join(repoRoot, 'dist');
  const zipDir = path.join(repoRoot, '.electron-zips');
  const electronVersion = require(path.join(appRoot, 'node_modules', 'electron', 'package.json')).version;

  const options = {
    dir: appRoot,
    name: 'CleanMark',
    out: outDir,
    overwrite: true,
    prune: true,
    platform: 'darwin',
    arch: process.arch,
    appBundleId: 'com.local.cleanmark',
    appVersion: '1.0.0',
    appCopyright: 'Copyright © 2026',
    icon: path.join(appRoot, 'assets', 'icon.icns'),
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
      unpackDir: '**/@img/**',
    },
    ignore: [
      /^\/dist($|\/)/,
      /^\/test($|\/)/,
      /^\/\.tmp/,
      /^\/scripts($|\/)/,
      /^\/README\.md$/,
    ],
    electronZipDir: fs.existsSync(zipDir) ? zipDir : undefined,
    afterPrune: [pruneStagedApp],
  };

  // 优先复用已下载的 Electron 压缩包，离线时也能打包。
  if (options.electronZipDir) {
    const expected = path.join(zipDir, `electron-v${electronVersion}-darwin-${process.arch}.zip`);
    if (!fs.existsSync(expected)) options.electronZipDir = undefined;
  }

  const appPaths = await packager(options);
  const appDir = appPaths[0];
  const zipPath = path.join(outDir, `CleanMark-1.0.0-mac-${process.arch}.zip`);
  await fsp.rm(zipPath, { force: true });
  const zip = require('child_process').spawnSync(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', path.basename(appDir), zipPath],
    { cwd: outDir, stdio: 'inherit' }
  );
  if (zip.error) throw zip.error;
  if (zip.status !== 0) throw new Error(`ditto 打包失败，状态码 ${zip.status}`);

  console.log(`\n打包完成：\n${appDir}\n${zipPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
