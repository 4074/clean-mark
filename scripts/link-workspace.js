'use strict';

/**
 * npm workspaces 会把 @cleanmark/lib 的符号链接放在仓库根 node_modules，
 * 而 app 是由 packages/app 单独打包的。这里在 app 的 node_modules 下补一个
 * 本地链接，保证运行和 electron-packager 都能从 app 目录解析到 lib。
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const scopeDir = path.join(repoRoot, 'packages', 'app', 'node_modules', '@cleanmark');
const linkPath = path.join(scopeDir, 'lib');
const target = path.join(repoRoot, 'packages', 'lib');

if (fs.existsSync(linkPath)) {
  const stat = fs.lstatSync(linkPath);
  if (stat.isSymbolicLink()) {
    const current = path.resolve(scopeDir, fs.readlinkSync(linkPath));
    if (current === target) process.exit(0);
  }
}

fs.mkdirSync(scopeDir, { recursive: true });
if (fs.existsSync(linkPath)) {
  fs.rmSync(linkPath, { recursive: true, force: true });
}
fs.symlinkSync(
  process.platform === 'win32' ? target : path.relative(scopeDir, target),
  linkPath,
  process.platform === 'win32' ? 'junction' : 'dir'
);
console.log(`linked @cleanmark/lib -> ${path.relative(repoRoot, target)}`);
