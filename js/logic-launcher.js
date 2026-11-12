let activeDownloadCleanup = null;
let currentPendingEmail = '';
// Vlastní moderní alert (nahrazuje nativní ošklivý alert)
window.alert = function(msg) {
    let modal = document.getElementById('custom-alert-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'custom-alert-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:999999; backdrop-filter: blur(4px); font-family: "Inter", sans-serif; opacity: 0; transition: opacity 0.2s ease;';
        
        let box = document.createElement('div');
        box.style.cssText = 'background:#18181b; border:1px solid #3f3f46; border-radius:12px; padding:24px; max-width:400px; width:90%; color:#f4f4f5; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.6); transform: scale(0.95); transition: transform 0.2s ease; display:flex; flex-direction:column; gap: 16px;';
        
        let icon = document.createElement('div');
        icon.innerHTML = '<i class="fas fa-exclamation-circle" style="font-size: 32px; color: #facc15;"></i>';
        
        let text = document.createElement('div');
        text.id = 'custom-alert-text';
        text.style.cssText = 'font-size:15px; line-height:1.5; word-wrap:break-word; color: #e4e4e7; font-weight: 500;';
        
        let btn = document.createElement('button');
        btn.innerText = 'Rozumím';
        btn.style.cssText = 'background:#3b82f6; border:none; color:white; padding:10px 24px; border-radius:6px; cursor:pointer; font-size:14px; font-weight: bold; align-self: center; transition: background 0.2s;';
        btn.onmouseover = () => btn.style.background = '#2563eb';
        btn.onmouseout = () => btn.style.background = '#3b82f6';
        btn.onclick = () => { 
            modal.style.opacity = '0'; 
            box.style.transform = 'scale(0.95)';
            setTimeout(() => modal.style.display = 'none', 200); 
        };
        
        box.appendChild(icon);
        box.appendChild(text);
        box.appendChild(btn);
        modal.appendChild(box);
        document.body.appendChild(modal);
    }
    
    document.getElementById('custom-alert-text').innerText = msg;
    modal.style.display = 'flex';
    
    // Animate in
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.querySelector('div').style.transform = 'scale(1)';
    }, 10);
};

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const extract = require('extract-zip');
const { exec, spawn } = require('child_process');
const os = require('os');

window.onerror = function(msg, url, lineNo, columnNo, error) {
    alert("Error: " + msg + "\nLine: " + lineNo + "\n" + error);
    return false;
};

window.addEventListener('unhandledrejection', function(event) {
    alert("Unhandled promise rejection: " + event.reason);
});

// Křížek a minimalizace
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.send('quit-app'));
document.getElementById('btn-minimize').addEventListener('click', () => {
    ipcRenderer.send('minimize-app');
});


const hwidDisplay = document.getElementById('hwid-display');
let availableVersions = [];
const roleDisplay = document.getElementById('role-display');
const versionSelect = document.getElementById('version-select');
const btnLaunch = document.getElementById('btn-launch');
const launchText = document.querySelector('.launch-text');
const launchIcon = document.querySelector('.launch-icon');
const progressContainer = document.getElementById('download-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

let currentUserRole = 'public';
const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
const configPath = path.join(userDataPath, 'config.json');

function loadConfig() {
    if (fs.existsSync(configPath)) {
        try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e){}
    }
    return {};
}

function saveConfig(config) {
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

const launcherCachePath = path.join(userDataPath, 'cached_launcher_state.json');
let isOfflineMode = false;

function saveLauncherCache(payload) {
    try {
        if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(launcherCachePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {}
}

function loadLauncherCache() {
    try {
        if (fs.existsSync(launcherCachePath)) {
            return JSON.parse(fs.readFileSync(launcherCachePath, 'utf8'));
        }
    } catch (_) {}
    return null;
}

// =========================================================================
// CENTRÁLNÍ UŽIVATELSKÁ DATA (VLASTNÍ LINKY NAVÁZÁNY NA LAUNCHER)
// =========================================================================
const centralUserDataPath = path.join(userDataPath, 'userdata');

const KNOWN_DEFAULT_LINKS = new Set([
    '336_auto.txt', '424_auto.txt', '621_auto.txt', '711_auto.txt', '722_auto.txt',
    '723_auto.txt', '731_auto.txt', '734_auto.txt', '735_auto.txt', '736_auto.txt',
    '737_auto.txt', '738_auto.txt', '739_auto.txt', '749_auto.txt', '750_auto.txt',
    '752_auto.txt', '753_auto.txt', '754_auto.txt', '755_auto.txt', '757_auto.txt',
    '759_auto.txt', '760_auto.txt', '911_auto.txt'
]);

function ensureCentralUserDataFolders() {
    try {
        if (!fs.existsSync(centralUserDataPath)) fs.mkdirSync(centralUserDataPath, { recursive: true });
        const subs = ['linky', 'data', 'zvuky', 'obraz'];
        subs.forEach(s => {
            const p = path.join(centralUserDataPath, s);
            if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        });
    } catch (e) {
        console.warn("Chyba při přípravě složek userdata:", e);
    }
}

function findLinkyFoldersInVersion(versionFolder) {
    if (!versionFolder || !fs.existsSync(versionFolder)) return [];
    const candidateDirs = [
        path.join(versionFolder, 'linky'),
        path.join(versionFolder, 'resources', 'linky'),
        path.join(versionFolder, 'win-unpacked', 'resources', 'linky'),
        path.join(versionFolder, 'win-unpacked', 'linky')
    ];
    return candidateDirs.filter(d => fs.existsSync(d));
}

function findDataFoldersInVersion(versionFolder) {
    if (!versionFolder || !fs.existsSync(versionFolder)) return [];
    const candidateDirs = [
        path.join(versionFolder, 'data'),
        path.join(versionFolder, 'resources', 'data'),
        path.join(versionFolder, 'win-unpacked', 'resources', 'data'),
        path.join(versionFolder, 'win-unpacked', 'data')
    ];
    return candidateDirs.filter(d => fs.existsSync(d));
}

function backupUserRoutesFromVersion(versionFolder) {
    ensureCentralUserDataFolders();
    if (!versionFolder || !fs.existsSync(versionFolder)) return 0;
    const targetLinkyDir = path.join(centralUserDataPath, 'linky');
    const linkyDirs = findLinkyFoldersInVersion(versionFolder);
    let copiedCount = 0;

    linkyDirs.forEach(dir => {
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                if (!file.endsWith('.txt')) return;
                const srcPath = path.join(dir, file);
                const destPath = path.join(targetLinkyDir, file);
                try {
                    if (!fs.existsSync(destPath) || !KNOWN_DEFAULT_LINKS.has(file)) {
                        fs.copyFileSync(srcPath, destPath);
                        copiedCount++;
                    }
                } catch (_) {}
            });
        } catch (_) {}
    });

    const targetDataDir = path.join(centralUserDataPath, 'data');
    const dataDirs = findDataFoldersInVersion(versionFolder);
    dataDirs.forEach(dir => {
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                if (!file.endsWith('.json') || file === 'gtfs_version.json' || file === 'build_info.json') return;
                const srcPath = path.join(dir, file);
                const destPath = path.join(targetDataDir, file);
                try {
                    if (!fs.existsSync(destPath)) {
                        fs.copyFileSync(srcPath, destPath);
                    }
                } catch (_) {}
            });
        } catch (_) {}
    });

    return copiedCount;
}

function syncUserRoutesToVersion(targetVersionFolder) {
    ensureCentralUserDataFolders();
    if (!targetVersionFolder || !fs.existsSync(targetVersionFolder)) return;
    const centralLinkyDir = path.join(centralUserDataPath, 'linky');
    if (!fs.existsSync(centralLinkyDir)) return;

    const linkyDirs = findLinkyFoldersInVersion(targetVersionFolder);
    if (linkyDirs.length === 0) return;

    try {
        const userFiles = fs.readdirSync(centralLinkyDir);
        userFiles.forEach(file => {
            if (!file.endsWith('.txt')) return;
            const src = path.join(centralLinkyDir, file);
            linkyDirs.forEach(destDir => {
                try {
                    const dest = path.join(destDir, file);
                    if (!fs.existsSync(dest)) {
                        fs.copyFileSync(src, dest);
                    }
                } catch (_) {}
            });
        });
    } catch (_) {}
}

function showNewVersionCleanupPrompt(newVersionName, otherVersions, targetExePath, canLaunch) {
    const modal = document.getElementById('new-version-cleanup-modal');
    if (!modal) {
        if (canLaunch && targetExePath) launchApp(targetExePath);
        else checkLocalVersion(newVersionName);
        return;
    }

    const titleEl = document.getElementById('cleanup-modal-title');
    const oldListEl = document.getElementById('cleanup-old-versions-list');
    const btnDeleteOld = document.getElementById('btn-cleanup-delete-old');
    const btnKeepAll = document.getElementById('btn-cleanup-keep-all');

    if (titleEl) titleEl.innerText = `Nová verze ${newVersionName} byla stažena!`;
    if (oldListEl) oldListEl.innerText = otherVersions.join(', ');

    modal.style.display = 'flex';

    btnDeleteOld.onclick = async () => {
        btnDeleteOld.disabled = true;
        btnKeepAll.disabled = true;
        btnDeleteOld.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mažu staré verze...';

        const versionsDir = path.join(userDataPath, 'versions');
        for (const oldV of otherVersions) {
            const oldPath = path.join(versionsDir, oldV);
            backupUserRoutesFromVersion(oldPath);
            await forceDeleteFolderAsync(oldPath);
        }

        modal.style.display = 'none';
        btnDeleteOld.disabled = false;
        btnKeepAll.disabled = false;
        btnDeleteOld.innerHTML = '<i class="fas fa-trash-alt"></i> ODINSTALOVAT STARÉ VERZE';

        versionSelect.innerHTML = '';
        ensureCentralUserDataFolders();
        try {
            const versionsDir = path.join(userDataPath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const dirs = fs.readdirSync(versionsDir);
                dirs.forEach(d => backupUserRoutesFromVersion(path.join(versionsDir, d)));
            }
        } catch (_) {}

        await loadAvailableVersions();
        versionSelect.value = newVersionName;
        checkLocalVersion(newVersionName);

        if (canLaunch && targetExePath) {
            launchApp(targetExePath);
        }
    };

    btnKeepAll.onclick = () => {
        modal.style.display = 'none';
        checkLocalVersion(newVersionName);
        if (canLaunch && targetExePath) {
            launchApp(targetExePath);
        }
    };
}

// Auth UI elements
const loginOverlay = document.getElementById('login-overlay');
const loginDiscordView = document.getElementById('login-discord-view');
const loginWaitingView = document.getElementById('login-waiting-view');
const btnStartAuth = document.getElementById('btn-start-auth');
const btnCancelAuth = document.getElementById('btn-cancel-auth');

const loginEmailView = document.getElementById('login-email-view');
const loginEmailCodeView = document.getElementById('login-email-code-view');
const linkShowEmailLogin = document.getElementById('link-show-email-login');
const linkShowDiscordLogin = document.getElementById('link-show-discord-login');
const inputEmail = document.getElementById('login-email-input');
const btnStartEmailAuth = document.getElementById('btn-start-email-auth');
const btnCancelEmailAuth = document.getElementById('btn-cancel-email-auth');
const btnResendEmailAuth = document.getElementById('btn-resend-email-auth');

const inputIdentifier = document.getElementById('login-identifier-input');
const hwidText = document.getElementById('login-hwid-text');



// Vylepšení UX - odeslání přes Enter
inputIdentifier.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnStartAuth.click();
});
inputEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnStartEmailAuth.click();
});

let authPollInterval = null;
let denialCount = parseInt(localStorage.getItem('authDenialCount') || '0', 10);
let lockoutEndTime = parseInt(localStorage.getItem('authLockoutEndTime') || '0', 10);
let lockoutTimerInterval = null;

// If we started the app and are still locked out, start the timer immediately
if (lockoutEndTime > Date.now()) {
    setTimeout(startLockoutTimer, 200);
}
let currentHWID = '';
const API_BASE = 'https://datacorebot.koyeb.app';
const APP_VERSION = 'V1.6.2';

async function safeFetch(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

let LAUNCHER_VERSION = '1.0.0';
try {
    const candidatePaths = [
        path.join(__dirname, 'launcher-version.json'),
        path.join(__dirname, '..', 'launcher-version.json'),
        path.join(process.resourcesPath || '', 'app.asar', 'launcher-version.json'),
        path.join(process.resourcesPath || '', 'app', 'launcher-version.json')
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            const lVerData = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (lVerData && lVerData.version) {
                LAUNCHER_VERSION = String(lVerData.version).trim();
                break;
            }
        }
    }
} catch(e) {}

function isNewerVersion(remoteVer, currentVer) {
    if (!remoteVer || !currentVer) return false;
    const parse = (v) => {
        const matches = String(v).match(/\d+/g);
        return matches ? matches.map(Number) : [0];
    };
    const r = parse(remoteVer);
    const c = parse(currentVer);
    const len = Math.max(r.length, c.length);
    for (let i = 0; i < len; i++) {
        const rNum = r[i] || 0;
        const cNum = c[i] || 0;
        if (rNum > cNum) return true;
        if (rNum < cNum) return false;
    }
    return false;
}

async function checkForLauncherUpdate() {
    try {
        const res = await safeFetch(`${API_BASE}/api/launcher/check_update?current_version=${encodeURIComponent(LAUNCHER_VERSION)}`, {}, 4000);
        if (!res.ok) return false;
        const data = await res.json();
        if (data && data.status === 'ok') {
            const remoteVer = data.latest_version || '1.0.0';
            const dlUrl = data.download_url;
            if (data.has_update && dlUrl && isNewerVersion(remoteVer, LAUNCHER_VERSION)) {
                return await downloadAndInstallLauncherUpdate(dlUrl, remoteVer);
            }
        }
    } catch (e) {
        console.warn("[LauncherUpdate] Chyba při kontrole aktualizace:", e);
    }
    return false;
}

async function resolveGitHubReleaseAssetUrl(dlUrl) {
    if (!dlUrl || typeof dlUrl !== 'string') return null;
    if (!dlUrl.includes('github.com') || !dlUrl.includes('/releases/download/')) return null;
    const match = dlUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/releases\/download\/([^\/]+)\/([^\/]+)/);
    if (!match) return null;
    const [, owner, repo, tag, rawFilename] = match;
    const filename = decodeURIComponent(rawFilename);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
    try {
        const resp = await safeFetch(apiUrl, {
            headers: {
                'User-Agent': 'IDPK-Launcher/' + LAUNCHER_VERSION,
                'Accept': 'application/vnd.github.v3+json'
            }
        }, 6000);
        if (!resp.ok) return null;
        const data = await resp.json();
        const asset = (data.assets || []).find(a => a.name === filename || a.name === rawFilename);
        if (asset && asset.url) {
            return asset.url;
        }
    } catch (e) {
        console.warn("[resolveGitHubReleaseAssetUrl] Chyba při zjišťování asset URL:", e);
    }
    return null;
}

function downloadFileWithProgress({
    url,
    destPath,
    onProgress, // (downloaded, total, percent, speedMBps)
    timeoutMs = 120000,
    headers = {}
}) {
    return new Promise(async (resolve, reject) => {
        let redirects = 0;
        const maxRedirects = 10;
        let activeReq = null;
        let activeStream = null;
        let timer = null;
        let isCleanedUp = false;
        activeDownloadCleanup = cleanup;

        function cleanup(deleteFile = false) {
            activeDownloadCleanup = null;
            if (isCleanedUp) return;
            isCleanedUp = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (activeReq) {
                try { activeReq.destroy(); } catch (_) {}
                activeReq = null;
            }
            if (activeStream) {
                try { activeStream.close(); } catch (_) {}
                activeStream = null;
            }
            if (deleteFile && fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (_) {}
            }
        }

        function resetTimeout() {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                cleanup(true);
                reject(new Error(`Časový limit pro stahování vypršel (${Math.round(timeoutMs / 1000)}s bez odezvy serveru).`));
            }, timeoutMs);
        }

        function attempt(currentUrl, reqHeaders = headers) {
            resetTimeout();
            let parsedUrl;
            try {
                parsedUrl = new URL(currentUrl);
            } catch (err) {
                cleanup(false);
                return reject(new Error(`Neplatná adresa ke stažení: ${currentUrl}`));
            }

            const client = parsedUrl.protocol === 'http:' ? http : https;
            const customHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 IDPK-Launcher/' + LAUNCHER_VERSION,
                'Accept': (parsedUrl.hostname === 'api.github.com' && parsedUrl.pathname.includes('/releases/assets/')) ? 'application/octet-stream' : '*/*',
                ...reqHeaders
            };

            const reqOptions = {
                protocol: parsedUrl.protocol,
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
                path: parsedUrl.pathname + parsedUrl.search,
                headers: customHeaders
            };

            const req = client.get(reqOptions, (res) => {
                resetTimeout();

                // Sledování přesměrování (301, 302, 303, 307, 308)
                if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                    res.resume();
                    if (++redirects > maxRedirects) {
                        cleanup(true);
                        return reject(new Error('Příliš mnoho přesměrování při stahování souboru.'));
                    }
                    const loc = res.headers.location;
                    if (!loc) {
                        cleanup(true);
                        return reject(new Error(`Přesměrování bez cílové adresy (HTTP ${res.statusCode}).`));
                    }
                    const nextUrl = new URL(loc, currentUrl).toString();
                    return attempt(nextUrl, reqHeaders);
                }

                // Kontrola HTTP stavového kódu (povoleno pouze 200 OK)
                if (res.statusCode !== 200) {
                    res.resume();
                    cleanup(true);
                    return reject(new Error(`Server vrátil chybu stahování: HTTP ${res.statusCode} ${res.statusMessage || ''}`));
                }

                const total = parseInt(res.headers['content-length'], 10) || 0;
                let downloaded = 0;
                const startTime = Date.now();

                // Zajistit cílový adresář
                const dir = path.dirname(destPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                const fileStream = fs.createWriteStream(destPath);
                activeStream = fileStream;

                res.on('data', (chunk) => {
                    resetTimeout();
                    downloaded += chunk.length;
                    if (onProgress) {
                        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
                        const elapsedSec = (Date.now() - startTime) / 1000;
                        const speedMBps = elapsedSec > 0.5 ? ((downloaded / (1024 * 1024)) / elapsedSec).toFixed(1) : "0.0";
                        onProgress(downloaded, total, percent, speedMBps);
                    }
                });

                res.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        if (timer) clearTimeout(timer);
                        isCleanedUp = true;
                        resolve({ total, downloaded, destPath });
                    });
                });

                fileStream.on('error', (err) => {
                    cleanup(true);
                    reject(err);
                });

                res.on('error', (err) => {
                    cleanup(true);
                    reject(err);
                });
            });

            activeReq = req;

            req.on('error', (err) => {
                cleanup(true);
                reject(new Error(`Chyba připojení při stahování: ${err.message}`));
            });
        }

        let targetUrl = url;
        let startHeaders = { ...headers };
        if (targetUrl && targetUrl.includes('github.com') && targetUrl.includes('/releases/download/')) {
            try {
                const assetUrl = await resolveGitHubReleaseAssetUrl(targetUrl);
                if (assetUrl) {
                    targetUrl = assetUrl;
                    startHeaders['Accept'] = 'application/octet-stream';
                }
            } catch (_) {}
        }
        attempt(targetUrl, startHeaders);
    });
}

function isValidZipFile(filePath) {
    if (!fs.existsSync(filePath)) return { valid: false, reason: "Soubor neexistuje." };
    let size = 0;
    try {
        size = fs.statSync(filePath).size;
    } catch (e) {
        return { valid: false, reason: "Nelze zjistit velikost souboru: " + e.message };
    }
    if (size < 100) {
        try {
            const preview = fs.readFileSync(filePath, 'utf8').trim();
            if (preview.startsWith('<') || preview.includes('<html>') || preview.includes('504')) {
                return { valid: false, reason: `Server vrátil HTML chybovou stránku namísto ZIP archivu (${preview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100)}).` };
            }
        } catch (_) {}
        return { valid: false, reason: `Stažený soubor je poškozený nebo neúplný (má pouze ${size} bajtů).` };
    }
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        if (buf[0] === 0x50 && buf[1] === 0x4B) { // 'P', 'K'
            return { valid: true };
        }
        return { valid: false, reason: "Soubor nemá platnou hlavičku ZIP archivu (chybí signatura PK)." };
    } catch (e) {
        return { valid: false, reason: "Chyba při kontrole souboru: " + e.message };
    }
}

function downloadAndInstallLauncherUpdate(url, newVersion) {
    return new Promise(async (resolve) => {
        const modal = document.getElementById('launcher-update-modal');
        const statusEl = document.getElementById('launcher-update-status');
        const pBar = document.getElementById('launcher-update-progress-bar');
        const pPct = document.getElementById('launcher-update-percent');
        const pSpd = document.getElementById('launcher-update-speed');

        if (modal) modal.style.display = 'flex';
        if (statusEl) statusEl.innerText = `Nalezena nová verze Launcheru (v${newVersion}). Stahuji aktualizaci...`;

        const tempExePath = path.join(os.tmpdir(), `IDPK-Launcher-Setup-${newVersion}.exe`);

        try {
            await downloadFileWithProgress({
                url: url,
                destPath: tempExePath,
                onProgress: (downloaded, total, percent, speedMBps) => {
                    if (total > 0) {
                        if (pBar) pBar.style.width = percent + '%';
                        if (pPct) pPct.innerText = `${percent} %`;
                        const downloadedMB = (downloaded / (1024 * 1024)).toFixed(1);
                        const totalMB = (total / (1024 * 1024)).toFixed(1);
                        if (pSpd) pSpd.innerText = `${downloadedMB} / ${totalMB} MB (${speedMBps} MB/s)`;
                    } else {
                        const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
                        if (pPct) pPct.innerText = `${dlMB} MB`;
                    }
                }
            });

            if (statusEl) statusEl.innerText = `Aktualizace stažena. Restartuji a instaluji Launcher...`;
            if (pBar) pBar.style.width = '100%';
            if (pPct) pPct.innerText = '100 %';

            if (!fs.existsSync(tempExePath)) {
                throw new Error("Stažený soubor instalátoru nebyl nalezen na disku.");
            }
            const st = fs.statSync(tempExePath);
            if (st.size < 5000000) {
                try { fs.unlinkSync(tempExePath); } catch (_) {}
                throw new Error(`Stažený instalátor je neúplný nebo poškozený (velikost: ${st.size} B).`);
            }

            const isPackaged = !process.defaultApp && !/[\\/]electron\.exe$/i.test(process.execPath);
            if (!isPackaged) {
                console.log("[LauncherUpdate] Běží v DEV režimu (electron.exe). Instalátor stažen:", tempExePath);
                setTimeout(() => {
                    if (modal) modal.style.display = 'none';
                    resolve(false);
                }, 2500);
                return;
            }

            setTimeout(() => {
                ipcRenderer.send('install-launcher-update', tempExePath);
                resolve(true);
            }, 1000);
        } catch (err) {
            console.error("[LauncherUpdate] Download error:", err);
            if (modal) modal.style.display = 'none';
            try { if (fs.existsSync(tempExePath)) fs.unlinkSync(tempExePath); } catch (_) {}
            alert(`Nepodařilo se stáhnout aktualizaci Launcheru:\n${err.message}`);
            resolve(false);
        }
    });
}


function startLockoutTimer() {
    if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);
    
    // Disable inputs
    inputIdentifier.disabled = true;
    btnStartAuth.disabled = true;
    
    lockoutTimerInterval = setInterval(() => {
        let remainingMs = lockoutEndTime - Date.now();
        if (remainingMs <= 0) {
            clearInterval(lockoutTimerInterval);
            lockoutTimerInterval = null;
            inputIdentifier.disabled = false;
            btnStartAuth.disabled = false;
            hideLoginError();
        } else {
            let minutes = Math.floor(remainingMs / 60000);
            let seconds = Math.floor((remainingMs % 60000) / 1000);
            showLoginError(`Zamítnuto na Discordu. Bezpečnostní zámek: zkuste to znovu za ${minutes}m ${seconds}s.`);
        }
    }, 1000);
}

function showLoginError(msg) {
    const errBox = document.getElementById('login-error-message');
    const errText = document.getElementById('login-error-text');
    if (errBox && errText) {
        errText.innerText = msg;
        errBox.style.display = 'flex';
    } else {
        alert(msg);
    }
}

function hideLoginError() {
    const errBox = document.getElementById('login-error-message');
    if (errBox) errBox.style.display = 'none';
}

async function checkAuthAndInit() {
    const titleVerEl = document.getElementById('launcher-title-version');
    if (titleVerEl) titleVerEl.innerText = `v${LAUNCHER_VERSION}`;
    const setLauncherVerEl = document.getElementById('settings-launcher-version');
    if (setLauncherVerEl) setLauncherVerEl.innerText = `Verze Launcheru: v${LAUNCHER_VERSION}`;

    try {
        const isUpdating = await checkForLauncherUpdate();
        if (isUpdating) return;
    } catch(e) {
        console.warn('[LauncherUpdate] Kontrola aktualizace selhala:', e);
    }

    currentHWID = await getHWID();
    if (typeof hwidText !== 'undefined' && hwidText) hwidText.innerText = "HWID: " + currentHWID;
    
    let config = loadConfig();
    if (config.auto_launch === undefined) {
        config.auto_launch = true;
    }
    // Při novém spuštění aplikace se vždy zruší offline režim, dokud není znovu vyžádán
    config.offline_mode = false;
    saveConfig(config);

    if (config.discord_id || config.email) {
        // Uživatel už je přihlášen, pustíme ho dál
        await initLauncher(config);
        if (typeof initLCBridgeData === 'function') await initLCBridgeData();
        if (window.LC) {
            window.LC.showBoot(false);
            window.LC.show('game');
        }
    } else {
        // Není přihlášen, zobrazit auth
        const overlay = document.getElementById('initial-loading-overlay');
        if (overlay) overlay.style.display = 'none';
        if (typeof loginOverlay !== 'undefined' && loginOverlay) loginOverlay.style.display = 'flex';
        showAuthView('discord');
        if (typeof initLCBridgeData === 'function') await initLCBridgeData();
        if (window.LC) {
            window.LC.showBoot(false);
            window.LC.showLogin(true);
            window.LC.setLoginView('discord');
            window.LC.setUser({ hwid: currentHWID });
        }
    }
}

function showAuthView(viewName) {
    hideLoginError();
    loginDiscordView.style.display = 'none';
    loginWaitingView.style.display = 'none';
    loginEmailView.style.display = 'none';
    loginEmailCodeView.style.display = 'none';
    const vSucc = document.getElementById('login-success-view'); if (vSucc) vSucc.style.display = 'none';
    const titleElT = document.querySelector('#login-overlay > div > div:first-child'); if (titleElT && viewName !== 'success') titleElT.style.display = 'block';
    if (viewName === 'discord') loginDiscordView.style.display = 'flex';
    if (viewName === 'waiting') loginWaitingView.style.display = 'flex';
    if (viewName === 'email') loginEmailView.style.display = 'flex';
    if (viewName === 'emailCode') loginEmailCodeView.style.display = 'flex';
    if (viewName === 'success') {
        const v = document.getElementById('login-success-view');
        if (v) v.style.display = 'flex';
        document.querySelector('#login-overlay > div > div:first-child').style.display = 'none'; // hide title PŘIHLÁŠENÍ DO SYSTÉMU
    }
    if (viewName === 'emailCodeManual') {
        const v = document.getElementById('login-email-code-manual-view');
        if (v) v.style.display = 'flex';
    }
    
    // Zajištění, že se nezasekne disabled stav (např. při reloadu stránky)
    let isLocked = (lockoutEndTime > Date.now());
    inputIdentifier.disabled = isLocked;
    inputEmail.disabled = false; // email is separate
    btnStartAuth.disabled = isLocked;
    btnStartEmailAuth.disabled = false;
    btnStartEmailAuth.innerText = 'Odeslat přihlašovací odkaz';
}

linkShowEmailLogin.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthView('email');
});

linkShowDiscordLogin.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthView('discord');
});

btnStartEmailAuth.addEventListener('click', async () => {
    const inputNick = document.getElementById('login-nick-input');
    const nick = inputNick ? inputNick.value.trim() : '';
    const email = inputEmail.value.trim();
    if (!nick || nick.length < 2) {
        showLoginError("Zadejte prosím svou přezdívku (alespoň 2 znaky)!");
        return;
    }
    if (!email || !email.includes('@')) {
        showLoginError("Zadejte platný e-mail!");
        return;
    }
    
    btnStartEmailAuth.disabled = true;
    btnStartEmailAuth.innerText = 'ODESÍLÁM...';
    
    let emailAuthOldToken = null;
    try {
        const pollInitRes = await fetch(`${API_BASE}/api/launcher/email_poll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); const pollInitData = await pollInitRes.json(); emailAuthOldToken = pollInitData.status === 'success' ? pollInitData.web_session_token : null;
    } catch(e) {}
    
    try {
        const res = await fetch(`${API_BASE}/api/auth/email/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, nick: nick, intent: 'app_login' })
        });
        
        const data = await res.json();
        if (data.success || res.ok) {
            window.lastEmailSentAt = Date.now();
            if (window.emailAuthTimeoutTimer) clearTimeout(window.emailAuthTimeoutTimer);
            window.emailAuthTimeoutTimer = setTimeout(() => {
                if (window.emailPollInterval) clearInterval(window.emailPollInterval);
                showAuthView('email');
                showLoginError("Čas na ověření e-mailu vypršel (10 minut). Zkuste to prosím znovu.");
            }, 600000); // 10 minut
            showAuthView('emailCode');
            
            const retryBtns = document.getElementById('email-retry-buttons');
            const statusEl = document.getElementById('email-waiting-status');
            
            if (retryBtns) {
                retryBtns.style.display = 'none';
                if (window.retryBtnsTimeout) clearTimeout(window.retryBtnsTimeout);
                window.retryBtnsTimeout = setTimeout(() => {
                    retryBtns.style.display = 'flex';
                }, 20000);
            }
            pollAuthEmail(email);
        } else {
            showLoginError(data.message || "Nepodařilo se odeslat odkaz na e-mail.");
        }
    } catch (e) {
        showLoginError("Chyba spojení s API.");
    }
    
    btnStartEmailAuth.disabled = false;
    btnStartEmailAuth.innerText = 'Odeslat přihlašovací odkaz';
});

function pollAuthEmail(email) {
    if (window.emailPollInterval) clearInterval(window.emailPollInterval);
    const statusEl = document.getElementById('email-waiting-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = '<i class="fas fa-hourglass-half" style="margin-right: 5px;"></i>Čekám na kliknutí v e-mailu...';
    }
    window.emailPollInterval = setInterval(async () => {
        try {
            const pollRes = await fetch(`${API_BASE}/api/launcher/email_poll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const pollData = await pollRes.json();
            if (pollData.status === 'success') {
                pollData.id = pollData.discord_id;
                if (window.emailAuthTimeoutTimer) clearTimeout(window.emailAuthTimeoutTimer);
                clearInterval(window.emailPollInterval);
                if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: #22c55e; margin-right: 5px;"></i>Schváleno! Přihlašuji...';
                let config = loadConfig();
                config.discord_id = pollData.discord_id || "email-" + (pollData.id || pollData.email);
                config.discord_nick = pollData.nick || pollData.email;
                config.email = pollData.email;
                saveConfig(config);
                setTimeout(() => {
                    loginOverlay.style.display = 'none';
                    initLauncher(config);
                }, 1500);
            }
        } catch(_) {}
    }, 4000);
}

if (btnResendEmailAuth) {
    btnResendEmailAuth.addEventListener('click', () => {
        const elapsed = Date.now() - (window.lastEmailSentAt || 0);
        if (elapsed < 300000) {
            showLoginError("Počkejte prosím chvíli. Další e-mail můžeme odeslat až za 5 minut. Pokud se vám nechce čekat, můžete se přihlásit přes Discord.");
            return;
        }
        btnStartEmailAuth.click();
    });
}

const btnManualCode = document.getElementById('btn-manual-code-input');
if (btnManualCode) {
    btnManualCode.addEventListener('click', () => {
        if (window.emailPollInterval) clearInterval(window.emailPollInterval);
        showAuthView('emailCodeManual');
    });
}

const btnVerifyEmailCodeManual = document.getElementById('btn-verify-email-code-manual');
if (btnVerifyEmailCodeManual) {
    btnVerifyEmailCodeManual.addEventListener('click', async () => {
        const inputCode = document.getElementById('login-email-code-manual-input');
        const code = inputCode ? inputCode.value.trim() : '';
        const email = inputEmail.value.trim();
        
        if (code.length !== 5) {
            showLoginError("Zadejte platný 5místný kód.");
            return;
        }
        
        btnVerifyEmailCodeManual.disabled = true;
        btnVerifyEmailCodeManual.innerText = 'OVĚŘUJI...';
        
        try {
            const verifyRes = await fetch(`${API_BASE}/api/launcher/email_verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) }); const verifyData = await verifyRes.json(); if (verifyData.status === 'success') { let data = verifyData; data.id = verifyData.discord_id;
                let config = loadConfig();
                config.discord_id = data.discord_id || "email-" + data.id;
                config.discord_nick = data.nick || data.email;
                config.email = data.email;
                saveConfig(config);
                loginOverlay.style.display = 'none';
                initLauncher(config);
            } else {
                showLoginError("Neplatný kód nebo vypršela platnost.");
                if (inputCode) inputCode.value = '';
                showAuthView('emailCode');
                pollAuthEmail(email);
            }
        } catch(e) {
            showLoginError("Chyba při ověřování kódu.");
            if (inputCode) inputCode.value = '';
            showAuthView('emailCode');
            pollAuthEmail(email);
        }
        btnVerifyEmailCodeManual.disabled = false;
        btnVerifyEmailCodeManual.innerText = 'OVĚŘIT KÓD';
    });
}

const btnCancelEmailManual = document.getElementById('btn-cancel-email-manual');
if (btnCancelEmailManual) {
    btnCancelEmailManual.addEventListener('click', () => {
        const inputCode = document.getElementById('login-email-code-manual-input');
        if (inputCode) inputCode.value = '';
        showAuthView('emailCode');
        const email = document.getElementById('login-email-input').value.trim();
        pollAuthEmail(email);
    });
}

btnCancelEmailAuth.addEventListener('click', () => {
    if (window.emailPollInterval) clearInterval(window.emailPollInterval);
    showAuthView('discord');
});

document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm("Opravdu se chcete odhlásit? Aplikace se restartuje.")) {
        let config = loadConfig();
        config.discord_id = "";
        config.discord_nick = "";
        config.email = "";
        saveConfig(config);
        
        ipcRenderer.send('relaunch-app');
    }
});

btnCancelAuth.addEventListener('click', () => {
    if (authPollInterval) clearInterval(authPollInterval);
    showAuthView('discord');
    inputIdentifier.disabled = false;
});

btnStartAuth.addEventListener('click', async () => {
    const val = inputIdentifier.value.trim();
    if (!val) { showLoginError("Zadejte ID nebo Nick!"); return; }
    
    inputIdentifier.disabled = true;
    let titleEl = document.getElementById('login-waiting-title');
    if (titleEl) titleEl.innerHTML = '<i class="fas fa-paper-plane" style="margin-right: 8px;"></i>Odesílám požadavek...';
    showAuthView('waiting');

    try {
        const fetchTimeout = (url, options, timeout = 20000) => {
            return Promise.race([
                fetch(url, options),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
            ]);
        };

        const res = await fetchTimeout(`${API_BASE}/api/app_login`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: val, hwid: currentHWID, is_launcher: true, client_type: 'launcher', launcher_version: LAUNCHER_VERSION })
        });
        
        const textData = await res.text();
        const fixedText = textData.replace(/"discord_id":\s*(\d+)/g, '"discord_id": "$1"');
        const data = JSON.parse(fixedText);

        const isDevMode = false; // !__dirname.includes('app.asar');
        
        let titleEl = document.getElementById('login-waiting-title');

        if (data.status === 'waiting' || isDevMode) {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-hourglass-half" style="margin-right: 8px; color: #facc15;"></i>Čekám na Vaši reakci...';
            if (isDevMode && data.status !== 'waiting') {
                data.discord_id = val;
            }
            authPollInterval = setInterval(() => pollAuth(data.discord_id), 8000);
        } else {
            showAuthView('discord');
            let errMsg = data.message ? data.message : "Toto ID neexistuje. Jestli problém přetrvává, jděte na náš Discord.";
            showLoginError(errMsg);
            inputIdentifier.disabled = false;
        }
    } catch(e) {
        showAuthView('discord');
        if (e.message === 'timeout') {
            showLoginError("Ověřování trvá déle než obvykle. Server se zřejmě probouzí ze spánku, zkuste to prosím znovu.");
        } else {
            showLoginError("Chyba spojení se serverem nebo neplatná data.");
        }
        inputIdentifier.disabled = false;
    }
});

async function pollAuth(discordId) {
    try {
        const isDevMode = false; // !__dirname.includes('app.asar');
        const res = await fetch(`${API_BASE}/api/app_check`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: discordId, hwid: currentHWID })
        });
        const data = await res.json();
        
        if (data.status === 'success' || isDevMode) {
            let titleEl = document.getElementById('login-waiting-title');
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-check-circle" style="margin-right: 8px; color: #22c55e;"></i>Schváleno! Přihlašuji...';
            if (isDevMode) {
                console.log("⚠️ VSC REŽIM: Ignoruji chybu Discord Pollingu.");
            }
            clearInterval(authPollInterval);
            let config = loadConfig();
            config.discord_id = discordId;
            config.discord_nick = data.display_name || (isDevMode ? "VSC-DEV" : "Neznámý");
            saveConfig(config);
            
            showAuthView('success');
            setTimeout(() => {
                loginOverlay.style.display = 'none';
                initLauncher(config);
            }, 2000);
        } else if (data.status === 'timeout') {
            clearInterval(authPollInterval);
            showAuthView('discord');
            showLoginError(data.message || "Čas vypršel (nedostatečná reakce). Zkuste to prosím znovu.");
            inputIdentifier.disabled = false;
        } else if (data.status === 'error') {
            clearInterval(authPollInterval);
            denialCount++;
            let lockoutMinutes = (denialCount === 1) ? 1 : 10;
            lockoutEndTime = Date.now() + (lockoutMinutes * 60 * 1000);
            localStorage.setItem('authDenialCount', denialCount);
            localStorage.setItem('authLockoutEndTime', lockoutEndTime);
            showAuthView('discord');
            startLockoutTimer();
        }
    } catch(e) {}
}

async function initLauncher(config) {
    try {
        if (hwidDisplay) hwidDisplay.innerText = config.discord_nick || currentHWID;
        
        // Získat roli z users tabulky s timeoutem
        try {
            const roleRes = await safeFetch(`${API_BASE}/api/launcher/user_info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discord_id: config.discord_id })
            }, 5000);
            if (roleRes.ok) {
                const data = await roleRes.json();
                if (data && data.status === 'success') {
                    currentUserRole = data.role || 'User';
                    config.user_role = currentUserRole;
                    saveConfig(config);

                    if (data.avatar_url) {
                        const avatarImg = document.querySelector('.user-info i.fa-user-circle');
                        if (avatarImg) {
                            const img = document.createElement('img');
                            img.src = data.avatar_url;
                            img.style.width = '40px';
                            img.style.height = '40px';
                            img.style.borderRadius = '50%';
                            img.style.marginRight = '10px';
                            img.style.objectFit = 'cover';
                            avatarImg.parentNode.replaceChild(img, avatarImg);
                        }
                    }
                    if (currentUserRole.includes('DEV') || currentUserRole.includes('SA')) {
                        const btnDevBuild = document.getElementById('btn-dev-build');
                        if (btnDevBuild) {
                            btnDevBuild.style.display = 'block';
                            if (!window.LC) {
                                btnDevBuild.addEventListener('click', () => {
                                    btnDevBuild.disabled = true;
                                    btnDevBuild.innerHTML = '<i class="fas fa-spinner fa-spin"></i> SPOUŠTÍM...';
                                    ipcRenderer.send('launch-dev-build');
                                });
                            }
                        }
                    }
                } else {
                    currentUserRole = config.user_role || 'User';
                }
            } else {
                currentUserRole = config.user_role || 'User';
            }
        } catch(eRole) {
            console.warn('[initLauncher] Nelze načíst roli ze serveru, použita uložená role:', eRole.message || eRole);
            currentUserRole = config.user_role || 'User';
        }
        
        let color = '#64748b'; // public
        if (currentUserRole.includes('DEV') || currentUserRole.includes('SA')) color = '#ef4444';
        else if (currentUserRole.includes('BT')) color = '#3b82f6';
        
        if (roleDisplay) {
            roleDisplay.innerText = currentUserRole.toUpperCase();
            roleDisplay.style.backgroundColor = color;
        }

        ensureCentralUserDataFolders();
        try {
            const versionsDir = path.join(userDataPath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const dirs = fs.readdirSync(versionsDir);
                dirs.forEach(d => backupUserRoutesFromVersion(path.join(versionsDir, d)));
            }
        } catch (_) {}

        await loadAvailableVersions();
    } catch(e) {
        console.error("Chyba při startu launcheru:", e);
        const overlay = document.getElementById('initial-loading-overlay');
        if (overlay) overlay.style.display = 'none';
        ensureCentralUserDataFolders();
        try {
            const versionsDir = path.join(userDataPath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const dirs = fs.readdirSync(versionsDir);
                dirs.forEach(d => backupUserRoutesFromVersion(path.join(versionsDir, d)));
            }
        } catch (_) {}

        await loadAvailableVersions();
    }
}

async function loadAvailableVersions() {
    document.getElementById('initial-loading-overlay').style.display = 'none';
    let dbVersions = [];
    isOfflineMode = false;
    const offlineBadge = document.getElementById('offline-badge');
    if (offlineBadge) offlineBadge.style.display = 'none';

    let cfg = loadConfig();
    let onlineFetchSuccess = false;

    if (navigator.onLine && !cfg.offline_mode) {
        try {
            let id_param = cfg.discord_id;
            if (!id_param && cfg.email) id_param = 'email-' + cfg.email; // Fallback
            const res = await safeFetch(`${API_BASE}/api/launcher/versions?discord_id=${id_param}`, {}, 6000);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'ok') {
                    dbVersions = data.versions || [];
                    if (data.user_role) currentUserRole = data.user_role;
                    onlineFetchSuccess = true;
                    // Uložit do offline mezipaměti pro případ výpadku sítě v budoucnu
                    saveLauncherCache({
                        saved_at: Date.now(),
                        versions: dbVersions,
                        user_role: currentUserRole,
                        discord_id: cfg.discord_id,
                        discord_nick: cfg.discord_nick
                    });
                } else if (data.status === 'banned') {
                    document.getElementById('initial-loading-overlay').style.display = 'flex';
                    document.getElementById('initial-loading-overlay').innerHTML = `
                        <div style="background: rgba(185, 28, 28, 0.9); padding: 40px; border-radius: 15px; border: 2px solid #ef4444; text-align: center; max-width: 500px; box-shadow: 0 0 40px rgba(239, 68, 68, 0.6); position: relative; overflow: hidden;">
                            <div style="position: relative; z-index: 2;">
                                <i class="fas fa-ban" style="font-size: 60px; color: white; margin-bottom: 20px;"></i>
                                <h1 style="color: white; margin-bottom: 15px; font-size: 28px; text-transform: uppercase;">Účet Zablokován</h1>
                                <p style="color: #fca5a5; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                                    Váš účet byl zablokován administrátorem.<br><br>
                                    Pokud se domníváte, že se jedná o omyl a chcete se odvolat, vytvořte si ticket na našem Discordu.
                                </p>
                                <button onclick="window.close()" style="background: #171717; border: 1px solid #404040; color: white; padding: 12px 30px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">UKONČIT LAUNCHER</button>
                            </div>
                        </div>
                    `;
                    return;
                } else {
                    console.error("Chyba při načítání verzí z API:", data.message);
                }
            }
        } catch(e) {
            console.warn("Síťová chyba při načítání verzí z API, přecházím na offline režim:", e.message || e);
        }
    }

    // Pokud se nepodařilo načíst online (výpadek sítě / serveru / offline)
    if (!onlineFetchSuccess) {
        isOfflineMode = true;
        if (offlineBadge) offlineBadge.style.display = 'inline-block';
        if (roleDisplay) {
            roleDisplay.innerText = `${currentUserRole.toUpperCase()} (OFFLINE)`;
        }

        const cached = loadLauncherCache();
        if (cached && Array.isArray(cached.versions) && cached.versions.length > 0) {
            dbVersions = cached.versions;
            if (cached.user_role) currentUserRole = cached.user_role;
            console.log(`[Launcher] Načteno ${dbVersions.length} verzí z offline mezipaměti.`);
        }
    }

    // Pokud nemáme ani mezipaměť (první instalace offline), prohledáme existující složky ve versions/
    if (dbVersions.length === 0) {
        const versionsDir = path.join(userDataPath, 'versions');
        if (fs.existsSync(versionsDir)) {
            try {
                const subdirs = fs.readdirSync(versionsDir);
                for (const dName of subdirs) {
                    const fPath = path.join(versionsDir, dName);
                    if (findExeInFolder(fPath)) {
                        dbVersions.push({
                            id: dName,
                            version_name: dName,
                            db_version: dName,
                            has_access: true,
                            can_launch: true,
                            show_in_launcher: true
                        });
                    }
                }
            } catch (_) {}
        }
    }

    if (dbVersions.length === 0) {
        dbVersions = [
            {
                id: 1,
                version_name: "OIS IDPK V1.6.2",
                db_version: "V1.6.2",
                file_url: "https://github.com/marek-1cz/IDPK-Palubni-Pocitac/releases/download/V1.6.2I/OIS-IDPK-V1.6.2.zip",
                target_role: "BT",
                has_access: (currentUserRole.includes('BT') || currentUserRole.includes('DEV') || currentUserRole.includes('SA')),
                can_download: true,
                can_launch: true,
                show_in_launcher: true
            },
            {
                id: 2,
                version_name: "OIS IDPK V1.6.1",
                db_version: "v1.6.1",
                file_url: "https://github.com/marek-1cz/IDPK-Palubni-Pocitac/releases/download/v1.6.1/OIS_IDPK_V1.6.1.zip",
                target_role: "User",
                has_access: true,
                can_download: true,
                can_launch: true,
                show_in_launcher: true
            }
        ];
    }

    let finalVersions = [];
    dbVersions.forEach(v => {
        // Pokud je viditelná, nebo pokud není viditelná, ale chceme ji do seznamu jako nedostupnou?
        // show_in_launcher false = úplně skrýt z roletky (aby se to chovalo čistě)
        if (v.show_in_launcher === false || v.show_in_launcher === "false") return;
        finalVersions.push(v);
    });

    versionSelect.innerHTML = '';
    
    if (finalVersions.length === 0) {
        const opt = document.createElement('option');
        opt.innerText = "Žádné verze k dispozici";
        versionSelect.appendChild(opt);
        launchText.innerText = "NENÍ CO HRÁT";
        launchIcon.className = "fas fa-times";
        btnLaunch.classList.add('btn-locked');
        return;
    }

    availableVersions = finalVersions;
    finalVersions.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.db_version;
        // Pokud nemá přístup nebo nemá právo stáhnout/spustit a ještě ji nemá
        if (!v.has_access) {
            opt.innerText = `${v.version_name} (Nedostupné pro tvoji roli)`;
            opt.disabled = true;
        } else {
            opt.innerText = v.version_name;
        }
        versionSelect.appendChild(opt);
    });

    // Najdeme první volitelnou, pokud existuje
    let firstEnabled = Array.from(versionSelect.options).find(o => !o.disabled);
    if (firstEnabled) {
        versionSelect.value = firstEnabled.value;
    }

    versionSelect.disabled = false;
    const cs2 = document.getElementById('custom-version-select'); if(cs2) cs2.classList.remove('disabled');
    updateCustomSelectUI(finalVersions);
    checkLocalVersion(versionSelect.value);
}

versionSelect.addEventListener('change', () => {
    checkLocalVersion(versionSelect.value);
});

function getVersionFolder(versionName) {
    const { app } = require('electron').remote || require('electron');
    // Using a fallback if remote isn't working easily in contextIsolation: false
    const userData = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
    return path.join(userData, 'versions', versionName);
}

function findExeInFolder(folder) {
    if (!folder || !fs.existsSync(folder)) return null;
    let files = [];
    try { files = fs.readdirSync(folder); } catch (_) {}
    let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
    if (exeFile) return path.join(folder, exeFile);
    let subFolder = path.join(folder, 'win-unpacked');
    if (fs.existsSync(subFolder)) {
        let subFiles = [];
        try { subFiles = fs.readdirSync(subFolder); } catch (_) {}
        let subExe = subFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
        if (subExe) return path.join(subFolder, subExe);
    }
    return null;
}

function getLocalBuildInfo(folder) {
    try {
        const buildFile = path.join(folder, 'build_info.json');
        if (fs.existsSync(buildFile)) {
            return JSON.parse(fs.readFileSync(buildFile, 'utf8'));
        }
        const subBuildFile = path.join(folder, 'win-unpacked', 'build_info.json');
        if (fs.existsSync(subBuildFile)) {
            return JSON.parse(fs.readFileSync(subBuildFile, 'utf8'));
        }
    } catch (e) {
        console.warn('Chyba při čtení build_info.json:', e);
    }
    return null;
}

function checkLocalVersion(versionName) {
    if (typeof updateLCLaunchState === 'function') updateLCLaunchState(versionName);
    const selectedVersion = availableVersions.find(v => v.db_version === versionName);
    if (!selectedVersion) {
        btnLaunch.classList.add('btn-locked');
        launchText.innerText = "ŽÁDNÉ VERZE K DISPOZICI";
        launchIcon.className = "fas fa-times";
        return;
    }

    const folder = getVersionFolder(versionName);
    const exePath = findExeInFolder(folder);
    const hasLocalCopy = Boolean(exePath);

    if (hasLocalCopy) {
        // Zabezpečení
        const versionFolder = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'versions', selectedVersion.db_version, 'win-unpacked');
        const isBlocked = (!selectedVersion.has_access || !selectedVersion.can_launch);
        secureExecutable(versionFolder, isBlocked);

        if (!selectedVersion.has_access) {
            const tr = selectedVersion.target_role ? selectedVersion.target_role.toLowerCase() : '';
            if (tr === 'bt' || tr.includes('beta') || tr.includes('tester')) {
                launchText.innerText = "PŘEDPLATITELÉ";
                launchIcon.className = "fas fa-lock";
                btnLaunch.classList.add('btn-locked');
                btnLaunch.title = "Dostupné pouze pro Beta Testery.\nPodpořte mě na BuyMeACoffee nebo HeroHero pro přístup!";
            } else {
                launchText.innerText = "NEMÁTE ROLI";
                launchIcon.className = "fas fa-lock";
                btnLaunch.classList.add('btn-locked');
                btnLaunch.title = "Nemáte dostatečnou roli (Vývojář/Admin) pro hraní této verze.";
            }
        } else if (!selectedVersion.can_launch) {
            launchText.innerText = "ZABLOKOVÁNO SPRÁVCEM SYSTÉMU";
            launchIcon.className = "fas fa-lock";
            btnLaunch.classList.add('btn-locked');
            btnLaunch.title = "Administrátor zakázal spouštění této verze.\nPro více informací navštivte Discord.";
        } else if (isOfflineMode) {
            // V OFFLINE REŽIMU: Neřešíme online databázi ani nové patche, rovnou povolíme spuštění naposledy uložené hry
            launchText.innerText = "SPUSTIT (OFFLINE)";
            launchIcon.className = "fas fa-play";
            btnLaunch.classList.remove('btn-locked');
            btnLaunch.disabled = false;
            btnLaunch.dataset.action = 'play';
            btnLaunch.title = "Spustit hru v offline režimu bez nutnosti internetového připojení.";
        } else {
            const localInfo = getLocalBuildInfo(folder);
            const localBuild = localInfo ? (localInfo.build || localInfo.current_build) : null;
            const remoteBuild = selectedVersion.current_build || selectedVersion.db_version;
            const patchUrl = selectedVersion.patch_url ? selectedVersion.patch_url.trim() : "";

            // Detekce novějšího buildu a zákaz spuštění dokud se nestáhne patch
            const isOutdated = Boolean(remoteBuild && localBuild && (localBuild.trim() !== remoteBuild.trim()));

            if (isOutdated) {
                launchText.innerText = `AKTUALIZOVAT (${remoteBuild})`;
                launchIcon.className = "fas fa-sync-alt";
                btnLaunch.classList.remove('btn-locked');
                btnLaunch.disabled = false;
                btnLaunch.dataset.action = 'patch';
                btnLaunch.title = `Je vyžadována aktualizace na build ${remoteBuild} (aktuálně máte ${localBuild}).\nSpuštění hry je zablokováno, dokud nestáhnete patch.`;
            } else if (patchUrl && remoteBuild && !localBuild && remoteBuild !== selectedVersion.db_version) {
                launchText.innerText = `AKTUALIZOVAT (${remoteBuild})`;
                launchIcon.className = "fas fa-sync-alt";
                btnLaunch.classList.remove('btn-locked');
                btnLaunch.disabled = false;
                btnLaunch.dataset.action = 'patch';
                btnLaunch.title = `Je vyžadována aktualizace na build ${remoteBuild}.\nKliknutím stáhnete rychlou aktualizaci bez mazání souborů.`;
            } else {
                launchText.innerText = "HRÁT";
                launchIcon.className = "fas fa-play";
                btnLaunch.classList.remove('btn-locked');
                btnLaunch.disabled = false;
                btnLaunch.dataset.action = 'play';
                btnLaunch.title = localBuild ? `Nainstalovaný build: ${localBuild}` : "";
            }
        }
    } else {
        if (isOfflineMode) {
            launchText.innerText = "OFFLINE (NENÍ STAŽENO)";
            launchIcon.className = "fas fa-ban";
            btnLaunch.classList.add('btn-locked');
            btnLaunch.disabled = true;
            btnLaunch.dataset.action = 'download';
            btnLaunch.title = "Tato verze není na tomto počítači stažena. Pro její první stažení se připojte k internetu.";
        } else if (!selectedVersion.has_access) {
            const tr = selectedVersion.target_role ? selectedVersion.target_role.toLowerCase() : '';
            if (tr === 'bt' || tr.includes('beta') || tr.includes('tester')) {
                launchText.innerText = "PŘEDPLATITELÉ";
                launchIcon.className = "fas fa-lock";
                btnLaunch.classList.add('btn-locked');
                btnLaunch.title = "Dostupné pouze pro Beta Testery.\nPodpořte mě na BuyMeACoffee nebo HeroHero pro přístup!";
            } else {
                launchText.innerText = "NEMÁTE ROLI";
                launchIcon.className = "fas fa-ban";
                btnLaunch.classList.add('btn-locked');
                btnLaunch.title = "Nemáte dostatečnou roli (Vývojář/Admin) pro stažení této verze.";
            }
        } else if (!selectedVersion.can_download) {
            launchText.innerText = "ZABLOKOVÁNO SPRÁVCEM SYSTÉMU";
            launchIcon.className = "fas fa-ban";
            btnLaunch.classList.add('btn-locked');
            btnLaunch.title = "Administrátor zakázal stahování této verze.\nPro více informací navštivte Discord.";
        } else {
            const remoteBuild = selectedVersion.current_build || selectedVersion.db_version;
            launchText.innerText = "STÁHNOUT";
            launchIcon.className = "fas fa-download";
            btnLaunch.classList.remove('btn-locked');
            btnLaunch.disabled = false;
            btnLaunch.dataset.action = 'download';
            btnLaunch.title = `Stáhnout instalaci verze ${versionName} (${remoteBuild})`;
        }
    }
}

let isLaunchingApp = false;

let lockedClickCount = 0;
let lockedClickTimer = null;

btnLaunch.addEventListener('click', async () => {
    if (window.LC) {
        // Nový launcher vysílá lc:launch – zabránit duplicitnímu spuštění hry
        return;
    }
    if (btnLaunch.classList.contains('btn-locked')) {
        lockedClickCount++;
        clearTimeout(lockedClickTimer);
        lockedClickTimer = setTimeout(() => { lockedClickCount = 0; }, 2000);
        
        if (lockedClickCount >= 1) {
            alert('Spuštění nebo stažení této verze máte aktuálně zablokované.\nPokud si myslíte, že je to chyba, obraťte se prosím na náš Discord.');
            lockedClickCount = 0;
        }
        return;
    }

    if (isLaunchingApp) return;
    isLaunchingApp = true;
    btnLaunch.classList.add('btn-locked');

    const versionName = versionSelect.value;
    const folder = getVersionFolder(versionName);

    // Pokud jsme v Offline režimu, spouštíme ihned bez online dotazování na server
    if (isOfflineMode) {
        const exePath = findExeInFolder(folder);
        if (exePath) {
            launchApp(exePath);
        } else {
            alert("Spustitelný soubor .exe nebyl ve složce nalezen.");
            isLaunchingApp = false;
            checkLocalVersion(versionName);
        }
        return;
    }

    // Blesková ověřovací kontrola (pouze pokud jsme online)
    if (navigator.onLine) {
        try {
            let cfg = loadConfig();
            let id_param = cfg.discord_id;
            if (!id_param && cfg.email) id_param = 'email-' + cfg.email;
            const resCheck = await fetch(`${API_BASE}/api/launcher/versions?discord_id=${id_param}`);
            const dataCheck = await resCheck.json();
            if (dataCheck.status === 'ok') {
                const currentV = dataCheck.versions.find(v => v.db_version === versionName);
                if (currentV) {
                    let localV = availableVersions.find(v => v.db_version === versionName);
                    if (localV) {
                        localV.can_launch = currentV.can_launch;
                        localV.can_download = currentV.can_download;
                        localV.has_access = currentV.has_access;
                        localV.current_build = currentV.current_build;
                        localV.patch_url = currentV.patch_url;
                    }
                    if (!currentV.has_access) {
                        alert("Ztratil jsi oprávnění k této verzi.");
                        isLaunchingApp = false;
                        checkLocalVersion(versionName);
                        return;
                    }
                }
            } else if (dataCheck.status === 'error') {
                alert(dataCheck.message || "Launcher je dočasně uzamčen.");
                isLaunchingApp = false;
                btnLaunch.classList.add('btn-locked');
                return;
            }
        } catch (e) {
            console.error("Nepodařilo se ověřit oprávnění po síti:", e);
        }
    }
        
    const selectedVersion = availableVersions.find(v => v.db_version === versionName);

    // Pokud uživatel klikl na AKTUALIZOVAT (rychlý opravný patch)
    if (btnLaunch.dataset.action === 'patch') {
        const patchUrl = selectedVersion ? (selectedVersion.patch_url || "").trim() : "";
        const targetBuild = selectedVersion ? (selectedVersion.current_build || selectedVersion.db_version) : versionName;
        if (!patchUrl) {
            alert(`Tato verze vyžaduje aktualizaci na build ${targetBuild}, ale v administraci zatím není zadán odkaz na patch balíček.`);
            isLaunchingApp = false;
            return;
        }
        isLaunchingApp = false;
        await downloadAndApplyPatch(versionName, folder, patchUrl, targetBuild);
        return;
    }

    // Budeme hledat jakýkoliv .exe soubor v adresáři
    
    if (fs.existsSync(folder)) {
        let files = [];
        try { files = fs.readdirSync(folder); } catch(e){}
        let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
        
        if (exeFile) {
            const vInfo1 = availableVersions.find(v => v.db_version === versionName);
            if (vInfo1 && !vInfo1.can_launch) {
                alert("Spuštění této verze je aktuálně zakázáno.\nPro více informací se prosím obraťte na náš Discord.");
                isLaunchingApp = false;
                checkLocalVersion(versionName);
                return;
            }
            launchApp(path.join(folder, exeFile));
            return;
        }

        // Check inside win-unpacked
        let subFolder = path.join(folder, 'win-unpacked');
        if (fs.existsSync(subFolder)) {
            let subFiles = [];
            try { subFiles = fs.readdirSync(subFolder); } catch(e){}
            let subExe = subFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
            if (subExe) {
                const vInfo2 = availableVersions.find(v => v.db_version === versionName);
                if (vInfo2 && !vInfo2.can_launch) {
                    alert("Spuštění této verze je aktuálně zakázáno.\nPro více informací se prosím obraťte na náš Discord.");
                    isLaunchingApp = false;
                    checkLocalVersion(versionName);
                    return;
                }
                launchApp(path.join(subFolder, subExe));
                return;
            }
        }
    }

    // Potřebujeme stáhnout!
    const vInfo3 = availableVersions.find(v => v.db_version === versionName);
    if (vInfo3 && !vInfo3.can_download) {
        alert("Stahování této verze máte aktuálně zablokované.\nPokud si myslíte, že je to chyba, obraťte se prosím na náš Discord.");
        isLaunchingApp = false;
        checkLocalVersion(versionName);
        return;
    }
    await downloadVersion(versionName, folder);
});

async function downloadVersion(versionName, folder) {
    btnLaunch.classList.add('btn-locked');
    versionSelect.disabled = true;
const cs1 = document.getElementById('custom-version-select'); if(cs1) cs1.classList.add('disabled');
    launchText.innerText = "STAHOVÁNÍ...";
    launchIcon.className = "fas fa-spinner fa-spin";
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.innerText = 'Příprava ke stažení...';
    if (window.LC && window.LC.showDownload) {
        window.LC.showDownload(true, { title: `Stahování verze ${versionName}` });
        window.LC.setLaunchState('downloading', 'Stahování…');
        window.LC.setProgress({ pct: 0, phase: 0, speed: '—', done: '0 MB', eta: '—', sub: 'Příprava ke stažení...' });
    }

    try {
        // Najít vybranou verzi v seznamu stažených dat
        const selectedVersion = availableVersions.find(v => v.db_version === versionName);
        
        if (!selectedVersion || !selectedVersion.file_url) {
            showError(`Verze ${versionName} nemá nastavený odkaz ke stažení v databázi!`);
            return;
        }

        const downloadUrl = selectedVersion.file_url.split(',')[0].trim(); // V případě více odkazů vezmeme první
        
        if (!downloadUrl) {
            showError(`Neplatný odkaz ke stažení pro verzi ${versionName}.`);
            return;
        }

        downloadAndExtract(downloadUrl, folder, versionName);
    } catch(e) {
        showError(e.message);
    }
}

async function downloadAndExtract(url, folder, versionName) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const zipPath = path.join(folder, 'app_download.zip');

    btnLaunch.classList.add('btn-locked');
    btnLaunch.disabled = true;
    versionSelect.disabled = true;
    const cs1 = document.getElementById('custom-version-select');
    if (cs1) cs1.classList.add('disabled');

    launchText.innerText = "STAHOVÁNÍ...";
    launchIcon.className = "fas fa-spinner fa-spin";
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.innerText = 'Příprava ke stažení...';

    try {
        await downloadFileWithProgress({
            url: url,
            destPath: zipPath,
            onProgress: (downloaded, total, percent, speedMBps) => {
                if (total > 0) {
                    progressFill.style.width = percent + '%';
                    const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
                    const totMB = (total / (1024 * 1024)).toFixed(1);
                    progressText.innerText = `Stahování: ${percent}% (${dlMB} / ${totMB} MB, ${speedMBps} MB/s)`;
                    if (window.LC && window.LC.setProgress) {
                        const remBytes = Math.max(0, total - downloaded);
                        const speedBytes = (parseFloat(speedMBps) || 1) * 1024 * 1024;
                        const etaSec = speedBytes > 0 ? Math.ceil(remBytes / speedBytes) : 0;
                        window.LC.setProgress({
                            pct: percent * 0.8,
                            phase: 0,
                            speed: `${speedMBps} MB/s`,
                            done: `${dlMB} / ${totMB} MB`,
                            eta: etaSec > 0 ? `${etaSec} s` : '—',
                            sub: 'Stahování souborů hry…'
                        });
                    }
                } else {
                    const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
                    progressText.innerText = `Stahování: ${dlMB} MB (${speedMBps} MB/s)`;
                }
            }
        });

        // 1. Ověřit platnost ZIPu před jakoukoliv operací
        const zipCheck = isValidZipFile(zipPath);
        if (!zipCheck.valid) {
            try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) {}
            throw new Error(`Stažený soubor je neplatný: ${zipCheck.reason}`);
        }

        progressText.innerText = 'Rozbalování... (může trvat minutu)';
        launchText.innerText = 'ROZBALOVÁNÍ...';
        if (window.LC && window.LC.setProgress) {
            window.LC.setProgress({ pct: 85, phase: 1, speed: '—', sub: 'Rozbalování souborů hry…' });
        }

        // 2. Smazat existující soubory před rozbalením (kromě ZIPu) pro prevenci chyb ENOENT
        if (fs.existsSync(folder)) {
            let existingFiles = await fs.promises.readdir(folder);
            for (let f of existingFiles) {
                if (f !== 'app_download.zip') {
                    try {
                        await fs.promises.rm(path.join(folder, f), { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
                    } catch (err) {
                        console.warn("Nemohu smazat soubor před rozbalením:", f, err);
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1500));
        }

        // 3. Rozbalení archivu
        let originalNoAsar = process.noAsar;
        process.noAsar = true;
        try {
            await extract(zipPath, { dir: folder });
        } finally {
            process.noAsar = originalNoAsar;
            try { if (fs.existsSync(zipPath)) await fs.promises.unlink(zipPath); } catch (_) {}
        }

        // 4. Uložit výchozí build_info.json po plném stažení
        try {
            const curV = availableVersions.find(v => v.db_version === versionName);
            const initBuild = (curV && curV.current_build) ? curV.current_build : versionName;
            const bData = {
                version: versionName,
                build: initBuild,
                updated_at: new Date().toLocaleString('cs-CZ')
            };
            const bJson = JSON.stringify(bData, null, 2);
            fs.writeFileSync(path.join(folder, 'build_info.json'), bJson, 'utf8');
            const subWinF = path.join(folder, 'win-unpacked');
            if (fs.existsSync(subWinF)) {
                fs.writeFileSync(path.join(subWinF, 'build_info.json'), bJson, 'utf8');
            }
        } catch (eBuild) {
            console.warn("Nepodařilo se uložit výchozí build_info.json:", eBuild);
        }

        // 5. Najít EXE
        let exePath = null;
        let files = await fs.promises.readdir(folder);
        let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
        if (exeFile) {
            exePath = path.join(folder, exeFile);
        } else if (fs.existsSync(path.join(folder, 'win-unpacked'))) {
            let subFiles = await fs.promises.readdir(path.join(folder, 'win-unpacked'));
            let subExe = subFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
            if (subExe) exePath = path.join(folder, 'win-unpacked', subExe);
        }

        if (!exePath) {
            showError("Staženo a rozbaleno, ale nenašel jsem spouštěcí .exe soubor.");
            return;
        }

        if (window.LC && window.LC.setProgress) {
            window.LC.setProgress({ pct: 95, phase: 2, speed: '—', sub: 'Zabezpečení spustitelného souboru…' });
        }
        // 6. Zabezpečení
        const selectedVersion = availableVersions.find(v => v.db_version === versionName);
        const isBlocked = (!selectedVersion || !selectedVersion.has_access || !selectedVersion.can_launch);
        secureExecutable(path.dirname(exePath), isBlocked);

        // 7. Synchronizace uživatelských dat
        const versionsDir = path.join(userDataPath, 'versions');
        let otherVersions = [];
        if (fs.existsSync(versionsDir)) {
            try {
                const allDirs = fs.readdirSync(versionsDir);
                otherVersions = allDirs.filter(d => d !== versionName && findExeInFolder(path.join(versionsDir, d)));
            } catch (_) {}
        }

        otherVersions.forEach(oldV => {
            backupUserRoutesFromVersion(path.join(versionsDir, oldV));
        });
        syncUserRoutesToVersion(folder);

        progressContainer.style.display = 'none';
        launchText.innerText = "STAŽENO";
        launchIcon.className = "fas fa-check";
        if (window.LC) {
            window.LC.setProgress({ pct: 100, phase: 3, speed: '—', sub: 'Dokončeno' });
            window.LC.showDownload(false);
            if (typeof syncWithLCVersions === 'function') syncWithLCVersions();
            if (typeof updateLCLaunchState === 'function') updateLCLaunchState(versionName);
            window.LC.toast('ok', 'Hotovo!', `Verze ${versionName} je nainstalována.`);
            if (typeof openCleanup === 'function') openCleanup();
        }

        // 8. Otázkové okno pro odinstalaci starých verzí
        if (otherVersions.length > 0) {
            btnLaunch.classList.remove('btn-locked');
            btnLaunch.disabled = false;
            versionSelect.disabled = false;
            if (cs1) cs1.classList.remove('disabled');
            showNewVersionCleanupPrompt(versionName, otherVersions, exePath, !isBlocked);
        } else {
            if (!isBlocked) {
                launchApp(exePath);
            } else {
                btnLaunch.classList.add('btn-locked');
                btnLaunch.disabled = true;
                checkLocalVersion(versionName);
            }
        }
    } catch (e) {
        try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) {}
        progressContainer.style.display = 'none';
        btnLaunch.classList.remove('btn-locked');
        btnLaunch.disabled = false;
        versionSelect.disabled = false;
        if (cs1) cs1.classList.remove('disabled');
        showError("Chyba při stahování/rozbalování: " + e.message);
        if (window.LC) {
            window.LC.showDownload(false);
            window.LC.showError("Chyba při stahování", e.message || String(e));
            window.LC.setLaunchState('error');
        }
        checkLocalVersion(versionName);
    }
}

async function downloadAndApplyPatch(versionName, folder, patchUrl, targetBuild) {
    if (!patchUrl || !patchUrl.trim()) {
        showError("Pro tuto verzi nebyl nastaven odkaz na patch balíček v databázi.");
        checkLocalVersion(versionName);
        return;
    }

    btnLaunch.classList.add('btn-locked');
    btnLaunch.disabled = true;
    versionSelect.disabled = true;
    const cs1 = document.getElementById('custom-version-select');
    if (cs1) cs1.classList.add('disabled');

    launchText.innerText = "AKTUALIZACE...";
    launchIcon.className = "fas fa-spinner fa-spin";
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.innerText = `Příprava aktualizace (${targetBuild})...`;

    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const patchZipPath = path.join(folder, 'patch_download.zip');

    try {
        await downloadFileWithProgress({
            url: patchUrl.trim(),
            destPath: patchZipPath,
            onProgress: (downloaded, total, percent, speedMBps) => {
                if (total > 0) {
                    progressFill.style.width = percent + '%';
                    const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
                    const totMB = (total / (1024 * 1024)).toFixed(1);
                    progressText.innerText = `Stahování aktualizace: ${percent}% (${dlMB} / ${totMB} MB, ${speedMBps} MB/s)`;
                } else {
                    const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
                    progressText.innerText = `Stahování aktualizace: ${dlMB} MB (${speedMBps} MB/s)`;
                }
            }
        });

        // Ověřit platnost archivu před rozbalením
        const zipCheck = isValidZipFile(patchZipPath);
        if (!zipCheck.valid) {
            try { if (fs.existsSync(patchZipPath)) fs.unlinkSync(patchZipPath); } catch (_) {}
            throw new Error(`Stažený patch balíček je neplatný: ${zipCheck.reason}`);
        }

        progressText.innerText = 'Instalace aktualizace... (přepisování souborů)';
        launchText.innerText = 'INSTALACE...';

        let originalNoAsar = process.noAsar;
        process.noAsar = true;

        let extractDir = folder;
        if (!fs.existsSync(path.join(folder, 'resources')) && fs.existsSync(path.join(folder, 'win-unpacked', 'resources'))) {
            extractDir = path.join(folder, 'win-unpacked');
        }

        try {
            await extract(patchZipPath, { dir: extractDir });
        } finally {
            process.noAsar = originalNoAsar;
            try { if (fs.existsSync(patchZipPath)) await fs.promises.unlink(patchZipPath); } catch (_) {}
        }

        // Uložit build_info.json s novým číslem buildu
        const buildData = {
            version: versionName,
            build: targetBuild,
            current_build: targetBuild,
            updated_at: new Date().toLocaleString('cs-CZ')
        };
        const buildJsonStr = JSON.stringify(buildData, null, 2);
        try { fs.writeFileSync(path.join(folder, 'build_info.json'), buildJsonStr, 'utf8'); } catch (_) {}
        try {
            const subF = path.join(folder, 'win-unpacked');
            if (fs.existsSync(subF)) {
                fs.writeFileSync(path.join(subF, 'build_info.json'), buildJsonStr, 'utf8');
            }
        } catch (_) {}

        progressFill.style.width = '100%';
        progressText.innerText = `Aktualizace na ${targetBuild} byla úspěšně dokončena!`;
        await new Promise(r => setTimeout(r, 600));
        progressContainer.style.display = 'none';

        btnLaunch.classList.remove('btn-locked');
        btnLaunch.disabled = false;
        versionSelect.disabled = false;
        if (cs1) cs1.classList.remove('disabled');

        checkLocalVersion(versionName);
        alert(`✅ Aktualizace na build ${targetBuild} byla úspěšně nainstalována!\nNyní můžete spustit hru tlačítkem HRÁT.`);
    } catch (err) {
        try { if (fs.existsSync(patchZipPath)) fs.unlinkSync(patchZipPath); } catch (_) {}
        progressContainer.style.display = 'none';
        btnLaunch.classList.remove('btn-locked');
        btnLaunch.disabled = false;
        versionSelect.disabled = false;
        if (cs1) cs1.classList.remove('disabled');
        showError("Chyba při instalaci aktualizace: " + err.message);
        checkLocalVersion(versionName);
    }
}

function launchApp(exePath) {
    progressContainer.style.display = 'none';
    launchText.innerText = "SPUŠTĚNO";
    launchIcon.className = "fas fa-check";

    // Uložíme konfiguraci
    let config = loadConfig();
    config.last_version = versionSelect.value;
        
    // Získáme cestu k aktuálnímu Launcheru (pokud není balen, tak použijeme process.execPath electronu,
    // ale pokud chceme spouštět zástupce, udržíme process.execPath)
    config.launcher_path = process.execPath;
    saveConfig(config);
    
    // Spustit s parametrem --no-launcher, aby neotevřel znovu launcher!
    const proc = spawn(exePath, ['--no-launcher'], {
        detached: true,
        stdio: 'ignore'
    });
    proc.unref();
    
    // Ukončit Launcher
    setTimeout(() => {
        ipcRenderer.send('quit-app');
    }, 1000);
}

// V Electronu je inline skript ve <body> spuštěn až PO DOMContentLoaded,
// proto stačí přímé volání bez listeneru.
// Tlačítko manuální kontroly aktualizace Launcheru
const btnCheckLauncherUpdate = document.getElementById('btn-check-launcher-update');
if (btnCheckLauncherUpdate) {
    btnCheckLauncherUpdate.addEventListener('click', async () => {
        const icon = document.getElementById('btn-check-launcher-icon');
        const text = document.getElementById('btn-check-launcher-text');
        if (icon) icon.className = 'fas fa-spinner fa-spin';
        if (text) text.innerText = 'Kontroluji...';
        btnCheckLauncherUpdate.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/api/launcher/check_update?current_version=${encodeURIComponent(LAUNCHER_VERSION)}`);
            const data = await res.json();
            if (data && data.status === 'ok') {
                const remoteVer = data.latest_version || '1.0.0';
                if (data.has_update && data.download_url && isNewerVersion(remoteVer, LAUNCHER_VERSION)) {
                    await downloadAndInstallLauncherUpdate(data.download_url, remoteVer);
                    return;
                } else {
                    alert(`Váš Launcher je aktuální (verze v${LAUNCHER_VERSION}).`);
                }
            } else {
                alert('Nepodařilo se ověřit aktualizace: ' + (data?.message || 'Neznámá chyba'));
            }
        } catch(e) {
            alert('Chyba spojení se serverem: ' + e.message);
        } finally {
            if (icon) icon.className = 'fas fa-sync-alt';
            if (text) text.innerText = 'Zkontrolovat aktualizace Launcheru';
            btnCheckLauncherUpdate.disabled = false;
        }
    });
}

checkAuthAndInit();

function showError(msg) {
    const errBox = document.getElementById('launcher-error-message');
    const errText = document.getElementById('launcher-error-text');
    if (errBox && errText) {
        errText.innerText = msg;
        errBox.style.display = 'block';
    } else {
        alert(msg);
    }
    
    isLaunchingApp = false;
    btnLaunch.classList.remove('btn-locked'); btnLaunch.disabled = false;
    versionSelect.disabled = false;
const cs2 = document.getElementById('custom-version-select'); if(cs2) cs2.classList.remove('disabled');
    launchText.innerText = "CHYBA";
    launchIcon.className = "fas fa-exclamation-triangle";
    progressContainer.style.display = 'none';
    checkLocalVersion(versionSelect.value);
    
    // Odeslání logu o chybě do Discordu
    let config = loadConfig();
    if (config && config.discord_id) {
        fetch('https://datacorebot.koyeb.app/api/report_error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                discord_id: config.discord_id,
                nick: config.discord_nick || "Neznámý",
                type: "LAUNCHER ERROR",
                message: msg
            })
        }).catch(() => {});
    }
}

function getHWID() {
    return new Promise((resolve) => {
        let isDone = false;
        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                resolve("FALLBACK-HWID-" + Math.random().toString(36).substr(2, 9));
            }
        }, 2000);

        if (process.platform === 'win32') {
            exec('wmic csproduct get uuid', (err, stdout) => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);
                if (err) resolve("UNKNOWN-HWID-UPDATER-" + Math.random().toString(36).substr(2, 9));
                else {
                    let lines = stdout.split('\n');
                    if (lines.length > 1 && lines[1].trim()) resolve(lines[1].trim());
                    else resolve("UNKNOWN-HWID-UPDATER-" + Math.random().toString(36).substr(2, 9));
                }
            });
        } else {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            resolve("NOT-WINDOWS-" + Math.random().toString(36).substr(2, 9));
        }
    });
}

// ============================================================
// SETTINGS PANEL LOGIKA
// ============================================================
const sidebarBtnGame = document.getElementById('sidebar-btn-game');
const sidebarBtnSettings = document.getElementById('sidebar-btn-settings');
const mainContentGame = document.getElementById('main-content-game');
const mainContentSettings = document.getElementById('main-content-settings');

if (sidebarBtnGame && sidebarBtnSettings) {
    sidebarBtnGame.addEventListener('click', () => {
        sidebarBtnGame.classList.add('active');
        sidebarBtnSettings.classList.remove('active');
        if (mainContentGame) mainContentGame.style.display = '';
        if (mainContentSettings) mainContentSettings.style.display = 'none';
    });

    sidebarBtnSettings.addEventListener('click', () => {
        sidebarBtnSettings.classList.add('active');
        sidebarBtnGame.classList.remove('active');
        if (mainContentGame) mainContentGame.style.display = 'none';
        if (mainContentSettings) mainContentSettings.style.display = '';
        updateSettingsVersionList();
    });
}

// Aktualizovat seznam verzí v settings
function updateSettingsVersionList() {
    const listEl = document.getElementById('settings-versions-list');
    const appVerEl = document.getElementById('settings-app-version');
    if (!listEl) return;
    
    // Zjistit nejnovější verzi z načtených (největší ID, pole je už seřazené od nejnovější v loadAvailableVersions)
    if (appVerEl && availableVersions && availableVersions.length > 0) {
        const latest = availableVersions[0];
        appVerEl.innerHTML = `Poslední dostupná hra: <strong style="color:white;">${latest.version_name}</strong>`;
    } else if (appVerEl) {
        appVerEl.textContent = `Poslední dostupná hra: Žádná`;
    }

    if (!availableVersions || availableVersions.length === 0) {
        listEl.textContent = 'Přihlaste se pro zobrazení dostupných verzí.';
        return;
    }
    listEl.innerHTML = availableVersions.map(v => 
        `<div style="padding:3px 0;">• <b style="color:white;">${v.version_name}</b> <span style="color:#64748b;">(${v.target_role || 'User'})</span></div>`
    ).join('');
}

// Zkontrolovat aktualizace
const btnCheckUpdate = document.getElementById('btn-check-update');
if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
        btnCheckUpdate.disabled = true;
        btnCheckUpdate.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:10px; color:#3b82f6;"></i>Kontroluji...';
        try {
            ensureCentralUserDataFolders();
        try {
            const versionsDir = path.join(userDataPath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const dirs = fs.readdirSync(versionsDir);
                dirs.forEach(d => backupUserRoutesFromVersion(path.join(versionsDir, d)));
            }
        } catch (_) {}

        await loadAvailableVersions();
            updateSettingsVersionList();
            alert('Aktualizace zkontrolovány! Seznam verzí byl obnoven.');
        } catch(e) {
            alert('Chyba při kontrole aktualizací: ' + e.message);
        } finally {
            btnCheckUpdate.disabled = false;
            btnCheckUpdate.innerHTML = '<i class="fas fa-sync-alt" style="margin-right:10px; color:#3b82f6;"></i>Zkontrolovat aktualizace';
        }
    });
}

// Koupit předplatné
const btnBuyCoffee = document.getElementById('btn-buy-coffee');
if (btnBuyCoffee) {
    btnBuyCoffee.addEventListener('click', () => {
        const { shell } = require('electron');
        shell.openExternal('https://buymeacoffee.com/marekk_czz');
    });
}

// Otevřít složku s uživatelskými daty
const btnOpenUserdata = document.getElementById('btn-open-userdata');
if (btnOpenUserdata) {
    btnOpenUserdata.addEventListener('click', () => {
        ensureCentralUserDataFolders();
        const { shell } = require('electron');
        shell.openPath(centralUserDataPath);
    });
}

// Otevřít složku vlastních linek
const btnOpenCustomRoutes = document.getElementById('btn-open-custom-routes');
if (btnOpenCustomRoutes) {
    btnOpenCustomRoutes.addEventListener('click', () => {
        ensureCentralUserDataFolders();
        const { shell } = require('electron');
        shell.openPath(path.join(centralUserDataPath, 'linky'));
    });
}

// Vyčistit staré verze
const btnCleanOldVersions = document.getElementById('btn-clean-old-versions');
const deleteModal = document.getElementById('delete-versions-modal');
const deleteList = document.getElementById('delete-versions-list');
const btnCloseDeleteModal = document.getElementById('btn-close-delete-modal');
const btnConfirmDelete = document.getElementById('btn-confirm-delete-versions');

async function forceDeleteFolderAsync(folderPath) {
    try {
        await fs.promises.rm(folderPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        return true;
    } catch (error) {
        // Fallback pro otravné ENOTEMPTY a zamknuté Windows soubory
        if (os.platform() === 'win32') {
            return new Promise((resolve) => {
                exec(`rmdir /s /q "${folderPath}"`, (err) => {
                    if (err && fs.existsSync(folderPath)) {
                        console.error("Fallback deletion failed:", err);
                        alert(`Upozornění: Některé soubory mohly zůstat, protože jsou momentálně používány systémem. (Chyba: ${error.code || error.message})`);
                    }
                    resolve(true); // Dokončíme jako úspěšné, i když něco málo zbylo
                });
            });
        }
        
        console.error("Failed to delete folder:", folderPath, error);
        throw new Error(`Nepodařilo se smazat složku: ${error.message}`);
    }
}

if (btnCleanOldVersions && deleteModal) {
    btnCleanOldVersions.addEventListener('click', () => {
        const versionsDir = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'versions');
        if (!fs.existsSync(versionsDir)) {
            alert('Žádné verze k odstranění nenalezeny.');
            return;
        }
        const dirs = fs.readdirSync(versionsDir);
        if (dirs.length === 0) {
            alert('Složka verzí je prázdná.');
            return;
        }
        
        let htmlContent = '';
        dirs.forEach(d => {
            const isCurrent = (d === versionSelect.value);
            htmlContent += `
                <div style="display:flex; align-items:center; margin-bottom:8px; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px;">
                    <input type="checkbox" id="chk-del-${d}" class="del-ver-chk" value="${d}" style="margin-right:10px; cursor:pointer;">
                    <label for="chk-del-${d}" style="color:white; cursor:pointer; flex:1;">
                        ${d} ${isCurrent ? '<span style="color:#f59e0b; font-size:11px; margin-left:10px;">(Právě vybráno)</span>' : ''}
                    </label>
                </div>
            `;
        });
        deleteList.innerHTML = htmlContent;
        deleteModal.style.display = 'flex';
    });

    btnCloseDeleteModal.addEventListener('click', () => {
        deleteModal.style.display = 'none';
    });

    btnConfirmDelete.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.del-ver-chk:checked');
        const toDelete = Array.from(checkboxes).map(chk => chk.value);
        
        if (toDelete.length === 0) {
            alert("Nebyly vybrány žádné verze ke smazání.");
            return;
        }
        
        const confirmed = confirm(`Opravdu chcete smazat ${toDelete.length} verzí?`);
        if (!confirmed) return;
        
        btnConfirmDelete.disabled = true;
        btnConfirmDelete.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Mažu...';
        
        setTimeout(async () => {
            const versionsDir = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'versions');
            let success = 0;
            
            try {
                for (const d of toDelete) {
                    const fullPath = path.join(versionsDir, d);
                    // Záloha uživatelských linek a dat před smazáním složky
                    backupUserRoutesFromVersion(fullPath);
                    // Voláme asynchronní mazání
                    await forceDeleteFolderAsync(fullPath);
                    success++;
                }
                
                alert(`Smazáno (nebo promazáno) ${success} vybraných verzí.`);
            } catch(e) {
                console.error(e);
                alert("Došlo k nečekané chybě: " + e.message);
            } finally {
                btnConfirmDelete.disabled = false;
                btnConfirmDelete.innerHTML = "Smazat vybrané";
                deleteModal.style.display = 'none';
                
                // Re-render the dropdown
                const val = versionSelect.value;
                versionSelect.innerHTML = '';
                loadAvailableVersions();
                setTimeout(() => {
                    versionSelect.value = val;
                    checkLocalVersion(val);
                }, 500);
            }
        }, 100);
    });
}

// Smazat všechna stažená data
const btnDeleteAllData = document.getElementById('btn-delete-all-data');
if (btnDeleteAllData) {
    btnDeleteAllData.addEventListener('click', () => {
        const confirmed = confirm(
            '⚠️ VAROVÁNÍ ⚠️\n\n' +
            'Tato akce smaže VŠECHNY stažené verze hry.\n\n' +
            'Vaše vlastní data (zvuky, obraz, linky ve složce "userdata") NEBUDOU smazána.\n\n' +
            'Po smazání bude nutné znovu stáhnout hru přes Launcher.\n\n' +
            'Chcete pokračovat?'
        );
        if (!confirmed) return;
        try {
            const versionsDir = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'versions');
            if (fs.existsSync(versionsDir)) {
                // Smažeme přímo přes cmd, aby nedošlo k zamrznutí nebo ENOTEMPTY
                const { execSync } = require('child_process');
                execSync(`rmdir /s /q "${versionsDir}"`);
                fs.mkdirSync(versionsDir, {recursive: true});
            }
            alert('Hotovo! Všechna stažená data byla smazána. Při příštím spuštění se hra stáhne znovu.');
            checkLocalVersion(versionSelect.value);
        } catch(e) {
            alert('Chyba při mazání: ' + e.message);
        }
    });
}

// Discord odkaz
const settingsDiscordLink = document.getElementById('settings-discord-link');

// Smazat Cache
const btnCleanCache = document.getElementById('btn-clean-cache');
if (btnCleanCache) {
    btnCleanCache.addEventListener('click', () => {
        const confirmed = confirm('Tato akce smaže dočasné soubory prohlížeče (Cache, mezipaměť), aby se uvolnilo místo.\n\nVaše nastavení, uživatelská data ani samotná hra se nesmažou.\n\nPokračovat?');
        if (!confirmed) return;
        
        const appData = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac');
        const foldersToClean = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'blob_storage', 'Network', 'logs'];
        
        btnCleanCache.disabled = true;
        let oldText = btnCleanCache.innerHTML;
        btnCleanCache.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Čištění...';

        setTimeout(async () => {
            let deleted = 0;
            let errors = [];
            
            for (const f of foldersToClean) {
                const fPath = path.join(appData, f);
                if (fs.existsSync(fPath)) {
                    try {
                        // Smažeme to asynchronně. Bez opakování, protože cache soubory drží Electron napořád.
                        await fs.promises.rm(fPath, { recursive: true, force: true });
                        deleted++;
                    } catch (err) {
                        errors.push(`${f}: ${err.message}`);
                    }
                }
            }
            
            btnCleanCache.disabled = false;
            btnCleanCache.innerHTML = oldText;

            alert('Mezipaměť vyčištěna.');
        }, 50);
    });
}


// Custom select – přímá inicializace (DOM je již připraven)
(function initCustomSelect() {
    const customSelect = document.getElementById('custom-version-select');
    const customTrigger = document.getElementById('custom-select-trigger');

    if (!customSelect || !customTrigger) return;

    customTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!customSelect.classList.contains('disabled')) {
            customSelect.classList.toggle('open');
        }
    });

    document.addEventListener('click', (e) => {
        if (!customSelect.contains(e.target)) {
            customSelect.classList.remove('open');
        }
    });
})();


function updateCustomSelectUI(versions) {
    const customOptions = document.getElementById('custom-options-container');
    const customText = document.getElementById('custom-select-text');
    const customSelect = document.getElementById('custom-version-select');
    if (!customOptions) return;
    customOptions.innerHTML = '';
    
    versions.forEach(v => {
        const div = document.createElement('div');
        div.className = 'custom-option';
        
        let txt = v.db_version;
        if (v.current_build && v.current_build !== v.db_version) {
            txt = `${v.db_version} (${v.current_build})`;
        }
        let desc = '';
        let isBeta = false;
        if (!v.has_access) {
            const tr = v.target_role ? v.target_role.toLowerCase() : '';
            if (tr === 'bt' || tr.includes('beta') || tr.includes('tester') || tr.includes('předplatitel') || tr.includes('predplatitel')) {
                desc = "(Pouze pro předplatitele a Beta testery)";
                isBeta = true;
            } else {
                desc = "(Nedostupné pro tvojí roli)";
            }
        }
        
        const tDiv = document.createElement('div');
        tDiv.className = 'custom-option-title';
        tDiv.innerText = txt;
        div.appendChild(tDiv);
        
        if (desc) {
            const dDiv = document.createElement('div');
            dDiv.className = 'custom-option-desc';
            
            if (isBeta) {
                dDiv.innerHTML = '(Pouze pro předplatitele a Beta testery) <a href="#" class="coffee-link" style="color: #fbbf24; text-decoration: underline; margin-left: 5px; font-weight: bold;">Získat přístup</a>';
                const link = dDiv.querySelector('.coffee-link');
                if (link) {
                    link.addEventListener('click', (e) => {
                        e.stopPropagation(); // Zabránit vybrání verze
                        require('electron').shell.openExternal('https://buymeacoffee.com/marekk_czz');
                    });
                }
            } else {
                dDiv.innerText = desc;
            }
            
            div.appendChild(dDiv);
        }
        
        div.addEventListener('click', () => {
            versionSelect.value = v.db_version;
            customText.innerText = v.db_version;
            customSelect.classList.remove('open');
            
            const badge = document.getElementById('hero-version-badge');
            if (badge) {
                const bldTag = (v.current_build && v.current_build !== v.db_version) ? ` • ${v.current_build}` : '';
                badge.innerText = `${v.db_version}${bldTag}`;
            }
            
            // Highlight selected
            Array.from(customOptions.children).forEach(c => c.classList.remove('selected'));
            div.classList.add('selected');
            
            // Trigger change
            const event = new Event('change');
            versionSelect.dispatchEvent(event);
        });
        
        customOptions.appendChild(div);
    });
    
    // Set active
    if (versionSelect.value) {
        customText.innerText = versionSelect.value;
        const curV = availableVersions.find(v => v.db_version === versionSelect.value);
        const bldTag = (curV && curV.current_build && curV.current_build !== curV.db_version) ? ` • ${curV.current_build}` : '';
        const badge = document.getElementById('hero-version-badge');
        if (badge) badge.innerText = `${versionSelect.value}${bldTag}`;
        
        const opts = Array.from(customOptions.children);
        const idx = versionSelect.selectedIndex;
        if (idx >= 0 && opts[idx]) {
            opts[idx].classList.add('selected');
        }
    }
}

// Verze launcheru a Discord – přímá inicializace
(function initSettings() {
    try {
        const setLauncherVerEl = document.getElementById('settings-launcher-version');
        if (setLauncherVerEl) setLauncherVerEl.innerText = `Verze Launcheru: v${LAUNCHER_VERSION}`;
    } catch(e) {}
    
    const discLink = document.getElementById('settings-discord-link');
    if (discLink) {
        discLink.addEventListener('click', (e) => {
            e.preventDefault();
            const { shell } = require('electron');
            shell.openExternal('https://discord.com/invite/vmTagbC9mF');
        });
    }
})();

// Funkce pro zabezpečení .exe
function secureExecutable(versionFolder, isBlocked) {
    const exeNormal = path.join(versionFolder, 'Palubní Počítač IDPK.exe');
    const exeBlocked = path.join(versionFolder, 'Palubní Počítač IDPK.exe.blocked');
    try {
        if (isBlocked) {
            // Chceme zablokovat
            if (fs.existsSync(exeNormal)) fs.renameSync(exeNormal, exeBlocked);
        } else {
            // Chceme odblokovat
            if (fs.existsSync(exeBlocked)) fs.renameSync(exeBlocked, exeNormal);
        }
    } catch (e) {
        console.error("Chyba při zabezpečování exe:", e);
    }
}

// ★ NOUZOVÉ PŘIHLÁŠENÍ - z launcher overlay (při DB výpadku)
async function doLauncherOfflineLogin() {
    let usernameEl = document.getElementById('ol-username');
    let passwordEl = document.getElementById('ol-password');
    let errEl = document.getElementById('ol-err');
    if (!usernameEl || !passwordEl) return;
    let username = usernameEl.value.trim();
    let password = passwordEl.value.trim();
    if (errEl) errEl.textContent = 'Přihlašuji...';
    try {
        const resp = await fetch(`${API_BASE}/api/auth/offline_login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await resp.json();
        if (data.status === 'ok') {
            let config = loadConfig();
            config.discord_id = data.discord_id;
            config.discord_nick = data.discord_nick;
            config.user_role = data.role;
            config.offline_mode = true;
            saveConfig(config);
            // Skryj overlay a pokračuj v inicializaci launcheru
            document.getElementById('initial-loading-overlay').style.display = 'none';
            await initLauncher(config);
        } else {
            if (errEl) errEl.textContent = data.message || 'Nesprávné jméno nebo heslo.';
        }
    } catch(e) {
        if (errEl) errEl.textContent = 'Chyba spojení se serverem (' + (e.message || e) + ').';
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE PRO LAUNCHER OIS IDPK (window.LC + lc:* CustomEvents)
// ═══════════════════════════════════════════════════════════════════════════════

function mapRoleToLC(r) {
    if (!r) return 'user';
    const s = String(r).toLowerCase();
    if (s.includes('admin') || s.includes('sa') || s.includes('dev') || s.includes('správce') || s.includes('vedení')) return 'admin';
    if (s.includes('tester') || s.includes('beta')) return 'tester';
    if (s.includes('supporter') || s.includes('podporovatel') || s.includes('předplatitel') || s.includes('vip')) return 'supporter';
    return 'user';
}

function syncWithLCVersions() {
    if (!window.LC || !window.LC.setVersions || !Array.isArray(availableVersions)) return;
    const lcList = availableVersions.map(v => {
        const folder = getVersionFolder(v.db_version);
        const exePath = findExeInFolder(folder);
        const isInstalled = Boolean(exePath);
        const buildInfo = getLocalBuildInfo(folder);
        let hasUpdate = false;
        if (isInstalled && v.build_number && buildInfo && buildInfo.build_number) {
            hasUpdate = Number(v.build_number) > Number(buildInfo.build_number);
        }
        let tag = 'stable';
        const rawTag = (v.version_tag || '').toLowerCase();
        if (rawTag.includes('beta')) tag = 'beta';
        else if (rawTag.includes('rc')) tag = 'rc';
        else if (rawTag.includes('dev')) tag = 'dev';
        else if (rawTag.includes('old') || rawTag.includes('archiv')) tag = 'old';

        return {
            id: v.db_version,
            name: v.version_name || v.db_version,
            tag: tag,
            size: v.file_size || '1.2 GB',
            installed: isInstalled,
            update: hasUpdate,
            lock: !v.has_access || !v.can_launch
        };
    });
    window.LC.setVersions(lcList);
}

function updateLCLaunchState(versionName) {
    if (!window.LC || !window.LC.setLaunchState) return;
    const v = (availableVersions || []).find(x => x.db_version === versionName) || (availableVersions && availableVersions[0]);
    if (!v) {
        window.LC.setLaunchState('error', 'Žádná verze');
        return;
    }
    const folder = getVersionFolder(v.db_version);
    const exePath = findExeInFolder(folder);
    const isInstalled = Boolean(exePath);
    const buildInfo = getLocalBuildInfo(folder);
    let hasUpdate = false;
    if (isInstalled && v.build_number && buildInfo && buildInfo.build_number) {
        hasUpdate = Number(v.build_number) > Number(buildInfo.build_number);
    }
    if (!v.has_access || !v.can_launch) {
        window.LC.setLaunchState('locked', v.target_role ? 'Předplatitelé' : 'Zamčeno');
    } else if (isInstalled) {
        if (hasUpdate) {
            window.LC.setLaunchState('update', 'Aktualizovat');
        } else {
            window.LC.setLaunchState('ready', 'Spustit hru');
        }
    } else {
        window.LC.setLaunchState('install', 'Instalovat');
    }
}

function syncRouteFileToLinky(line) {
    if (!line || !line.num) return;
    try {
        const linkyDir = path.join(centralUserDataPath, 'linky');
        if (!fs.existsSync(linkyDir)) fs.mkdirSync(linkyDir, { recursive: true });
        
        const safeNum = String(line.num).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${safeNum}_custom.txt`;
        const filePath = path.join(linkyDir, filename);
        
        let txt = `Linka: ${line.num}\n`;
        const lastStop = line.dest || (line.stops && line.stops.length ? (line.stops[line.stops.length - 1].n || line.stops[line.stops.length - 1].name) : '');
        txt += `Směr: ${lastStop}\n`;
        txt += `Zastávky:\n`;
        
        const stops = Array.isArray(line.stops) ? line.stops : [];
        for (const s of stops) {
            const stopName = (s.n || s.name || '').trim();
            if (!stopName) continue;
            let audioFile = '';
            if (s.snd && s.snd.name) {
                audioFile = s.snd.name;
            } else if (s.audio_file) {
                audioFile = s.audio_file;
            } else if (s.audio) {
                audioFile = s.audio;
            }
            const zone = s.z || s.zone || '1';
            const reqFlag = s.req ? ' Další znaky: ZZ' : '';
            txt += `${stopName} = ${audioFile || stopName} | Display: ${stopName} | Tarifní zona: ${zone} | Čas: |${reqFlag}\n`;
        }
        
        fs.writeFileSync(filePath, txt, 'utf-8');
    } catch (e) {
        console.error('[syncRouteFileToLinky] Chyba:', e);
    }
}

async function loadLocalEditorLines() {
    try {
        const customDataPath = path.join(centralUserDataPath, 'data');
        const soundsDir = path.join(centralUserDataPath, 'sounds');
        if (!fs.existsSync(customDataPath)) {
            fs.mkdirSync(customDataPath, { recursive: true });
            return [];
        }
        const IGNORED_CONFIG_FILES = new Set([
            'stop_importance.json', 'via_priority.json', 'zones_override.json',
            'gtfs_version.json', 'build_info.json', '_sablona_vlastni_linky.json',
            'cached_launcher_state.json', 'config.json'
        ]);
        const files = fs.readdirSync(customDataPath).filter(f => f.endsWith('.json'));
        const lines = [];
        const seenKeys = new Set();
        for (const f of files) {
            if (IGNORED_CONFIG_FILES.has(f) || f.startsWith('_')) {
                continue;
            }
            try {
                const raw = fs.readFileSync(path.join(customDataPath, f), 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (!parsed.id) parsed.id = f.replace('.json', '');
                    if (!parsed.num) parsed.num = parsed.cislo || parsed.line || f.replace('.json', '');
                    if (!parsed.name) parsed.name = parsed.nazev || parsed.smer || `Linka ${parsed.num}`;
                    if (!parsed.dest) parsed.dest = parsed.cil || (parsed.stops && parsed.stops.length ? (parsed.stops[parsed.stops.length - 1].n || parsed.stops[parsed.stops.length - 1].name) : '');
                    if (!parsed.stops || !Array.isArray(parsed.stops)) parsed.stops = [];
                    if (!parsed.status) parsed.status = f.startsWith('comm_') ? 'published' : 'local';
                    if (!parsed.source) parsed.source = f.startsWith('comm_') ? 'comm' : (parsed.is_custom ? 'manual' : 'gtfs');
                    if (f.startsWith('comm_')) {
                        parsed.source = 'comm';
                        if (!parsed.tags) parsed.tags = [];
                        if (!parsed.tags.includes('Komunita')) parsed.tags.unshift('Komunita');
                    }

                    // Deduplikace podle unikátního ID i čísla linky (aby se nezobrazovaly duplikáty)
                    const dedupKey = `${parsed.num}_${parsed.id}`;
                    if (seenKeys.has(dedupKey) || seenKeys.has(String(parsed.id))) {
                        continue;
                    }
                    seenKeys.add(dedupKey);
                    seenKeys.add(String(parsed.id));

                    // Doplnění platných lokálních URL pro přehrávání zvuku v launcheru
                    for (const s of parsed.stops) {
                        if (s.snd && s.snd.name) {
                            const sndPath = path.join(soundsDir, s.snd.name);
                            if (fs.existsSync(sndPath)) {
                                s.snd.url = 'file:///' + sndPath.replace(/\\/g, '/');
                            }
                        }
                    }

                    syncRouteFileToLinky(parsed);
                    lines.push(parsed);
                }
            } catch (err) {}
        }
        return lines;
    } catch (e) {
        return [];
    }
}

async function loadCommunityEditorLines() {
    try {
        const res = await safeFetch(`${API_BASE}/api/community-routes`, {}, 6000);
        if (res.ok) {
            const data = await res.json();
            const list = data.routes || [];
            const customDataPath = path.join(centralUserDataPath, 'data');
            const cfg = loadConfig();
            const currentNick = (cfg && (cfg.discord_nick || cfg.discord_id || '')) || '';
            const localLines = await loadLocalEditorLines();
            const localNums = new Set(localLines.map(l => String(l.num)));

            const commLines = list.map(r => {
                let stops = [];
                try {
                    stops = typeof r.stops_json === 'string' ? JSON.parse(r.stops_json) : (r.stops || []);
                } catch(e) {}
                const dest = (stops && stops.length) ? (stops[stops.length - 1].name || stops[stops.length - 1].n || r.route_name) : r.route_name;
                const isInstalled = fs.existsSync(path.join(customDataPath, `comm_${r.id}.json`));
                const isOwnAuthor = Boolean(currentNick && r.author_name && (r.author_name.toLowerCase().includes(currentNick.toLowerCase()) || currentNick.toLowerCase().includes(r.author_name.toLowerCase())));
                const isLocal = localNums.has(String(r.route_number));
                const isAlreadyPresent = isInstalled || isOwnAuthor || isLocal;

                return {
                    id: String(r.id),
                    num: String(r.route_number),
                    dest: dest,
                    author: r.author_name || 'Komunita',
                    dl: r.download_count || 0,
                    size: r.file_size || '35 kB',
                    type: r.route_type === 'custom' ? 'fiktivni' : (r.route_type || 'realna'),
                    voice: r.voice_type || 'synt',
                    scope: r.system_tag && r.system_tag.toUpperCase() !== 'IDPK' ? 'cr' : 'idpk',
                    tags: r.system_tag ? [r.system_tag] : ['IDPK'],
                    isNew: Boolean(r.is_new),
                    state: isAlreadyPresent ? 'installed' : 'idle',
                    packageUrl: r.audio_package_url,
                    stops: stops
                };
            });
            return commLines;
        }
    } catch (e) {
        console.warn('Nelze načíst komunitní linky:', e);
    }
    return [];
}

async function loadPendingAdminQueue() {
    if (mapRoleToLC(currentUserRole) !== 'admin') return [];
    try {
        const res = await safeFetch(`${API_BASE}/api/community-routes/pending`, {}, 6000);
        if (res.ok) {
            const data = await res.json();
            const queue = (data.queue || []).map(q => {
                let stops = q.stops || [];
                return {
                    id: String(q.id),
                    num: String(q.route_number),
                    name: q.route_name,
                    author: q.author_name || 'Hráč',
                    type: q.route_type === 'custom' ? 'fiktivni' : 'realna',
                    voice: q.voice_type || 'synt',
                    tags: q.system_tag ? [q.system_tag] : ['IDPK'],
                    desc: q.description || '',
                    scope: q.system_tag && q.system_tag.toUpperCase() !== 'IDPK' ? 'cr' : 'idpk',
                    stops: stops.map(s => {
                        let audUrl = s.audio_url || (s.snd && s.snd.url) || '';
                        if (audUrl && audUrl.startsWith('/')) {
                            audUrl = `${API_BASE}${audUrl}`;
                        }
                        return {
                            n: s.name || s.n || s,
                            snd: (audUrl || s.snd) ? {
                                name: s.audio_file || (s.snd && s.snd.name) || 'hlaseni.wav',
                                dur: s.dur || 2.5,
                                url: audUrl
                            } : null
                        };
                    })
                };
            });
            return queue;
        }
    } catch(e) {
        console.warn('Nelze načíst frontu ke schválení:', e);
    }
    return [];
}

async function initLCBridgeData() {
    if (!window.LC) return;
    try {
        ensureCentralUserDataFolders();
        syncWithLCVersions();
        
        // Synchronizace přihlášeného uživatele a role do rozhraní
        const cfg = loadConfig();
        if (window.LC.setUser) {
            window.LC.setUser({
                name: cfg.discord_nick || cfg.email || 'Uživatel',
                hwid: currentHWID,
                role: mapRoleToLC(currentUserRole)
            });
        }
        
        // Editor linky
        const [myLines, commLines, pendingQueue] = await Promise.all([
            loadLocalEditorLines(),
            loadCommunityEditorLines(),
            loadPendingAdminQueue()
        ]);
        if (window.LC.setLines) window.LC.setLines(myLines);
        if (window.LC.setComm) window.LC.setComm(commLines);
        if (window.LC.setQueue) window.LC.setQueue(pendingQueue);

        // GTFS vyhledávání
        window.LC.setGtfsSearch(async (q) => {
            try {
                const res = await ipcRenderer.invoke('gtfs-editor-search', q);
                return Array.isArray(res) ? res : [];
            } catch(e) {
                console.error('Chyba při vyhledávání v GTFS:', e);
                return [];
            }
        });

        // Kontrola a stahování dat celé ČR
        try {
            const hasCr = await ipcRenderer.invoke('gtfs-check-cr');
            if (hasCr && window.LC && window.LC.setCrDownloaded) {
                window.LC.setCrDownloaded(true);
            }
        } catch(e) {}

        if (window.LC.setGtfsDownload) {
            window.LC.setGtfsDownload(async (cb) => {
                const onProgress = (evt, data) => {
                    if (cb && data) cb(data.percent, data.text);
                };
                ipcRenderer.on('gtfs-cr-progress', onProgress);
                try {
                    const res = await ipcRenderer.invoke('gtfs-download-cr');
                    ipcRenderer.removeListener('gtfs-cr-progress', onProgress);
                    if (!res || !res.success) throw new Error(res ? res.error : 'Chyba stahování');
                    if (window.LC.setCrDownloaded) window.LC.setCrDownloaded(true);
                    return true;
                } catch(err) {
                    ipcRenderer.removeListener('gtfs-cr-progress', onProgress);
                    throw err;
                }
            });
        }

        // Databáze zastávek STOPDB pro nápovědu
        try {
            const stops = await ipcRenderer.invoke('gtfs-editor-get-all-stops');
            if (stops && stops.length && window.LC.setStopDb) {
                window.LC.setStopDb(stops);
            }
        } catch(e) {}
    } catch(e) {
        console.warn('[initLCBridgeData] Chyba:', e);
    }
}

// ── Události z launcheru (document -> logic-launcher) ──────────────────────────

document.addEventListener('lc:minimize', () => {
    ipcRenderer.send('minimize-app');
});

document.addEventListener('lc:close', () => {
    ipcRenderer.send('quit-app');
});

document.addEventListener('lc:launch', (e) => {
    const verId = (e.detail && e.detail.version) || (window.LC && window.LC.S && window.LC.S.sel);
    const folder = getVersionFolder(verId);
    const exePath = findExeInFolder(folder);
    if (!exePath) {
        if (window.LC) {
            window.LC.setLaunchState('error');
            window.LC.showError('Hru se nepodařilo spustit', 'Soubor OIS.exe nebyl ve složce verze nalezen.');
        }
        return;
    }
    let config = loadConfig();
    config.last_version = verId;
    config.launcher_path = process.execPath;
    saveConfig(config);
    try {
        const proc = spawn(exePath, ['--no-launcher'], {
            detached: true,
            stdio: 'ignore'
        });
        proc.unref();
    } catch(err) {
        if (window.LC) {
            window.LC.setLaunchState('error');
            window.LC.showError('Hru se nepodařilo spustit', err.message);
        }
    }
});

document.addEventListener('lc:launched', () => {
    ipcRenderer.send('quit-app');
});

document.addEventListener('lc:download', async (e) => {
    const verId = (e.detail && e.detail.version) || (window.LC && window.LC.S && window.LC.S.sel);
    const v = (availableVersions || []).find(x => x.db_version === verId);
    if (!v || !v.file_url) {
        if (window.LC) {
            window.LC.showError('Chyba při stahování', `Verze ${verId} nemá v databázi nastavený platný odkaz ke stažení.`);
            window.LC.setLaunchState('error');
        }
        return;
    }
    const folder = getVersionFolder(v.db_version);
    const downloadUrl = v.file_url.split(',')[0].trim();
    await downloadAndExtract(downloadUrl, folder, v.db_version);
});

document.addEventListener('lc:cancel-download', () => {
    if (activeDownloadCleanup) {
        try { activeDownloadCleanup(true); } catch(e) {}
        activeDownloadCleanup = null;
    }
    if (window.LC) {
        window.LC.showDownload(false);
        const sel = window.LC.S && window.LC.S.sel;
        if (sel) updateLCLaunchState(sel);
        window.LC.toast('warn', 'Stahování zrušeno', 'Rozpracovaná data byla odstraněna.');
    }
});

document.addEventListener('lc:version-change', (e) => {
    const verId = e.detail && e.detail.version;
    if (verId) {
        let cfg = loadConfig();
        cfg.last_version = verId;
        saveConfig(cfg);
        updateLCLaunchState(verId);
    }
});

document.addEventListener('lc:login', async (e) => {
    const identifier = e.detail && e.detail.identifier;
    if (!identifier) return;
    if (window.LC) window.LC.setLoginView('waiting');
    try {
        const res = await safeFetch(`${API_BASE}/login_request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: identifier, hwid: currentHWID })
        }, 10000);
        const data = await res.json();
        if (data.status === 'success') {
            pollAuth(data.discord_id || identifier);
        } else {
            if (window.LC) {
                window.LC.setLoginView('discord');
                window.LC.showLoginError(data.message || 'Uživatel nebyl nalezen na Discord serveru.');
            }
        }
    } catch(err) {
        if (window.LC) {
            window.LC.setLoginView('discord');
            window.LC.showLoginError('Chyba spojení se serverem nebo neplatná data.');
        }
    }
});

document.addEventListener('lc:login-email', async (e) => {
    const { mode, nick, email } = e.detail;
    currentPendingEmail = email;
    if (mode === 'signup' && (!nick || nick.length < 3)) {
        if (window.LC) window.LC.showLoginError('Přezdívka musí mít alespoň 3 znaky.');
        return;
    }
    if (!email || !email.includes('@')) {
        if (window.LC) window.LC.showLoginError('Zadejte platný e-mail.');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/auth/email/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, nick: nick || '', intent: mode === 'signup' ? 'app_signup' : 'app_login' })
        });
        const data = await res.json();
        if (data.success || res.ok) {
            if (window.LC) {
                window.LC.setLoginView('email-code');
                pollAuthEmail(email);
            }
        } else {
            if (window.LC) {
                if (data.error && data.error.includes('nemá účet')) {
                    window.LC.setLoginView('email');
                    window.LC.setEmailMode('signup');
                    window.LC.showLoginError('Tento e-mail nemá účet. Vytvořte si ho záložkou Vytvořit účet.');
                } else if (data.error && data.error.includes('již existuje')) {
                    window.LC.setLoginView('email');
                    window.LC.setEmailMode('login');
                    window.LC.showLoginError('Tento e-mail už má účet. Přihlaste se.');
                } else {
                    window.LC.showLoginError(data.error || 'Nepodařilo se odeslat e-mail.');
                }
            }
        }
    } catch(err) {
        if (window.LC) window.LC.showLoginError('Chyba spojení se serverem.');
    }
});

document.addEventListener('lc:verify-code', async (e) => {
    const code = e.detail && e.detail.code;
    if (!code || code.length !== 6) return;
    try {
        const res = await fetch(`${API_BASE}/api/launcher/email_verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentPendingEmail, code: code, hwid: currentHWID })
        });
        const data = await res.json();
        if (data.status === 'success') {
            let config = loadConfig();
            config.discord_id = data.discord_id || `email_${currentPendingEmail}`;
            config.discord_nick = data.display_name || currentPendingEmail.split('@')[0];
            config.email = currentPendingEmail;
            saveConfig(config);
            
            if (window.LC) {
                window.LC.setUser({ name: config.discord_nick, hwid: currentHWID, role: mapRoleToLC(data.role) });
                window.LC.setLoginView('success');
            }
            setTimeout(async () => {
                if (window.LC) window.LC.showLogin(false);
                await initLauncher(config);
                await initLCBridgeData();
            }, 1600);
        } else {
            if (window.LC) window.LC.showLoginError(data.message || 'Neplatný kód z e-mailu.');
        }
    } catch(err) {
        if (window.LC) window.LC.showLoginError('Chyba ověření kódu: ' + err.message);
    }
});

document.addEventListener('lc:logout', () => {
    let config = loadConfig();
    config.discord_id = null;
    config.discord_nick = null;
    config.email = null;
    config.user_role = 'User';
    saveConfig(config);
    if (window.LC) {
        window.LC.setUser({ name: '', hwid: currentHWID, role: 'user' });
        window.LC.showLogin(true);
        window.LC.setLoginView('discord');
    }
});

document.addEventListener('lc:line-save', (e) => {
    const line = e.detail && e.detail.line;
    if (!line) return;
    try {
        const customDataPath = path.join(centralUserDataPath, 'data');
        if (!fs.existsSync(customDataPath)) fs.mkdirSync(customDataPath, { recursive: true });
        
        // Zajištění unikátního ID pro duplikaci linky (pravidlo #3)
        if (!line.id || line.id.startsWith('n') || line.id.startsWith('l')) {
            line.id = `user_${line.num}_${Date.now()}`;
        }
        line.is_custom = true;
        const filePath = path.join(customDataPath, `${line.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(line, null, 2), 'utf8');
        syncRouteFileToLinky(line);
        if (window.LC) {
            window.LC.toast('ok', `Linka ${line.num} uložena`, 'Linka byla uložena do vašich linek.');
        }
    } catch(err) {
        if (window.LC) window.LC.toast('err', 'Chyba ukládání linky', err.message);
    }
});

document.addEventListener('lc:line-delete', (e) => {
    const id = e.detail && e.detail.id;
    if (!id) return;
    try {
        const customDataPath = path.join(centralUserDataPath, 'data');
        const candidates = [
            path.join(customDataPath, `${id}.json`),
            path.join(customDataPath, `user_${id}.json`),
            path.join(customDataPath, `comm_${id}.json`)
        ];
        candidates.forEach(fp => {
            if (fs.existsSync(fp)) {
                try { fs.unlinkSync(fp); } catch(_) {}
            }
        });
        const linkyDir = path.join(centralUserDataPath, 'linky');
        if (fs.existsSync(linkyDir)) {
            const txtFiles = fs.readdirSync(linkyDir);
            txtFiles.forEach(tf => {
                if (tf.includes(id)) {
                    try { fs.unlinkSync(path.join(linkyDir, tf)); } catch(_) {}
                }
            });
        }
    } catch(err) {
        console.warn('Chyba při mazání souboru linky:', err);
    }
});

document.addEventListener('lc:sound-add', (e) => {
    const { file, stop, stopRef } = e.detail || {};
    if (file && file.path) {
        try {
            const fileName = path.basename(file.path);
            const targetDirs = [
                path.join(centralUserDataPath, 'sounds'),
                path.join(centralUserDataPath, 'zvuky'),
                path.join(centralUserDataPath, 'zvuky', 'zastavky')
            ];
            let firstDest = '';
            for (const d of targetDirs) {
                if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                const dest = path.join(d, fileName);
                if (!firstDest) firstDest = dest;
                fs.copyFileSync(file.path, dest);
            }
            // Nastavit funkční lokální URL pro okamžité přehrání v editoru
            const localFileUrl = 'file:///' + firstDest.replace(/\\/g, '/');
            if (stopRef && stopRef.snd) {
                stopRef.snd.url = localFileUrl;
            }
        } catch(err) {
            console.error('Chyba při kopírování zvuku:', err);
        }
    }
});

let isDevBuildLaunching = false;
document.addEventListener('lc:launch-dev-build', () => {
    if (isDevBuildLaunching) return;
    isDevBuildLaunching = true;
    ipcRenderer.send('launch-dev-build');
    setTimeout(() => { isDevBuildLaunching = false; }, 3000);
});

document.addEventListener('lc:line-publish', async (e) => {
    const { line, type, voice, tags, desc } = e.detail;
    let cfg = loadConfig();
    try {
        const formData = new FormData();
        formData.append('legal_confirmed', '1');
        formData.append('route_number', line.num);
        formData.append('route_name', line.name || `Linka ${line.num}`);
        formData.append('route_type', type || 'gtfs');
        formData.append('voice_type', voice || 'synt');
        formData.append('system_tag', (tags && tags[0]) || 'IDPK');
        formData.append('description', desc || '');
        formData.append('author_id', cfg.discord_id || currentHWID);
        formData.append('author_name', cfg.discord_nick || 'Hráč');
        formData.append('stops_json', JSON.stringify(line.stops || []));
        
        // Zvukové soubory z userdata/sounds
        const soundsDir = path.join(centralUserDataPath, 'sounds');
        (line.stops || []).forEach((st, idx) => {
            if (st.snd && st.snd.name) {
                const sPath = path.join(soundsDir, st.snd.name);
                if (fs.existsSync(sPath)) {
                    const buf = fs.readFileSync(sPath);
                    const blob = new Blob([buf]);
                    formData.append(`audio_${idx}`, blob, st.snd.name);
                }
            }
        });

        const res = await fetch(`${API_BASE}/api/community-routes/submit`, {
            method: 'POST',
            body: formData
        });
        const respData = await res.json();
        if (respData.success) {
            line.status = 'pending';
            const customDataPath = path.join(centralUserDataPath, 'data');
            fs.writeFileSync(path.join(customDataPath, `${line.id}.json`), JSON.stringify(line, null, 2), 'utf8');
            if (window.LC) {
                window.LC.renderMine(line.id);
                window.LC.toast('ok', 'Linka odeslána ke kontrole', 'Správci si poslechnou hlášení. O výsledku budete informováni přes Discord DM.');
            }
        } else {
            if (window.LC) window.LC.toast('err', 'Chyba odeslání', respData.error || 'Server odmítl linku.');
        }
    } catch(err) {
        if (window.LC) window.LC.toast('err', 'Chyba spojení', err.message);
    }
});

document.addEventListener('lc:line-decision', async (e) => {
    const { id, ok, discord, message } = e.detail;
    try {
        const res = await fetch(`${API_BASE}/api/community-routes/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_id: id, id: id, ok: ok, discord: discord, message: message })
        });
        const data = await res.json();
        if (data.success) {
            if (window.LC) {
                window.LC.toast('ok', ok ? 'Linka schválena' : 'Linka zamítnuta', 'Rozhodnutí bylo uloženo a uživatel byl informován.');
                const newQ = await loadPendingAdminQueue();
                window.LC.setQueue(newQ);
                const commLines = await loadCommunityEditorLines();
                window.LC.setComm(commLines);
            }
        } else {
            if (window.LC) window.LC.toast('err', 'Chyba', data.error || 'Operace selhala.');
        }
    } catch(err) {
        if (window.LC) window.LC.toast('err', 'Chyba spojení', err.message);
    }
});

document.addEventListener('lc:community-download', async (e) => {
    const id = e.detail && e.detail.id;
    const commItem = (window.LC && window.LC.S && window.LC.S.comm || []).find(x => x.id === id);
    if (!commItem) return;
    
    const customDataPath = path.join(centralUserDataPath, 'data');
    if (!fs.existsSync(customDataPath)) fs.mkdirSync(customDataPath, { recursive: true });
    
    if (commItem.packageUrl) {
        const tempZip = path.join(os.tmpdir(), `comm_pkg_${id}.zip`);
        try {
            await downloadFileWithProgress({
                url: commItem.packageUrl,
                destPath: tempZip,
                onProgress: (dl, tot, pct) => {
                    commItem.p = pct;
                    if (window.LC && window.LC.renderComm) window.LC.renderComm();
                }
            });
            const soundsDir = path.join(centralUserDataPath, 'sounds');
            if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
            await extract(tempZip, { dir: soundsDir });
            try { fs.unlinkSync(tempZip); } catch(e) {}
        } catch(err) {
            console.warn('Chyba při stahování zvuků balíčku:', err);
        }
    }
    
    // Uložit linku do dat
    const lineData = {
        id: `comm_${id}`,
        commId: id,
        num: commItem.num,
        name: `Linka ${commItem.num} (od ${commItem.author})`,
        dest: commItem.dest,
        source: 'comm',
        scope: commItem.scope || 'idpk',
        type: commItem.type || 'realna',
        voice: commItem.voice || 'synt',
        tags: Array.isArray(commItem.tags) ? [...commItem.tags] : [],
        status: 'published',
        stops: commItem.stops || []
    };
    if (!lineData.tags.includes('Komunita')) lineData.tags.unshift('Komunita');
    fs.writeFileSync(path.join(customDataPath, `comm_${id}.json`), JSON.stringify(lineData, null, 2), 'utf8');
    syncRouteFileToLinky(lineData);
    commItem.state = 'installed';
    if (window.LC) {
        if (window.LC.S && window.LC.S.lines) {
            window.LC.S.lines = window.LC.S.lines.filter(x => x.id !== lineData.id);
            window.LC.S.lines.unshift(lineData);
        }
        if (window.LC.renderComm) window.LC.renderComm();
        if (window.LC.renderMine) window.LC.renderMine();
        window.LC.toast('ok', `Linka ${commItem.num} stažena`, 'Linka je uložena v Moje linky a připravena ke hraní ve hře.');
    }
});

document.addEventListener('lc:open-userdata', () => {
    ipcRenderer.send('open-userdata-folder');
});

document.addEventListener('lc:open-custom-routes', () => {
    ipcRenderer.send('open-custom-routes-folder');
});

document.addEventListener('lc:open-url', (e) => {
    const url = e.detail && e.detail.url;
    if (url) {
        const { shell } = require('electron');
        shell.openExternal(url);
    }
});

document.addEventListener('lc:delete-all', () => {
    const versionsDir = path.join(userDataPath, 'versions');
    if (fs.existsSync(versionsDir)) {
        try { fs.rmSync(versionsDir, { recursive: true, force: true }); } catch(e) {}
    }
    if (window.LC) {
        window.LC.toast('ok', 'Data smazána', 'Všechny stažené verze byly odstraněny.');
        syncWithLCVersions();
    }
});

document.addEventListener('lc:gtfs-download', async () => {
    try {
        await syncGtfsData();
        if (window.LC) {
            window.LC.setGtfsCR(true);
            window.LC.toast('ok', 'GTFS data aktualizována', 'Byla stažena aktuální data zastávek a linek.');
        }
    } catch(e) {
        if (window.LC) window.LC.toast('err', 'Chyba GTFS', e.message);
    }
});

document.addEventListener('lc:launcher-update', async () => {
    try {
        const hasUpdate = await checkForLauncherUpdate();
        if (!hasUpdate && window.LC) {
            window.LC.toast('ok', 'Launcher je aktuální', `Používáte nejnovější verzi v${LAUNCHER_VERSION}.`);
        }
    } catch(e) {
        if (window.LC) window.LC.toast('err', 'Chyba aktualizace', e.message);
    }
});
