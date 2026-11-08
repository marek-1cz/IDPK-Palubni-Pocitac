/**
 * make-game-zip.js
 * 
 * Skript pro vytvoření ZIP souboru z dist-game/win-unpacked/
 * pro nahrání na Dropbox a distribuci přes Launcher.
 * 
 * Použití:
 *   npm run zip:game
 *   nebo
 *   node scripts/make-game-zip.js [VERSION_NAME]
 * 
 * Výsledek: dist-game/OIS-IDPK-V1.6.2.zip
 * Tento ZIP nahraj na Dropbox a URL vlož do databáze (pole file_url).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Verze — buď z příkazové řádky nebo z package.json
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = process.argv[2] || `V${pkg.version}`;
const PRODUCT_NAME = pkg.build ? pkg.build.productName : 'OIS IDPK';

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'dist-game', 'win-unpacked');
const OUTPUT_DIR = path.join(ROOT, 'dist-game');
const ZIP_NAME = `OIS-IDPK-${VERSION}.zip`;
const ZIP_PATH = path.join(OUTPUT_DIR, ZIP_NAME);

// Ověřit že dist-game/win-unpacked existuje
if (!fs.existsSync(SOURCE_DIR)) {
    console.error('\n❌ CHYBA: dist-game/win-unpacked neexistuje!');
    console.error('   Nejprve spusť: npm run build:game');
    process.exit(1);
}

// 1. Zapsat výchozí build_info.json do win-unpacked
const defaultBuildTag = `${VERSION}.00`;
const buildInfoPath = path.join(SOURCE_DIR, 'build_info.json');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const timeStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const baseBuildInfo = {
    version: VERSION,
    build: defaultBuildTag,
    current_build: defaultBuildTag,
    updated_at: timeStr,
    is_base_release: true
};
fs.writeFileSync(buildInfoPath, JSON.stringify(baseBuildInfo, null, 2), 'utf8');
console.log(`📝 Vytvořen výchozí build_info.json (Build: ${defaultBuildTag})`);

// Smazat starý ZIP pokud existuje
if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
    console.log(`🗑️  Smazán starý ZIP: ${ZIP_NAME}`);
}

console.log(`\n📦 Balím ZIP pro Dropbox...`);
console.log(`   Verze: ${VERSION}`);
console.log(`   Zdroj: dist-game/win-unpacked/`);
console.log(`   Výstup: dist-game/${ZIP_NAME}\n`);

// Použijeme PowerShell Compress-Archive (dostupné na Windows bez externích nástrojů)
const psCommand = `Compress-Archive -Path "${SOURCE_DIR}\\*" -DestinationPath "${ZIP_PATH}" -CompressionLevel Optimal`;

try {
    console.log('⏳ Komprimování... (může trvat 1-2 minuty)');
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit', cwd: ROOT });
    
    const zipSize = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1);
    
    console.log(`\n✅ ZIP vytvořen: dist-game/${ZIP_NAME}`);
    console.log(`   Velikost: ${zipSize} MB`);
    console.log('\n📋 DALŠÍ KROKY:');
    console.log('   1. Nahrej tento ZIP na Dropbox');
    console.log('   2. Zkopíruj "Direct download link" (musí končit ?dl=1 nebo raw=1)');
    console.log('   3. V databázi (tabulka verze) nastav field file_url = <tvoje URL>');
    console.log(`   4. Nastav db_version = "${VERSION}"`);
    console.log('   5. Launcher si automaticky stáhne a rozbalí ZIP při kliknutí STÁHNOUT\n');
} catch (e) {
    console.error('\n❌ CHYBA při komprimování:', e.message);
    process.exit(1);
}
