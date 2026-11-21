'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawnSync } = require('child_process');
const { packager } = require('@electron/packager');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_VERSION = '45.4.1';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${ELECTRON_VERSION}-win32-${ARCH}.zip`;
const OUT_DIR = path.join(ROOT, 'dist');
const ZIP_DIR = path.join(ROOT, '.electron-zips');
const CACHE_DIR = path.join(ROOT, '.electron-cache');
const APP_NAME = 'CleanMark';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 退出，状态码 ${result.status}`);
  }
}

async function ensureElectronZip() {
  await fsp.mkdir(ZIP_DIR, { recursive: true });
  const destination = path.join(ZIP_DIR, ZIP_NAME);
  if (fs.existsSync(destination)) return destination;

  console.log(`下载 Windows Electron ${ELECTRON_VERSION}…`);
  if (!process.env.ELECTRON_MIRROR) {
    process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  }
  const { downloadArtifact } = require('@electron/get');
  const artifact = await downloadArtifact({
    version: ELECTRON_VERSION,
    artifactName: 'electron',
    platform: 'win32',
    arch: ARCH,
    cacheRoot: CACHE_DIR,
  });
  await fsp.copyFile(artifact, destination);
  return destination;
}

async function ensureWindowsSharp() {
  const target = path.join(ROOT, 'node_modules', '@img', 'sharp-win32-x64');
  if (fs.existsSync(path.join(target, 'index.cjs'))) return target;

  console.log('准备 Windows 版 sharp 运行库…');
  const packageJson = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = (packageJson.optionalDependencies || {})['@img/sharp-win32-x64'];
  if (!version) throw new Error('package.json 缺少 @img/sharp-win32-x64 可选依赖。');

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleanmark-sharp-win-'));
  try {
    const cache = path.join(ROOT, '.npm-cache');
    run('npm', ['pack', `@img/sharp-win32-x64@${version}`, '--pack-destination', tempDir, '--silent'], {
      cwd: ROOT,
      env: { ...process.env, npm_config_cache: cache },
    });
    const tarball = (await fsp.readdir(tempDir)).find((name) => name.endsWith('.tgz'));
    if (!tarball) throw new Error('无法下载 Windows sharp 包。');
    await fsp.mkdir(target, { recursive: true });
    run('tar', ['-xzf', path.join(tempDir, tarball), '-C', target, '--strip-components=1']);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
  return target;
}

function createZip(folderName, zipPath) {
  if (process.platform === 'win32') {
    run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Force -Path '${folderName}' -DestinationPath '${zipPath}'`,
    ], { cwd: OUT_DIR });
  } else {
    run('zip', ['-r', '-q', zipPath, folderName], { cwd: OUT_DIR });
  }
}


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
  await ensureElectronZip();
  await ensureWindowsSharp();
  await fsp.mkdir(OUT_DIR, { recursive: true });

  console.log('开始打包 Windows x64 应用…');
  const appPaths = await packager({
    dir: ROOT,
    name: APP_NAME,
    out: OUT_DIR,
    overwrite: true,
    prune: true,
    platform: 'win32',
    arch: ARCH,
    appVersion: '1.0.0',
    appCopyright: 'Copyright © 2026',
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    win32metadata: {
      CompanyName: 'CleanMark',
      FileDescription: '净印 · 图片去水印',
      InternalName: APP_NAME,
      OriginalFilename: `${APP_NAME}.exe`,
      ProductName: '净印',
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
      /^\/docs($|\/)/,
    ],
    electronZipDir: ZIP_DIR,
    afterPrune: [pruneSharpPlatforms],
  });

  const appDir = appPaths[0];
  const zipPath = path.join(OUT_DIR, `CleanMark-1.0.0-win-${ARCH}.zip`);
  await fsp.rm(zipPath, { force: true });
  createZip(path.basename(appDir), zipPath);

  console.log(`\nWindows 应用：${appDir}`);
  console.log(`Windows 压缩包：${zipPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
