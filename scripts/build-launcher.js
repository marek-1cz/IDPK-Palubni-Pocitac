const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const versionFilePath = path.join(rootDir, 'launcher-version.json');
const builderConfigPath = path.join(rootDir, 'electron-builder.launcher.json');

// 1. Read version config
let versionInfo = { version: "1.0.0", build: 1, productName: "IDPK Launcher" };
if (fs.existsSync(versionFilePath)) {
    try {
        versionInfo = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    } catch (e) {
        console.warn('Could not parse launcher-version.json, using defaults.');
    }
}

// Support CLI version override: e.g. "node scripts/build-launcher.js 1.0.1"
const args = process.argv.slice(2);
if (args[0] && /^\d+\.\d+(\.\d+)?/.test(args[0])) {
    versionInfo.version = args[0];
}

// 2. Increment build number & update timestamp
versionInfo.build = (versionInfo.build || 0) + 1;
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
versionInfo.last_build = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
fs.writeFileSync(versionFilePath, JSON.stringify(versionInfo, null, 2), 'utf8');

console.log(`====================================================`);
console.log(` Building ${versionInfo.productName} v${versionInfo.version} (Build #${versionInfo.build})`);
console.log(` Last build: ${versionInfo.last_build}`);
console.log(`====================================================`);

// 3. Sync version & files into electron-builder.launcher.json
if (fs.existsSync(builderConfigPath)) {
    const builderConfig = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));
    builderConfig.extraMetadata = builderConfig.extraMetadata || {};
    builderConfig.extraMetadata.version = versionInfo.version;
    if (builderConfig.files && !builderConfig.files.includes('launcher-version.json')) {
        builderConfig.files.push('launcher-version.json');
    }
    fs.writeFileSync(builderConfigPath, JSON.stringify(builderConfig, null, 2), 'utf8');
}

// 4. Run electron-builder
try {
    execSync('npx electron-builder --win --x64 --config electron-builder.launcher.json', {
        cwd: rootDir,
        stdio: 'inherit'
    });
    console.log(`\n✅ Launcher installer built successfully: v${versionInfo.version}!`);
    console.log(`Output: dist-launcher/IDPK Launcher Setup ${versionInfo.version}.exe`);
} catch (error) {
    console.error(`\n❌ Build failed with exit code ${error.status}`);
    process.exit(error.status || 1);
}

