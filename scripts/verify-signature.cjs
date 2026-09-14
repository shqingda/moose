// electron-builder 的 afterSign 钩子：签名严格校验失败时中止打包，避免生成损坏安装包。
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

// Fail packaging before DMG creation if the final bundle seal is invalid.
module.exports = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  const app = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
    stdio: 'inherit',
  });
};
