/**
 * make-game-zip-from-existing.js
 * 
 * Rychlejší varianta - zipuje ze stávajícího dist/win-unpacked
 * (pokud jsi už spustil npm run build dříve)
 * 
 * Použití: node scripts/make-game-zip-from-existing.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = process.argv[2] || `V${pkg.version}`;

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'dist', 'win-unpacked');
const OUTPUT_DIR = path.join(ROOT, 'dist');
const ZIP_NAME = `OIS-IDPK-${VERSION}.zip`;
const ZIP_PATH = path.join(OUTPUT_DIR, ZIP_NAME);

if (!fs.existsSync(SOURCE_DIR)) {
    console.error('\n❌ CHYBA: dist/win-unpacked neexistuje!');
    console.error('   Nejprve spusť: npm run build');
    process.exit(1);
}

if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
    console.log(`🗑️  Smazán starý ZIP: ${ZIP_NAME}`);
}

console.log(`\n📦 Balím Game ZIP pro Dropbox...`);
console.log(`   Zdroj: dist/win-unpacked/`);
console.log(`   Výstup: dist/${ZIP_NAME}\n`);

const psCommand = `Compress-Archive -Path "${SOURCE_DIR}\\*" -DestinationPath "${ZIP_PATH}" -CompressionLevel Optimal`;

try {
    console.log('⏳ Komprimování... (může trvat 1-2 minuty)');
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit', cwd: ROOT });
    
    const zipSize = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1);
    
    console.log(`\n✅ HOTOVO!`);
    console.log(`   ZIP: dist/${ZIP_NAME}  (${zipSize} MB)`);
    console.log(`\n📋 DROPBOX POSTUP:`);
    console.log(`   1. Nahrej  dist/${ZIP_NAME}  na Dropbox`);
    console.log(`   2. V Dropboxu klikni "Share" → "Copy link"`);
    console.log(`   3. Uprav link: změň ?dl=0 na ?dl=1  (přímé stažení)`);
    console.log(`      Příklad: https://www.dropbox.com/scl/fi/abc123/OIS-IDPK-V1.6.2.zip?rlkey=xyz&dl=1`);
    console.log(`   4. V databázi (tabulka "verze") nastav:`);
    console.log(`      - db_version = "${VERSION}"`);
    console.log(`      - file_url = <URL z Dropboxu s ?dl=1>`);
    console.log(`      - can_download = true`);
    console.log(`      - can_launch = true`);
    console.log(`\n   Launcher si tento ZIP automaticky stáhne a rozbalí.\n`);
} catch (e) {
    console.error('\n❌ CHYBA při komprimování:', e.message);
    process.exit(1);
}
