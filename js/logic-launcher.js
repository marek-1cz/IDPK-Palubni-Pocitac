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

function downloadAndInstallLauncherUpdate(url, newVersion) {
    return new Promise((resolve) => {
        const modal = document.getElementById('launcher-update-modal');
        const statusEl = document.getElementById('launcher-update-status');
        const pBar = document.getElementById('launcher-update-progress-bar');
        const pPct = document.getElementById('launcher-update-percent');
        const pSpd = document.getElementById('launcher-update-speed');

        if (modal) modal.style.display = 'flex';
        if (statusEl) statusEl.innerText = `Nalezena nová verze Launcheru (v${newVersion}). Stahuji aktualizaci...`;

        const tempExePath = path.join(os.tmpdir(), `IDPK-Launcher-Setup-${newVersion}.exe`);
        const fileStream = fs.createWriteStream(tempExePath);

        const doDownload = (targetUrl) => {
            const client = targetUrl.startsWith('https:') ? https : require('http');
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) IDPK-Launcher/' + LAUNCHER_VERSION
                }
            };
            const req = client.get(targetUrl, options, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                    return doDownload(res.headers.location);
                }

                if (res.statusCode !== 200) {
                    if (modal) modal.style.display = 'none';
                    console.error("[LauncherUpdate] Download failed with HTTP " + res.statusCode);
                    return resolve(false);
                }

                const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
                let downloadedBytes = 0;
                let startTime = Date.now();

                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const pct = Math.round((downloadedBytes / totalBytes) * 100);
                        if (pBar) pBar.style.width = pct + '%';
                        if (pPct) pPct.innerText = `${pct} %`;

                        const elapsedSec = (Date.now() - startTime) / 1000;
                        if (elapsedSec > 0.5) {
                            const speedMBps = ((downloadedBytes / (1024 * 1024)) / elapsedSec).toFixed(1);
                            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                            if (pSpd) pSpd.innerText = `${downloadedMB} / ${totalMB} MB (${speedMBps} MB/s)`;
                        }
                    } else {
                        const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                        if (pPct) pPct.innerText = `${dlMB} MB`;
                    }
                });

                res.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        if (statusEl) statusEl.innerText = `Aktualizace stažena. Restartuji a instaluji Launcher...`;
                        if (pBar) pBar.style.width = '100%';
                        if (pPct) pPct.innerText = '100 %';

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
                    });
                });
            });

            req.on('error', (err) => {
                console.error("[LauncherUpdate] Download error:", err);
                if (modal) modal.style.display = 'none';
                try { fs.unlinkSync(tempExePath); } catch(e){}
                resolve(false);
            });
        };

        doDownload(url);
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

    if (config.discord_id) {
        // Uživatel už je přihlášen, pustíme ho dál
        await initLauncher(config);
    } else {
        // Není přihlášen, zobrazit auth
        const overlay = document.getElementById('initial-loading-overlay');
        if (overlay) overlay.style.display = 'none';
        loginOverlay.style.display = 'flex';
        showAuthView('discord');
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
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.innerHTML = '<i class="fas fa-hourglass-half" style="margin-right: 5px;"></i>Čekám na kliknutí v e-mailu...';
            }

            if (window.emailPollInterval) clearInterval(window.emailPollInterval);
            window.emailPollInterval = setInterval(async () => {
                const pollRes = await fetch(`${API_BASE}/api/launcher/email_poll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); const pollData = await pollRes.json(); if (pollData.status === 'success' && pollData.web_session_token && pollData.web_session_token !== emailAuthOldToken) { pollData.id = pollData.discord_id;
                    if (window.emailAuthTimeoutTimer) clearTimeout(window.emailAuthTimeoutTimer);
                    clearInterval(window.emailPollInterval);
                    if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: #22c55e; margin-right: 5px;"></i>Schváleno! Přihlašuji...';
                    let config = loadConfig();
                    config.discord_id = pollData.discord_id || "email-" + pollData.id;
                    config.discord_nick = pollData.nick || pollData.email;
                    config.email = pollData.email;
                    saveConfig(config);
                    setTimeout(() => {
                        loginOverlay.style.display = 'none';
                        initLauncher(config);
                    }, 1500);
                }
            }, 8000);
        } else {
            showLoginError(data.message || "Nepodařilo se odeslat odkaz na e-mail.");
        }
    } catch (e) {
        showLoginError("Chyba spojení s API.");
    }
    
    btnStartEmailAuth.disabled = false;
    btnStartEmailAuth.innerText = 'Odeslat přihlašovací odkaz';
});

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
            body: JSON.stringify({ identifier: val, hwid: currentHWID, app_version: APP_VERSION })
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
                            btnDevBuild.addEventListener('click', () => {
                                btnDevBuild.disabled = true;
                                btnDevBuild.innerHTML = '<i class="fas fa-spinner fa-spin"></i> SPOUŠTÍM...';
                                ipcRenderer.send('launch-dev-build');
                            });
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

    // Pokud jsme v Offline režimu, spouštíme ihned bez online dotazování na server
    if (isOfflineMode) {
        const versionName = versionSelect.value;
        const folder = getVersionFolder(versionName);
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
        
    const versionName = versionSelect.value;
    const folder = getVersionFolder(versionName);
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

function downloadAndExtract(url, folder, versionName) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, {recursive: true});
    const zipPath = path.join(folder, 'app_download.zip');
    
    progressText.innerText = 'Stahování dat...';
    
    const file = fs.createWriteStream(zipPath);
    
    const doDownload = (downloadUrl) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 IDPK-Launcher/1.0'
            }
        };
        https.get(downloadUrl, options, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                return doDownload(response.headers.location);
            }
            
            const total = parseInt(response.headers['content-length'], 10);
            let downloaded = 0;
            
            response.on('data', (chunk) => {
                downloaded += chunk.length;
                if(total) {
                    const percent = Math.round((downloaded / total) * 100);
                    progressFill.style.width = percent + '%';
                    progressText.innerText = `Stahování: ${percent}%`;
                }
            });
            
            response.pipe(file);
            file.on('finish', () => {
                file.close(async () => {
                    progressText.innerText = 'Rozbalování... (může trvat minutu)';
                    launchText.innerText = 'ROZBALOVÁNÍ...';
                    
                    try {
                        // Smazat existující soubory před rozbalením (kromě ZIPu) pro prevenci chyb ENOENT
                        if (fs.existsSync(folder)) {
                            let existingFiles = await fs.promises.readdir(folder);
                            for (let f of existingFiles) {
                                if (f !== 'app_download.zip') {
                                    try {
                                        await fs.promises.rm(path.join(folder, f), { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
                                    } catch (err) {
                                        console.warn("Nemohu smazat soubor před rozbalením (je pravděpodobně uzamčen):", f, err);
                                    }
                                }
                            }
                            // Dáme Windows 2.5 vteřiny na dokončení smazání složek na pozadí, abychom předešli ENOENT
                            await new Promise(r => setTimeout(r, 2500));
                        }
                        let originalNoAsar = process.noAsar;
                        process.noAsar = true;
                        await extract(zipPath, { dir: folder });
                        process.noAsar = originalNoAsar;

                        await fs.promises.unlink(zipPath); // Smazat zip

                        // Uložit výchozí build_info.json po plném stažení
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
                    
                    // Najít EXE
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
                        showError("Staženo, ale nenašel jsem spouštěcí .exe soubor.");
                        return;
                    }

                    // 1. Zabezpečení
                    const selectedVersion = availableVersions.find(v => v.db_version === versionName);
                    const isBlocked = (!selectedVersion || !selectedVersion.has_access || !selectedVersion.can_launch);
                    secureExecutable(path.dirname(exePath), isBlocked);

                    // 2. Synchronizace uživatelských dat (linky a data vázána na launcher)
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

                    // 3. Otázkové okno pro odinstalaci starých verzí
                    if (otherVersions.length > 0) {
                        btnLaunch.classList.remove('btn-locked');
                        showNewVersionCleanupPrompt(versionName, otherVersions, exePath, !isBlocked);
                    } else {
                        if (!isBlocked) {
                            launchApp(exePath);
                        } else {
                            btnLaunch.classList.add('btn-locked');
                            checkLocalVersion(versionName);
                        }
                    }
                } catch(e) {
                    showError("Chyba při rozbalování: " + e.message);
                }
            });
        });
        }).on('error', (e) => {
            fs.unlinkSync(zipPath);
            showError("Chyba sítě: " + e.message);
        });
    };
    
    doDownload(url);
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

    const file = fs.createWriteStream(patchZipPath);

    const doPatchDownload = (downloadUrl) => {
        const options = {
            headers: {
                'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) IDPK-Launcher/${LAUNCHER_VERSION}`
            }
        };
        https.get(downloadUrl, options, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                return doPatchDownload(response.headers.location);
            }
            if (response.statusCode !== 200) {
                try { fs.unlinkSync(patchZipPath); } catch(_) {}
                progressContainer.style.display = 'none';
                btnLaunch.disabled = false;
                versionSelect.disabled = false;
                if (cs1) cs1.classList.remove('disabled');
                showError(`Chyba stahování opravy: HTTP ${response.statusCode}`);
                checkLocalVersion(versionName);
                return;
            }

            const total = parseInt(response.headers['content-length'], 10);
            let downloaded = 0;

            response.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total) {
                    const percent = Math.round((downloaded / total) * 100);
                    progressFill.style.width = percent + '%';
                    const mbDl = (downloaded / 1024 / 1024).toFixed(1);
                    const mbTot = (total / 1024 / 1024).toFixed(1);
                    progressText.innerText = `Stahování aktualizace: ${percent}% (${mbDl} MB / ${mbTot} MB)`;
                } else {
                    const mbDl = (downloaded / 1024 / 1024).toFixed(1);
                    progressText.innerText = `Stahování aktualizace: ${mbDl} MB`;
                }
            });

            response.pipe(file);
            file.on('finish', () => {
                file.close(async () => {
                    progressText.innerText = 'Instalace aktualizace... (přepisování souborů)';
                    launchText.innerText = 'INSTALACE...';

                    try {
                        let originalNoAsar = process.noAsar;
                        process.noAsar = true;

                        // Určit cílový adresář pro extrakci: pokud je aplikace v win-unpacked, rozbalit do win-unpacked
                        let extractDir = folder;
                        if (!fs.existsSync(path.join(folder, 'resources')) && fs.existsSync(path.join(folder, 'win-unpacked', 'resources'))) {
                            extractDir = path.join(folder, 'win-unpacked');
                        }

                        await extract(patchZipPath, { dir: extractDir });
                        process.noAsar = originalNoAsar;

                        // Smazat dočasný ZIP
                        try { await fs.promises.unlink(patchZipPath); } catch (_) {}

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
                        try { fs.unlinkSync(patchZipPath); } catch (_) {}
                        progressContainer.style.display = 'none';
                        btnLaunch.classList.remove('btn-locked');
                        btnLaunch.disabled = false;
                        versionSelect.disabled = false;
                        if (cs1) cs1.classList.remove('disabled');
                        showError("Chyba při instalaci aktualizace: " + err.message);
                        checkLocalVersion(versionName);
                    }
                });
            });
        }).on('error', (e) => {
            try { fs.unlinkSync(patchZipPath); } catch (_) {}
            progressContainer.style.display = 'none';
            btnLaunch.classList.remove('btn-locked');
            btnLaunch.disabled = false;
            versionSelect.disabled = false;
            if (cs1) cs1.classList.remove('disabled');
            showError("Chyba stahování: " + e.message);
            checkLocalVersion(versionName);
        });
    };

    doPatchDownload(patchUrl);
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
        appVerEl.innerHTML = `Nejnovější verze ke stažení: <strong style="color:white;">${latest.version_name}</strong>`;
    } else if (appVerEl) {
        appVerEl.textContent = `Zjišťuji nejnovější verzi...`;
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
        const pkg = require(path.join(__dirname, '..', 'package.json'));
        const verEl = document.getElementById('settings-app-version');
        if (verEl) verEl.innerText = 'Verze Launcheru: v' + pkg.version;
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
