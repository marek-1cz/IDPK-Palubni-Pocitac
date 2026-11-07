/**
 * make-patch.js
 * 
 * Vytvoří lehký Patch ZIP balíček pro automatickou aktualizaci verze přes Launcher.
 * Balíček obsahuje pouze aktualizované resources/ (kód, linky, zvuky) a build_info.json,
 * takže uživatel nemusí znovu stahovat 150 MB runtime Electronu!
 * 
 * Použití:
 *   node scripts/make-patch.js [BUILD_TAG]
 *   např.:
 *   node scripts/make-patch.js V1.6.3.00
 *   node scripts/make-patch.js V1.6.2.01
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const baseVer = `V${pkg.version}`;
const customTag = process.argv[2] ? process.argv[2].trim() : `${baseVer}.00`;

console.log('====================================================');
console.log(` 🔧 Vytváření Patch balíčku pro OIS IDPK`);
console.log(` Základní verze: ${baseVer}`);
console.log(` Cílový build:   ${customTag}`);
console.log('====================================================\n');

// Hledání složky resources v dist-game/win-unpacked nebo dist/win-unpacked
let resSource = path.join(ROOT, 'dist-game', 'win-unpacked', 'resources');
if (!fs.existsSync(resSource)) {
    resSource = path.join(ROOT, 'dist', 'win-unpacked', 'resources');
}

if (!fs.existsSync(resSource)) {
    console.error('❌ CHYBA: Nebyla nalezena složka resources v dist-game/win-unpacked/resources!');
    console.error('   Před vytvořením patche spusťte sestavení hry:');
    console.error('   npm run build:game\n');
    process.exit(1);
}

const outputDir = path.join(ROOT, 'dist-game');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const stagingDir = path.join(outputDir, 'patch-staging');
if (fs.existsSync(stagingDir)) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
}
fs.mkdirSync(stagingDir, { recursive: true });

// 1. Zkopírovat resources do stagingDir/resources
const stagingResources = path.join(stagingDir, 'resources');
console.log('📁 Kopíruji resources do dočasné složky...');

// Na Windows použijeme xcopy nebo robocopy / node fs.cpSync
try {
    fs.cpSync(resSource, stagingResources, { recursive: true });
} catch (e) {
    execSync(`xcopy "${resSource}" "${stagingResources}" /E /I /H /Y /Q`, { stdio: 'ignore' });
}

// 2. Vytvořit build_info.json
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const timeStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const buildInfo = {
    version: baseVer,
    build: customTag,
    current_build: customTag,
    updated_at: timeStr
};

fs.writeFileSync(path.join(stagingDir, 'build_info.json'), JSON.stringify(buildInfo, null, 2), 'utf8');

// 3. Zabalit patch do ZIPu
const cleanTag = customTag.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
const zipName = `OIS-IDPK-Patch-${cleanTag}.zip`;
const zipPath = path.join(outputDir, zipName);

if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
    console.log(`🗑️  Smazán starý patch ZIP: ${zipName}`);
}

console.log(`⏳ Balím Patch balíček ${zipName}...`);
const psCommand = `Compress-Archive -Path "${stagingDir}\\*" -DestinationPath "${zipPath}" -CompressionLevel Optimal`;

try {
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit', cwd: ROOT });
    
    // Úklid staging složky
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}

    const zipSizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);

    console.log('\n====================================================');
    console.log(`✅ PATCH BALÍČEK ÚSPĚŠNĚ VYTVOŘEN!`);
    console.log(`   Soubor:   dist-game/${zipName}`);
    console.log(`   Velikost: ${zipSizeMB} MB`);
    console.log('====================================================\n');
    console.log('📋 POSTUP PRO NASAZENÍ:');
    console.log(`   1. Nahraj soubor  dist-game/${zipName}  do GitHub Releases nebo na Dropbox.`);
    console.log('   2. Zkopíruj přímý odkaz ke stažení (Direct download link).');
    console.log('   3. Otevři Web Dashboard (/dashboard/downloads).');
    console.log(`   4. U verze ${baseVer} klikni na zelené tlačítko "Vydat Build".`);
    console.log(`   5. Vyplň build: "${customTag}", vlož URL patch ZIPu, napiš novinky.`);
    console.log('   6. Zaškrtni odeslání do Discord kanálu "👷‍♂️・aktulizace" a klikni Publikovat.');
    console.log('\n   Hráčům v Launcheru ihned naskočí rychlé tlačítko AKTUALIZOVAT!\n');
} catch (err) {
    console.error('\n❌ Chyba při kompresi patche:', err.message);
    process.exit(1);
}
