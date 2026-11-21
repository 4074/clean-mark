'use strict';

/**
 * macOS 上直接执行 Electron.app 内的二进制，在部分系统中会触发
 * LaunchServices/App Shim 的 SIGTRAP。通过一个极小的 .app 包装器交给
 * LaunchServices 启动，可以稳定地打开开发版。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function findPackagedApp() {
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) return null;
  for (const entry of fs.readdirSync(distDir)) {
    const candidate = path.join(distDir, entry, 'CleanMark.app');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

if (process.platform === 'darwin') {
  const forceDev = process.argv.includes('--dev');
  const packaged = forceDev ? null : findPackagedApp();

  if (packaged) {
    console.log(`打开已打包应用：${packaged}`);
    const result = spawnSync('open', ['-n', packaged], { stdio: 'inherit' });
    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    process.exit(result.status || 0);
  }

  if (!forceDev) {
    console.log('未找到已打包应用，使用开发启动器。执行 npm run package 可生成 .app。');
  }

  const launcher = path.join(root, 'scripts', 'DevLauncher.app');
  const result = spawnSync('open', ['-n', launcher], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status || 0);
}

const electron = require('electron');
const child = spawn(electron, ['.'], { cwd: root, stdio: 'inherit' });
child.on('close', (code) => process.exit(code == null ? 0 : code));
