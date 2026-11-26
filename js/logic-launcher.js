let activeDownloadCleanup = null;
let currentPendingEmail = '';
// Vlastní moderní alert (nahrazuje nativní ošklivý alert)
window.alert = function (msg) {
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

window.onerror = function (msg, url, lineNo, columnNo, error) {
    alert("Error: " + msg + "\nLine: " + lineNo + "\n" + error);
    return false;
};

window.addEventListener('unhandledrejection', function (event) {
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
const devPath = (process.defaultApp || /[\\/]electron\.exe$/i.test(process.execPath)) ? __dirname : null;
const configPath = path.join(userDataPath, 'config.json');

function loadConfig() {
    if (fs.existsSync(configPath)) {
        try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { }
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
    } catch (_) { }
}

function loadLauncherCache() {
    try {
        if (fs.existsSync(launcherCachePath)) {
            return JSON.parse(fs.readFileSync(launcherCachePath, 'utf8'));
        }
    } catch (_) { }
    return null;
}

// =========================================================================
// CENTRÁLNÍ UŽIVATELSKÁ DATA (VLASTNÍ LINKY NAVÁZÁNY NA LAUNCHER)
// =========================================================================
const centralUserDataPath = path.join(userDataPath, 'userdata');
const PATH_USERDATA = centralUserDataPath;
window.PATH_USERDATA = centralUserDataPath;
window.userDataPath = userDataPath;

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
                } catch (_) { }
            });
        } catch (_) { }
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
                } catch (_) { }
            });
        } catch (_) { }
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
                } catch (_) { }
            });
        });
    } catch (_) { }
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

    modal.hidden = false;
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

        modal.hidden = true;
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
        } catch (_) { }

        await loadAvailableVersions();
        versionSelect.value = newVersionName;
        checkLocalVersion(newVersionName);

        if (canLaunch && targetExePath) {
            launchApp(targetExePath);
        }
    };

    btnKeepAll.onclick = () => {
        modal.hidden = true;
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

function _authHeaders(extra = {}) {
    const headers = { ...extra };
    try {
        const cfg = loadConfig();
        if (cfg && cfg.web_session_token) {
            headers['Authorization'] = `Bearer ${cfg.web_session_token}`;
            headers['X-Session-Token'] = cfg.web_session_token;
        }
    } catch (_) { }
    return headers;
}

let _sessionRefreshPromise = null;
let _lastSessionRefreshTs = 0;

function _applyVerifiedUserToUI(cfg, data) {
    const prevAdmin = ['admin', 'sa', 'dev'].includes(mapRoleToLC(currentUserRole));
    if (data.role) {
        currentUserRole = data.role;
        cfg.user_role = currentUserRole;
    }
    if (data.nick && String(data.nick).trim() && data.nick !== 'None' && data.nick !== 'čeká na odpověd') {
        cfg.discord_nick = String(data.nick).trim();
    }
    if (data.avatar_url) {
        currentUserAvatarUrl = data.avatar_url;
        cfg.avatar_url = data.avatar_url;
        const avEl = document.getElementById('avatar');
        if (avEl) {
            avEl.innerHTML = `<img src="${data.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="Avatar">`;
        }
    }
    if (data.web_session_token) {
        cfg.web_session_token = data.web_session_token;
    }
    saveConfig(cfg);

    const serverIsAdmin = typeof data.is_admin === 'boolean'
        ? data.is_admin
        : ['admin', 'sa', 'dev'].includes(mapRoleToLC(currentUserRole));
    const effectiveLCRole = serverIsAdmin ? mapRoleToLC(currentUserRole) : (['admin', 'sa', 'dev'].includes(mapRoleToLC(currentUserRole)) ? 'user' : mapRoleToLC(currentUserRole));

    if (window.LC && window.LC.setUser) {
        window.LC.setUser({
            name: cfg.discord_nick || cfg.email || 'Uživatel',
            hwid: currentHWID,
            role: effectiveLCRole,
            avatar_url: data.avatar_url || cfg.avatar_url || null
        });
    }
    const roleDisplay = document.getElementById('user-role-display') || document.getElementById('role-badge');
    if (!window.LC && roleDisplay) {
        let color = '#64748b';
        if (currentUserRole.includes('DEV') || currentUserRole.includes('SA')) color = '#ef4444';
        else if (currentUserRole.includes('BT')) color = '#3b82f6';
        roleDisplay.innerText = String(currentUserRole || 'USER').toUpperCase();
        roleDisplay.style.backgroundColor = color;
    }
    return { prevAdmin, serverIsAdmin };
}

async function refreshLauncherSessionAndRole(force = false) {
    const now = Date.now();
    if (!force && _lastSessionRefreshTs && (now - _lastSessionRefreshTs) < 15000 && loadConfig().web_session_token) {
        return { ok: true, is_admin: ['admin', 'sa', 'dev'].includes(mapRoleToLC(currentUserRole)), cached: true };
    }
    if (_sessionRefreshPromise) return _sessionRefreshPromise;

    _sessionRefreshPromise = (async () => {
        try {
            const cfg = loadConfig();
            const roleLookupId = String(cfg.discord_id || (cfg.email ? 'email-' + cfg.email : '') || '').trim();
            if (!roleLookupId && !cfg.web_session_token) {
                return { ok: false, is_admin: false };
            }
            const res = await safeFetch(`${API_BASE}/api/launcher/session_refresh`, {
                method: 'POST',
                headers: _authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ discord_id: roleLookupId, hwid: currentHWID || '' })
            }, 7000);
            const data = await res.json().catch(() => ({}));
            if (res.status === 403 || data.status === 'banned') {
                currentUserRole = 'User';
                if (window.LC) {
                    if (window.LC.setAdminRoutes) window.LC.setAdminRoutes([]);
                    if (window.LC.setUser) window.LC.setUser({ name: cfg.discord_nick || '', hwid: currentHWID, role: 'user', avatar_url: cfg.avatar_url || null });
                }
                return { ok: false, is_admin: false, data };
            }
            if (res.ok && data && data.status === 'success') {
                _lastSessionRefreshTs = Date.now();
                const { prevAdmin, serverIsAdmin } = _applyVerifiedUserToUI(cfg, data);
                if (!serverIsAdmin && window.LC && window.LC.setAdminRoutes) {
                    window.LC.setAdminRoutes([]);
                } else if (!prevAdmin && serverIsAdmin && typeof loadPendingAdminQueue === 'function') {
                    loadPendingAdminQueue().then((q) => {
                        if (window.LC && window.LC.setAdminRoutes) window.LC.setAdminRoutes(q);
                    }).catch(() => { });
                }
                return { ok: true, is_admin: serverIsAdmin, session_valid: Boolean(data.session_valid || cfg.web_session_token), data };
            }
        } catch (e) {
            console.warn('[refreshLauncherSessionAndRole]', e && e.message ? e.message : e);
        } finally {
            _sessionRefreshPromise = null;
        }
        return { ok: false, is_admin: ['admin', 'sa', 'dev'].includes(mapRoleToLC(currentUserRole)) };
    })();
    return _sessionRefreshPromise;
}

async function authFetch(url, options = {}, timeoutMs = 10000) {
    const cfg = loadConfig();
    if (!cfg.web_session_token) {
        await refreshLauncherSessionAndRole(true);
    }
    const buildOpts = () => ({
        ...options,
        headers: _authHeaders(options.headers || {})
    });
    let res = await safeFetch(url, buildOpts(), timeoutMs);
    if (res.status === 401) {
        const ref = await refreshLauncherSessionAndRole(true);
        if (ref && ref.ok && loadConfig().web_session_token) {
            res = await safeFetch(url, buildOpts(), timeoutMs);
        }
    }
    return res;
}

function hasVersionPatchUpdate(v, folder) {
    if (!v || !folder) return false;
    const localInfo = getLocalBuildInfo(folder);
    const localBuild = localInfo ? String(localInfo.build || localInfo.current_build || '').trim() : '';
    const remoteBuild = String(v.current_build || v.db_version || '').trim();
    const patchUrl = String(v.patch_url || '').trim();
    if (v.build_number && localInfo && localInfo.build_number && Number(v.build_number) > Number(localInfo.build_number)) {
        return true;
    }
    if (patchUrl && remoteBuild) {
        if (localBuild && localBuild !== remoteBuild) return true;
        if (!localBuild && remoteBuild !== String(v.db_version || '').trim()) return true;
    }
    return false;
}
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
} catch (e) { }

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

let activeLauncherUpdateCheck = null;
let activeLauncherUpdateDownload = null;

async function checkLauncherUpdateMeta() {
    if (activeLauncherUpdateCheck) return activeLauncherUpdateCheck;
    activeLauncherUpdateCheck = (async () => {
        try {
            const res = await safeFetch(`${API_BASE}/api/launcher/check_update?current_version=${encodeURIComponent(LAUNCHER_VERSION)}`, {}, 3500);
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.status === 'ok') {
                const remoteVer = data.latest_version || '1.0.0';
                const dlUrl = data.download_url;
                if (data.has_update && dlUrl && isNewerVersion(remoteVer, LAUNCHER_VERSION)) {
                    return { hasUpdate: true, dlUrl, remoteVer };
                }
                return { hasUpdate: false, remoteVer };
            }
        } catch (e) {
            console.warn("[LauncherUpdate] Chyba při kontrole aktualizace:", e);
        }
        return null;
    })();
    try {
        return await activeLauncherUpdateCheck;
    } finally {
        activeLauncherUpdateCheck = null;
    }
}

async function checkForLauncherUpdate() {
    if (activeLauncherUpdateDownload) return activeLauncherUpdateDownload;
    const meta = await checkLauncherUpdateMeta();
    if (meta && meta.hasUpdate) {
        return await downloadAndInstallLauncherUpdate(meta.dlUrl, meta.remoteVer);
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
                try { activeReq.destroy(); } catch (_) { }
                activeReq = null;
            }
            if (activeStream) {
                try { activeStream.close(); } catch (_) { }
                activeStream = null;
            }
            if (deleteFile && fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (_) { }
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
            } catch (_) { }
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
        } catch (_) { }
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
    if (activeLauncherUpdateDownload) return activeLauncherUpdateDownload;
    activeLauncherUpdateDownload = new Promise(async (resolve) => {
        const modal = document.getElementById('launcher-update-modal');
        const statusEl = document.getElementById('launcher-update-status');
        const pBar = document.getElementById('launcher-update-progress-bar');
        const pPct = document.getElementById('launcher-update-percent');
        const pSpd = document.getElementById('launcher-update-speed');

        if (modal) { modal.hidden = false; modal.style.display = 'flex'; }
        if (window.LC && window.LC.setLauncherUpdate) {
            window.LC.setLauncherUpdate({ stage: 1, pct: 0, text: `Nalezena nová verze Launcheru (v${newVersion}). Stahuji aktualizaci…`, speed: '—' });
        }
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
                try { fs.unlinkSync(tempExePath); } catch (_) { }
                throw new Error(`Stažený instalátor je neúplný nebo poškozený (velikost: ${st.size} B).`);
            }

            const isPackaged = !process.defaultApp && !/[\\/]electron\.exe$/i.test(process.execPath);
            if (!isPackaged) {
                console.log("[LauncherUpdate] Běží v DEV režimu (electron.exe). Instalátor stažen:", tempExePath);
                setTimeout(() => {
                    if (modal) { modal.hidden = true; modal.style.display = 'none'; }
                    activeLauncherUpdateDownload = null;
                    resolve(false);
                }, 2500);
                return;
            }

            if (window.LC && window.LC.setLauncherUpdate) {
                window.LC.setLauncherUpdate({ stage: 3, pct: 100, text: 'Instalace a restart Launcheru…', speed: '' });
            }
            setTimeout(() => {
                ipcRenderer.send('install-launcher-update', tempExePath);
                activeLauncherUpdateDownload = null;
                resolve(true);
            }, 1000);
        } catch (err) {
            console.error("[LauncherUpdate] Download error:", err);
            if (modal) { modal.hidden = true; modal.style.display = 'none'; }
            try { if (fs.existsSync(tempExePath)) fs.unlinkSync(tempExePath); } catch (_) { }
            if (window.LC && window.LC.toast) {
                window.LC.toast('err', 'Aktualizace Launcheru selhala', err.message);
            } else {
                alert(`Nepodařilo se stáhnout aktualizaci Launcheru:\n${err.message}`);
            }
            activeLauncherUpdateDownload = null;
            resolve(false);
        }
    });
    return activeLauncherUpdateDownload;
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
        errBox.hidden = false;
        errBox.style.display = 'flex';
    } else {
        alert(msg);
    }
}

function hideLoginError() {
    const errBox = document.getElementById('login-error-message');
    if (errBox) {
        errBox.hidden = true;
        errBox.style.display = 'none';
    }
}

async function checkAuthAndInit() {
    const titleVerEl = document.getElementById('launcher-title-version');
    if (titleVerEl) titleVerEl.innerText = `v${LAUNCHER_VERSION}`;
    const sideVerEl = document.getElementById('side-ver');
    if (sideVerEl) sideVerEl.textContent = `v${LAUNCHER_VERSION}`;
    const setLauncherVerEl = document.getElementById('settings-launcher-version');
    if (setLauncherVerEl) setLauncherVerEl.innerText = `Verze Launcheru: v${LAUNCHER_VERSION}`;

    let config = loadConfig();
    if (config.auto_launch === undefined) {
        config.auto_launch = true;
    }
    config.offline_mode = false;
    saveConfig(config);

    // Okamžité přednačtení z lokální mezipaměti pro nulové zpoždění zobrazení
    try {
        const cachedState = loadLauncherCache();
        if (cachedState && Array.isArray(cachedState.versions) && cachedState.versions.length > 0) {
            availableVersions = cachedState.versions;
            if (cachedState.user_role) currentUserRole = cachedState.user_role;
            if (typeof updateCustomSelectUI === 'function') updateCustomSelectUI(availableVersions);
        }
    } catch (_) { }

    const isCommunityMode = (() => {
        try { return new URLSearchParams(window.location.search).get('mode') === 'community'; }
        catch (_) { return false; }
    })();

    // Rychlá paralelní kontrola pouze metadat aktualizace launcheru (stahování spouštíme až po potvrzení)
    const updateMetaPromise = isCommunityMode ? Promise.resolve(null) : checkLauncherUpdateMeta().catch(e => {
        console.warn('[LauncherUpdate] Kontrola aktualizace selhala:', e);
        return null;
    });

    currentHWID = await getHWID();
    if (typeof hwidText !== 'undefined' && hwidText) hwidText.innerText = "HWID: " + currentHWID;

    const updateMeta = await updateMetaPromise;
    if (updateMeta && updateMeta.hasUpdate) {
        const didInstall = await downloadAndInstallLauncherUpdate(updateMeta.dlUrl, updateMeta.remoteVer);
        if (didInstall) return;
    }

    if (config.discord_id || config.email) {
        // Uživatel už je přihlášen, pustíme ho dál
        await initLauncher(config);
        if (typeof initLCBridgeData === 'function') await initLCBridgeData();
        if (window.LC) {
            window.LC.showBoot(false);
            if (isCommunityMode) {
                window.LC.show('editor');
                if (window.LC.selTab) window.LC.selTab('comm');
            } else {
                window.LC.show('game');
            }
        }
        const overlay = document.getElementById('initial-loading-overlay');
        if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
    } else {
        // Není přihlášen, zobrazit auth
        const overlay = document.getElementById('initial-loading-overlay');
        if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
        if (typeof loginOverlay !== 'undefined' && loginOverlay) { loginOverlay.hidden = false; loginOverlay.style.display = 'flex'; }
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
    const views = {
        discord: loginDiscordView,
        waiting: loginWaitingView,
        email: loginEmailView,
        emailCode: loginEmailCodeView,
        emailCodeManual: document.getElementById('login-email-code-manual-view'),
        success: document.getElementById('login-success-view'),
        failure: document.getElementById('login-failure-view')
    };

    Object.keys(views).forEach(k => {
        const el = views[k];
        if (el) {
            const isMatch = (k === viewName);
            el.hidden = !isMatch;
            el.style.display = isMatch ? 'flex' : 'none';
        }
    });

    const titleElT = document.querySelector('#login-overlay > div > div:first-child');
    if (titleElT) {
        titleElT.style.display = (viewName === 'success' || viewName === 'failure') ? 'none' : 'block';
    }

    if (window.LC && window.LC.setLoginView) {
        const lcKeyMap = {
            discord: 'discord',
            waiting: 'waiting',
            email: 'email',
            emailCode: 'email-code',
            emailCodeManual: 'email-manual',
            success: 'success',
            failure: 'failure'
        };
        if (lcKeyMap[viewName]) window.LC.setLoginView(lcKeyMap[viewName]);
    }

    // Zajištění, že se nezasekne disabled stav (např. při reloadu stránky)
    let isLocked = (lockoutEndTime > Date.now());
    if (inputIdentifier) inputIdentifier.disabled = isLocked;
    if (inputEmail) inputEmail.disabled = false; // email is separate
    if (btnStartAuth) btnStartAuth.disabled = isLocked;
    if (btnStartEmailAuth) {
        btnStartEmailAuth.disabled = false;
        btnStartEmailAuth.innerText = 'Poslat přihlašovací odkaz';
    }
}

function showLoginFailure(title, desc, authType = 'discord', isNotFound = false) {
    if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
    if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
    window._lastAuthType = authType;

    const titleEl = document.getElementById('login-failure-title');
    if (titleEl) titleEl.textContent = title || 'Ověření se nezdařilo';

    const descEl = document.getElementById('login-failure-desc');
    if (descEl) descEl.textContent = desc || 'Došlo k chybě při ověření.';

    const btnCreate = document.getElementById('btn-failure-create-account');
    if (btnCreate) btnCreate.hidden = !isNotFound;

    if (window.LC && window.LC.showLoginFailure) {
        window.LC.showLoginFailure(title, desc, authType, isNotFound);
    } else {
        showAuthView('failure');
    }
}

const btnRetryAuthEl = document.getElementById('btn-retry-auth');
if (btnRetryAuthEl) {
    btnRetryAuthEl.addEventListener('click', () => {
        if (window._lastAuthType === 'email') {
            showAuthView('email');
        } else {
            showAuthView('discord');
        }
    });
}

linkShowEmailLogin.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthView('email');
});

linkShowDiscordLogin.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthView('discord');
});

let isEmailAuthInProgress = false;

async function performEmailAuth(email, nick, mode = 'login') {
    if (isEmailAuthInProgress) return false;
    isEmailAuthInProgress = true;
    try {
        email = (email || (inputEmail ? inputEmail.value : '')).trim();
        const inputNick = document.getElementById('login-nick-input');
        nick = (nick || (inputNick ? inputNick.value : '')).trim();

        if (mode === 'signup' && (!nick || nick.length < 3 || nick.length > 24)) {
            showLoginError("Zadejte prosím přezdívku (3 až 24 znaků)!");
            return false;
        }
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            showLoginError("Zadejte platný e-mail!");
            return false;
        }

        window._lastAuthType = 'email';
        window._lastEmailMode = mode;
        window._lastEmailNick = nick;
        currentPendingEmail = email;
        if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
        if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
        window.lastEmailSentAt = Date.now();

        if (btnStartEmailAuth) {
            btnStartEmailAuth.disabled = true;
            btnStartEmailAuth.innerText = 'ODESÍLÁM...';
        }

        showAuthView('emailCode');
        const statusEl = document.getElementById('email-waiting-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = '<i class="fas fa-paper-plane" style="margin-right: 6px;"></i>Odesílám odkaz na e-mail...';
        }

        try {
            const res = await fetch(`${API_BASE}/api/auth/email/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, nick: nick, intent: mode === 'signup' ? 'app_signup' : 'app_login', source: 'launcher' })
            });

            const data = await res.json().catch(() => ({}));
            if (data.success || data.status === 'success' || res.ok) {
                window.emailAuthTimeoutTimer = setTimeout(() => {
                    if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
                    showLoginFailure("Čas vypršel", "Čas na ověření e-mailu vypršel (10 minut). Zkuste to prosím znovu.", "email");
                }, 600000);

                const retryBtns = document.getElementById('email-retry-buttons');
                if (retryBtns) {
                    retryBtns.hidden = true;
                    retryBtns.style.display = 'none';
                    if (window.retryBtnsTimeout) clearTimeout(window.retryBtnsTimeout);
                    window.retryBtnsTimeout = setTimeout(() => {
                        retryBtns.hidden = false;
                        retryBtns.style.display = 'flex';
                    }, 6000);
                }
                pollAuthEmail(email);
                return true;
            } else {
                const msg = data.message || data.error || "Zkontrolujte zadanou adresu a zkuste to znovu.";
                const isNotFound = res.status === 404 || data.status === 'not_found' || data.error_type === 'account_not_found';
                showLoginFailure(
                    isNotFound ? "Účet nebyl nalezen" : "Nepodařilo se odeslat e-mail",
                    isNotFound ? (data.message || "Účet s tímto e-mailem nebyl nalezen. Zkontrolujte prosím správnost vašeho e-mailu, nebo si níže vytvořte nový účet.") : msg,
                    "email",
                    isNotFound
                );
                return false;
            }
        } catch (e) {
            showLoginFailure("Chyba spojení", "Nepodařilo se spojit se serverem pro odeslání e-mailu.", "email");
            return false;
        } finally {
            if (btnStartEmailAuth) {
                btnStartEmailAuth.disabled = false;
                btnStartEmailAuth.innerText = window._lastEmailMode === 'signup' ? 'Vytvořit účet a poslat kód' : 'Poslat přihlašovací odkaz';
            }
        }
    } finally {
        isEmailAuthInProgress = false;
    }
}

const btnFailureCreateAccountEl = document.getElementById('btn-failure-create-account');
if (btnFailureCreateAccountEl) {
    btnFailureCreateAccountEl.addEventListener('click', () => {
        if (window.LC && window.LC.setEmailMode) {
            window.LC.setEmailMode('signup');
            window.LC.setLoginView('email');
        } else {
            showAuthView('email');
        }
    });
}

function pollAuthEmail(email) {
    if (window.emailPollInterval) clearInterval(window.emailPollInterval);
    const statusEl = document.getElementById('email-waiting-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = '<i class="fas fa-hourglass-half" style="margin-right: 5px;"></i>Čekám na potvrzení v e-mailu...';
    }
    window.emailPollInterval = setInterval(async () => {
        try {
            const pollRes = await fetch(`${API_BASE}/api/launcher/email_poll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const pollData = await pollRes.json().catch(() => ({}));
            if (pollData.status === 'success') {
                if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
                if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
                if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: #22c55e; margin-right: 5px;"></i>Ověřeno! Přihlašuji...';
                let config = loadConfig();
                config.discord_id = pollData.discord_id || "email-" + (pollData.id || pollData.email);
                config.discord_nick = pollData.nick || pollData.email;
                config.email = pollData.email;
                if (pollData.web_session_token) config.web_session_token = pollData.web_session_token;
                saveConfig(config);
                showAuthView('success');
                setTimeout(async () => {
                    loginOverlay.style.display = 'none';
                    loginOverlay.hidden = true;
                    await initLauncher(config);
                    if (typeof initLCBridgeData === 'function') await initLCBridgeData();
                    if (window.LC) {
                        window.LC.showLogin(false);
                        window.LC.show('game');
                    }
                }, 1800);
            } else if (pollData.status === 'timeout') {
                if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
                if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
                showLoginFailure("Platnost odkazu vypršela", pollData.message || "Platnost přihlašovacího odkazu a kódu vypršela. Zkuste to prosím znovu.", "email");
            } else if (pollData.status === 'error') {
                if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
                if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
                showLoginFailure("Chyba ověření", pollData.message || "Při ověření e-mailu došlo k chybě.", "email");
            }
        } catch (_) { }
    }, 4000);
}

async function handleResendEmail() {
    const elapsed = Date.now() - (window.lastEmailSentAt || 0);
    const cooldown = 30000;
    if (elapsed < cooldown) {
        const remSec = Math.ceil((cooldown - elapsed) / 1000);
        if (window.LC) window.LC.toast('warn', 'Počkejte chvíli', `Další e-mail můžete odeslat za ${remSec} s.`);
        return;
    }
    const email = currentPendingEmail || (inputEmail && inputEmail.value.trim());
    if (!email) return;
    const ok = await performEmailAuth(email, window._lastEmailNick || '', window._lastEmailMode || 'login');
    if (ok && window.LC) window.LC.toast('info', 'E-mail odeslán znovu', 'Byl odeslán nový přihlašovací odkaz a 6místný kód.');
}

if (btnResendEmailAuth) {
    btnResendEmailAuth.addEventListener('click', (e) => {
        e.stopPropagation();
        handleResendEmail();
    });
}
document.addEventListener('lc:resend-email-auth', handleResendEmail);

const btnManualCode = document.getElementById('btn-manual-code-input');
if (btnManualCode) {
    btnManualCode.addEventListener('click', () => {
        if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
        showAuthView('emailCodeManual');
    });
}

async function performVerifyCode(code) {
    code = String(code || '').trim();
    const email = currentPendingEmail || (inputEmail && inputEmail.value.trim());

    if (!/^\d{6}$/.test(code)) {
        showLoginError("Zadejte platný 6místný číselný kód z e-mailu.");
        return;
    }

    if (btnVerifyEmailCodeManual) {
        btnVerifyEmailCodeManual.disabled = true;
        btnVerifyEmailCodeManual.innerText = 'OVĚŘUJI...';
    }

    try {
        const verifyRes = await fetch(`${API_BASE}/api/launcher/email_verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, hwid: currentHWID })
        });
        const verifyData = await verifyRes.json().catch(() => ({}));
        if (verifyData.status === 'success') {
            if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
            if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
            let config = loadConfig();
            config.discord_id = verifyData.discord_id || "email-" + (verifyData.id || verifyData.email || email);
            config.discord_nick = verifyData.nick || verifyData.email || email;
            config.email = verifyData.email || email;
            if (verifyData.web_session_token) config.web_session_token = verifyData.web_session_token;
            saveConfig(config);
            showAuthView('success');
            setTimeout(async () => {
                loginOverlay.style.display = 'none';
                loginOverlay.hidden = true;
                await initLauncher(config);
                if (typeof initLCBridgeData === 'function') await initLCBridgeData();
                if (window.LC) {
                    window.LC.showLogin(false);
                    window.LC.show('game');
                }
            }, 1800);
        } else {
            const msg = verifyData.message || "Zadaný kód je neplatný nebo již vypršel.";
            if (verifyRes.status === 429 || verifyRes.status === 403 || msg.toLowerCase().includes('vypršel') || msg.toLowerCase().includes('pokus')) {
                if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
                showLoginFailure("Ověření se nezdařilo", msg, "email");
            } else {
                showLoginError(msg);
            }
        }
    } catch (e) {
        showLoginFailure("Chyba ověření", "Nepodařilo se ověřit kód se serverem.", "email");
    } finally {
        if (btnVerifyEmailCodeManual) {
            btnVerifyEmailCodeManual.disabled = false;
            btnVerifyEmailCodeManual.innerText = 'Ověřit kód';
        }
    }
}

const btnVerifyEmailCodeManual = document.getElementById('btn-verify-email-code-manual');
if (btnVerifyEmailCodeManual) {
    btnVerifyEmailCodeManual.addEventListener('click', () => {
        const inputCode = document.getElementById('login-email-code-manual-input');
        const code = inputCode ? inputCode.value.trim() : '';
        performVerifyCode(code);
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
    if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
    if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }
    showAuthView('discord');
});

btnCancelAuth.addEventListener('click', () => {
    if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
    showAuthView('discord');
    if (inputIdentifier) inputIdentifier.disabled = false;
});

let isDiscordAuthInProgress = false;

async function performDiscordAuth(val) {
    if (isDiscordAuthInProgress) return;
    isDiscordAuthInProgress = true;
    try {
        val = (val || (inputIdentifier ? inputIdentifier.value : '')).trim();
        if (!val) {
            showLoginError("Zadejte své Discord uživatelské jméno nebo ID!");
            return;
        }

        window._lastAuthType = 'discord';
        if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
        if (inputIdentifier) inputIdentifier.disabled = true;

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

            if (data.status === 'waiting') {
                if (titleEl) titleEl.innerHTML = '<i class="fas fa-hourglass-half" style="margin-right: 8px; color: #facc15;"></i>Čekám na Vaši reakci...';
                authPollInterval = setInterval(() => pollAuth(data.discord_id), 6000);
            } else {
                if (inputIdentifier) inputIdentifier.disabled = false;
                let errMsg = data.message || "Toto uživatelské jméno ani Discord ID nebylo nalezeno.";
                showLoginFailure("Uživatel nenalezen", errMsg, "discord");
            }
        } catch (e) {
            if (inputIdentifier) inputIdentifier.disabled = false;
            let errMsg = e.message === 'timeout'
                ? "Ověřování trvá déle než obvykle. Server se probouzí, zkuste to prosím znovu."
                : "Chyba spojení se serverem nebo neplatná data.";
            showLoginFailure("Chyba spojení", errMsg, "discord");
        }
    } finally {
        isDiscordAuthInProgress = false;
    }
}

btnStartAuth.addEventListener('click', () => {
    performDiscordAuth();
});

async function pollAuth(discordId) {
    try {
        const res = await fetch(`${API_BASE}/api/app_check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: discordId, hwid: currentHWID })
        });
        const data = await res.json().catch(() => ({}));

        if (data.status === 'success') {
            if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
            let titleEl = document.getElementById('login-waiting-title');
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-check-circle" style="margin-right: 8px; color: #22c55e;"></i>Schváleno! Přihlašuji...';

            let config = loadConfig();
            config.discord_id = discordId;
            config.discord_nick = data.display_name || "Uživatel";
            if (data.web_session_token) config.web_session_token = data.web_session_token;
            saveConfig(config);

            showAuthView('success');
            setTimeout(async () => {
                loginOverlay.style.display = 'none';
                loginOverlay.hidden = true;
                await initLauncher(config);
                if (typeof initLCBridgeData === 'function') await initLCBridgeData();
                if (window.LC) {
                    window.LC.showLogin(false);
                    window.LC.show('game');
                }
            }, 1800);
        } else if (data.status === 'timeout') {
            if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
            showLoginFailure("Čas vypršel", data.message || "Čas pro ověření na Discordu vypršel. Zkuste to prosím znovu.", "discord");
            if (inputIdentifier) inputIdentifier.disabled = false;
        } else if (data.status === 'error' || data.status === 'rejected') {
            if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
            showLoginFailure("Přihlášení zamítnuto", data.message || "Požadavek na přihlášení byl zamítnut.", "discord");
            if (inputIdentifier) inputIdentifier.disabled = false;
        }
    } catch (e) {
        // Ignorovat dočasný výpadek sítě během pollingu
    }
}

async function initLauncher(config) {
    try {
        if (hwidDisplay) hwidDisplay.innerText = config.discord_nick || currentHWID;

        // Získat aktuální roli a čerstvou relaci z users tabulky
        try {
            const ref = await refreshLauncherSessionAndRole(true);
            if (!ref || !ref.ok) {
                currentUserRole = config.user_role || 'User';
            }
        } catch (eRole) {
            console.warn('[initLauncher] Nelze načíst roli ze serveru, použita uložená role:', eRole.message || eRole);
            currentUserRole = config.user_role || 'User';
        }
        if (!window.LC && (currentUserRole.includes('DEV') || currentUserRole.includes('SA'))) {
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

        let color = '#64748b'; // public
        if (currentUserRole.includes('DEV') || currentUserRole.includes('SA')) color = '#ef4444';
        else if (currentUserRole.includes('BT')) color = '#3b82f6';

        if (!window.LC && roleDisplay) {
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
        } catch (_) { }

        await loadAvailableVersions();
    } catch (e) {
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
        } catch (_) { }

        await loadAvailableVersions();
    }
}

function _escapeHtmlSafe(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showLockedScreen(msg) {
    const overlay = document.getElementById('initial-loading-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.hidden = false;
    const safeMsg = _escapeHtmlSafe(msg || 'Probíhá údržba systému nebo byla pozastavena distribuce. Pro více informací kontaktujte podporu na Discordu.');
    overlay.innerHTML = `
        <div style="background: rgba(18, 10, 10, 0.95); padding: 42px 36px; border-radius: 20px; border: 2px solid #ef4444; text-align: center; max-width: 480px; box-shadow: 0 0 50px rgba(239, 68, 68, 0.4); animation: mIn 0.35s ease both; position: relative; z-index: 1000;">
            <div style="width: 70px; height: 70px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); border: 2px solid #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
            </div>
            <h1 style="color: #ffffff; margin: 0 0 10px; font-size: 24px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">Launcher Uzamčen</h1>
            <p style="color: #cbd5e1; font-size: 15px; font-weight: 600; margin: 0 0 16px;">
                Tento launcher byl uzamčen administrátorem.
            </p>
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 12px 16px; color: #fca5a5; font-size: 13.5px; line-height: 1.5; margin-bottom: 24px;">
                ${safeMsg}
            </div>
            <button onclick="window.close()" style="background: #ef4444; border: none; color: #ffffff; padding: 12px 32px; border-radius: 10px; cursor: pointer; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; transition: 0.2s; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);">
                Ukončit launcher
            </button>
        </div>
    `;
}

function compareVersionsDesc(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const parseVer = (v) => {
        const str = String(v.db_version || v.version_name || v.id || v.name || '').trim();
        const m = str.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
        if (m) {
            const major = parseInt(m[1], 10) || 0;
            const minor = parseInt(m[2], 10) || 0;
            const patch = parseInt(m[3], 10) || 0;
            return major * 1000000 + minor * 1000 + patch;
        }
        return Number(v.id) || 0;
    };
    const scoreA = parseVer(a);
    const scoreB = parseVer(b);
    if (scoreB !== scoreA) {
        return scoreB - scoreA;
    }
    const idA = Number(a.id) || 0;
    const idB = Number(b.id) || 0;
    return idB - idA;
}

async function loadAvailableVersions() {
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
                    if (data.user_role) {
                        currentUserRole = data.user_role;
                        if (cfg.user_role !== currentUserRole) {
                            cfg.user_role = currentUserRole;
                            saveConfig(cfg);
                        }
                        if (window.LC && window.LC.setUser) {
                            window.LC.setUser({
                                name: cfg.discord_nick || cfg.email || 'Uživatel',
                                hwid: currentHWID,
                                role: mapRoleToLC(currentUserRole),
                                avatar_url: cfg.avatar_url || (typeof currentUserAvatarUrl !== 'undefined' ? currentUserAvatarUrl : null)
                            });
                        }
                    }
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
                    const banEl = document.getElementById('initial-loading-overlay');
                    if (banEl) {
                        banEl.hidden = false;
                        banEl.style.display = 'flex';
                        banEl.innerHTML = `
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
                    }
                    return;
                } else if (data.status === 'locked' || (data.status === 'error' && data.message && (data.message.includes('uzamčen') || data.message.includes('údržb'))) || data.is_locked || data.launcher_locked) {
                    showLockedScreen(data.message || "Launcher byl uzamčen administrátorem.");
                    return;
                } else if (data.status === 'error') {
                    showLockedScreen(data.message || "Přístup k aplikaci byl odmítnut.");
                    return;
                } else {
                    console.error("Chyba při načítání verzí z API:", data.message);
                }
            }
        } catch (e) {
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
            } catch (_) { }
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

    finalVersions.sort(compareVersionsDesc);
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
    const cs2 = document.getElementById('custom-version-select'); if (cs2) cs2.classList.remove('disabled');
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
    try { files = fs.readdirSync(folder); } catch (_) { }
    let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
    if (exeFile) return path.join(folder, exeFile);
    let subFolder = path.join(folder, 'win-unpacked');
    if (fs.existsSync(subFolder)) {
        let subFiles = [];
        try { subFiles = fs.readdirSync(subFolder); } catch (_) { }
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
            } else if (dataCheck.status === 'error' || dataCheck.status === 'locked' || dataCheck.status === 'banned') {
                showLockedScreen(dataCheck.message || "Launcher je uzamčen administrátorem.");
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
        try { files = fs.readdirSync(folder); } catch (e) { }
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
            try { subFiles = fs.readdirSync(subFolder); } catch (e) { }
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
    const cs1 = document.getElementById('custom-version-select'); if (cs1) cs1.classList.add('disabled');
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
    } catch (e) {
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
            try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) { }
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
            try { if (fs.existsSync(zipPath)) await fs.promises.unlink(zipPath); } catch (_) { }
        }

        // 4. Uložit výchozí build_info.json po plném stažení
        try {
            const curV = availableVersions.find(v => v.db_version === versionName);
            const initBuild = (curV && curV.current_build) ? curV.current_build : versionName;
            const bData = {
                version: versionName,
                build: initBuild,
                current_build: initBuild,
                build_number: (curV && curV.build_number) ? Number(curV.build_number) : undefined,
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
            } catch (_) { }
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
        try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) { }
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
        if (window.LC) {
            window.LC.showDownload(false);
            window.LC.showError("Chybí patch balíček", "Pro tuto verzi nebyl nastaven odkaz na patch balíček v databázi.");
            updateLCLaunchState(versionName);
        } else {
            showError("Pro tuto verzi nebyl nastaven odkaz na patch balíček v databázi.");
            checkLocalVersion(versionName);
        }
        return false;
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
    if (window.LC && window.LC.showDownload) {
        window.LC.setLaunchState('downloading', 'Aktualizuji…');
        window.LC.showDownload(true, { title: `Aktualizace ${versionName} (${targetBuild})` });
        window.LC.setProgress({ pct: 0, phase: 0, speed: '—', done: '0 MB', eta: '—', sub: `Příprava aktualizace (${targetBuild})…` });
    }

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
                            sub: `Stahuji aktualizaci ${targetBuild}…`
                        });
                    }
                } else {
                    const dlMB = (downloaded / (1024 * 1024)).toFixed(1);
                    progressText.innerText = `Stahování aktualizace: ${dlMB} MB (${speedMBps} MB/s)`;
                }
            }
        });

        // Ověřit platnost archivu před rozbalením
        const zipCheck = isValidZipFile(patchZipPath);
        if (!zipCheck.valid) {
            try { if (fs.existsSync(patchZipPath)) fs.unlinkSync(patchZipPath); } catch (_) { }
            throw new Error(`Stažený patch balíček je neplatný: ${zipCheck.reason}`);
        }

        progressText.innerText = 'Instalace aktualizace... (přepisování souborů)';
        launchText.innerText = 'INSTALACE...';
        if (window.LC && window.LC.setProgress) {
            window.LC.setProgress({ pct: 85, phase: 1, speed: '—', sub: 'Aplikuji aktualizaci na disku…' });
        }

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
            try { if (fs.existsSync(patchZipPath)) await fs.promises.unlink(patchZipPath); } catch (_) { }
        }

        // Uložit build_info.json s novým číslem buildu
        const curV = (availableVersions || []).find(x => x.db_version === versionName);
        const buildData = {
            version: versionName,
            build: targetBuild,
            current_build: targetBuild,
            build_number: (curV && curV.build_number) ? Number(curV.build_number) : undefined,
            updated_at: new Date().toLocaleString('cs-CZ')
        };
        const buildJsonStr = JSON.stringify(buildData, null, 2);
        try { fs.writeFileSync(path.join(folder, 'build_info.json'), buildJsonStr, 'utf8'); } catch (_) { }
        try {
            const subF = path.join(folder, 'win-unpacked');
            if (fs.existsSync(subF)) {
                fs.writeFileSync(path.join(subF, 'build_info.json'), buildJsonStr, 'utf8');
            }
        } catch (_) { }

        progressFill.style.width = '100%';
        progressText.innerText = `Aktualizace na ${targetBuild} byla úspěšně dokončena!`;
        if (window.LC && window.LC.setProgress) {
            window.LC.setProgress({ pct: 100, phase: 2, speed: '—', sub: 'Aktualizace dokončena!' });
        }
        await new Promise(r => setTimeout(r, 600));
        progressContainer.style.display = 'none';

        btnLaunch.classList.remove('btn-locked');
        btnLaunch.disabled = false;
        versionSelect.disabled = false;
        if (cs1) cs1.classList.remove('disabled');

        checkLocalVersion(versionName);
        if (window.LC) {
            window.LC.showDownload(false);
            syncWithLCVersions();
            updateLCLaunchState(versionName);
            window.LC.toast('ok', 'Aktualizace nainstalována', `Build ${targetBuild} je připraven ke spuštění.`);
        }
        return true;
    } catch (err) {
        try { if (fs.existsSync(patchZipPath)) fs.unlinkSync(patchZipPath); } catch (_) { }
        progressContainer.style.display = 'none';
        btnLaunch.classList.remove('btn-locked');
        btnLaunch.disabled = false;
        versionSelect.disabled = false;
        if (cs1) cs1.classList.remove('disabled');
        if (window.LC) {
            window.LC.showDownload(false);
            window.LC.setLaunchState('error');
            window.LC.showError('Chyba aktualizace', err.message || 'Aktualizace selhala.');
        } else {
            showError("Chyba při instalaci aktualizace: " + err.message);
        }
        return false;
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
// Kontrola aktualizace Launcheru probíhá jednotně přes událost lc:launcher-update

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
    const cs2 = document.getElementById('custom-version-select'); if (cs2) cs2.classList.remove('disabled');
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
        }).catch(() => { });
    }
}

function _getOrCreatePersistedFallbackHwid(prefix = 'HWID-') {
    try {
        const cfg = loadConfig();
        if (cfg && cfg.hwid_fallback) return cfg.hwid_fallback;
        const gen = prefix + Math.random().toString(36).substring(2, 11).toUpperCase();
        cfg.hwid_fallback = gen;
        saveConfig(cfg);
        return gen;
    } catch (_) {
        return prefix + Math.random().toString(36).substring(2, 11).toUpperCase();
    }
}

function getHWID() {
    return new Promise((resolve) => {
        const isValidUuid = (s) => {
            const v = String(s || '').trim();
            return v.length >= 8 && !/^([F0-]+|UUID)$/i.test(v);
        };
        if (process.platform !== 'win32') {
            resolve(_getOrCreatePersistedFallbackHwid('NONWIN-'));
            return;
        }
        let isDone = false;
        const finish = (val) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            resolve(val);
        };
        const timer = setTimeout(() => finish(_getOrCreatePersistedFallbackHwid('FALLBACK-HWID-')), 4500);

        exec('wmic csproduct get uuid', { timeout: 2000 }, (err, stdout) => {
            if (!err && stdout) {
                const line = stdout.split(/\r?\n/).map(x => x.trim()).find(x => isValidUuid(x));
                if (line) return finish(line);
            }
            const psCmd = 'powershell -NoProfile -Command "$u=(Get-CimInstance Win32_ComputerSystemProduct).UUID; if(-not $u){$u=(Get-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Cryptography -ErrorAction SilentlyContinue).MachineGuid}; $u"';
            exec(psCmd, { timeout: 2500 }, (psErr, psOut) => {
                if (!psErr && psOut) {
                    const line = psOut.split(/\r?\n/).map(x => x.trim()).find(x => isValidUuid(x));
                    if (line) return finish(line);
                }
                finish(_getOrCreatePersistedFallbackHwid('UNKNOWN-HWID-'));
            });
        });
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
            } catch (_) { }

            await loadAvailableVersions();
            updateSettingsVersionList();
            alert('Aktualizace zkontrolovány! Seznam verzí byl obnoven.');
        } catch (e) {
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

// Otevírání složek uživatele (bezpečné, jedno otevření bez duplikátů)
let lastFolderOpenTime = 0;
function safeOpenFolder(dirPath) {
    const now = Date.now();
    if (now - lastFolderOpenTime < 1200) return;
    lastFolderOpenTime = now;
    try {
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        const { shell } = require('electron');
        shell.openPath(dirPath);
    } catch (err) {
        console.warn('Chyba při otevírání složky:', err);
    }
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
            } catch (e) {
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
                fs.mkdirSync(versionsDir, { recursive: true });
            }
            alert('Hotovo! Všechna stažená data byla smazána. Při příštím spuštění se hra stáhne znovu.');
            checkLocalVersion(versionSelect.value);
        } catch (e) {
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


// Custom select – otevírání a zavírání řídí launcher.html (openSelect/closeSelect)
// Zde pouze pojistka zavření při kliknutí mimo, pokud by nebylo zachyceno
(function initCustomSelect() {
    const customSelect = document.getElementById('custom-version-select');
    if (!customSelect) return;

    document.addEventListener('click', (e) => {
        if (!customSelect.contains(e.target)) {
            customSelect.classList.remove('open');
            const customOptions = document.getElementById('custom-options-container');
            if (customOptions) customOptions.hidden = true;
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
        tDiv.innerHTML = `<svg class="ic" style="width:13px;height:13px;margin-right:8px;"><use href="#i-box"/></svg><span>${txt}</span>`;
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
            if (customOptions) customOptions.hidden = true;

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
        const sideVerEl = document.getElementById('side-ver');
        if (sideVerEl) sideVerEl.textContent = `v${LAUNCHER_VERSION}`;
    } catch (e) { }

    ['settings-discord-link', 'side-discord'].forEach(linkId => {
        const discLink = document.getElementById(linkId);
        if (discLink) {
            discLink.addEventListener('click', (e) => {
                e.preventDefault();
                const { shell } = require('electron');
                shell.openExternal('https://discord.com/invite/vmTagbC9mF');
            });
        }
    });
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
    } catch (e) {
        if (errEl) errEl.textContent = 'Chyba spojení se serverem (' + (e.message || e) + ').';
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE PRO LAUNCHER OIS IDPK (window.LC + lc:* CustomEvents)
// ═══════════════════════════════════════════════════════════════════════════════

function mapRoleToLC(r) {
    if (!r) return 'user';
    const s = String(r).toLowerCase().trim();
    if (s === 'sa' || /\bsa\b/.test(s) || s.includes('superadmin') || s.includes('server manager') || s === 'sm') return 'sa';
    if (s === 'dev' || /\bdev\b/.test(s) || s.includes('developer') || s.includes('vývojář') || s.includes('vyvojar')) return 'dev';
    if (s.includes('admin') || s.includes('správce') || s.includes('vedení')) return 'admin';
    if (s === 'bt' || /\bbt\b/.test(s) || s.includes('tester') || s.includes('beta')) return 'tester';
    if (s.includes('supporter') || s.includes('podporovatel') || s.includes('předplatitel') || s.includes('vip')) return 'supporter';
    return 'user';
}

function syncWithLCVersions() {
    if (!window.LC || !window.LC.setVersions || !Array.isArray(availableVersions)) return;
    availableVersions.sort(compareVersionsDesc);
    const lcList = availableVersions.map(v => {
        const folder = getVersionFolder(v.db_version);
        const exePath = findExeInFolder(folder);
        const isInstalled = Boolean(exePath);
        const hasUpdate = isInstalled && hasVersionPatchUpdate(v, folder);
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
            target_role: v.target_role || 'User',
            size: v.file_size || '1.2 GB',
            installed: isInstalled,
            update: hasUpdate,
            lock: !v.has_access || !v.can_launch
        };
    });
    lcList.sort(compareVersionsDesc);
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
    const hasUpdate = isInstalled && hasVersionPatchUpdate(v, folder);
    if (!v.has_access || !v.can_launch) {
        const roleUpper = String(v.target_role || 'User').toUpperCase();
        const isBtRole = roleUpper === 'BT' || roleUpper.includes('BETA') || roleUpper.includes('SUPPORTER') || roleUpper.includes('PODPOR') || roleUpper.includes('TESTER');
        window.LC.setLaunchState('locked', isBtRole ? 'Pouze pro beta testery / podporovatele' : 'Zamčeno');
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

        let targetLineKey = '';
        if (line.source === 'gtfs' || line.license || line.gtfs_route_id) {
            targetLineKey = line.license || line.gtfs_route_id || line.num;
        } else {
            targetLineKey = line.id || line.num;
        }
        let txt = `GTFS-DATA\nLinka: ${targetLineKey}\n`;
        const lastStop = line.dest || (line.stops && line.stops.length ? (line.stops[line.stops.length - 1].n || line.stops[line.stops.length - 1].name) : '');
        txt += `Směr: ${lastStop}\n`;

        const genSnd = line.general_sounds || {};
        const nextSnd = (genSnd.next && genSnd.next.snd && genSnd.next.snd.name) || (line.ann_next && line.ann_next.name) || '';
        const reqSnd = (genSnd.req && genSnd.req.snd && genSnd.req.snd.name) || (line.ann_req && line.ann_req.name) || '';
        const termSnd = (genSnd.terminus && genSnd.terminus.snd && genSnd.terminus.snd.name) || (line.ann_term && line.ann_term.name) || '';

        if (nextSnd) txt += `Zvuk_Pristi_Zastavka: ${nextSnd}\n`;
        if (reqSnd) txt += `Zvuk_Zastavka_Na_Znameni: ${reqSnd}\n`;
        if (termSnd) txt += `Zvuk_Konecna_Zastavka: ${termSnd}\n`;

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

        // Také synchronizovat do všech existujících složek verzí a dev prostředí
        try {
            const versionsDir = path.join(userDataPath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const vFolders = fs.readdirSync(versionsDir);
                vFolders.forEach(vf => {
                    const vLinky1 = path.join(versionsDir, vf, 'linky');
                    if (fs.existsSync(vLinky1)) {
                        try { fs.writeFileSync(path.join(vLinky1, filename), txt, 'utf-8'); } catch (_) { }
                    }
                    const vLinky2 = path.join(versionsDir, vf, 'resources', 'linky');
                    if (fs.existsSync(vLinky2)) {
                        try { fs.writeFileSync(path.join(vLinky2, filename), txt, 'utf-8'); } catch (_) { }
                    }
                });
            }
            if (typeof devPath !== 'undefined' && devPath) {
                const devLinky = path.join(devPath, 'linky');
                if (fs.existsSync(devLinky)) {
                    try { fs.writeFileSync(path.join(devLinky, filename), txt, 'utf-8'); } catch (_) { }
                }
            }
        } catch (_) { }
    } catch (e) {
        console.error('[syncRouteFileToLinky] Chyba:', e);
    }
}

function reconcileLinesWithGameApplication(lines) {
    try {
        if (!Array.isArray(lines)) {
            if (window.LC && window.LC.S && Array.isArray(window.LC.S.lines)) {
                lines = window.LC.S.lines;
            } else {
                return;
            }
        }

        const allowedSafeNums = new Set();
        const allowedIds = new Set();
        lines.forEach(l => {
            if (!l) return;
            const safeNum = String(l.num || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
            if (safeNum) allowedSafeNums.add(safeNum);
            if (l.id) allowedIds.add(String(l.id));
        });

        // 1. Projít složky linky a odstranit osiřelé *_custom.txt
        const linkDirs = [
            path.join(centralUserDataPath, 'linky')
        ];
        if (typeof devPath !== 'undefined' && devPath) {
            linkDirs.push(path.join(devPath, 'linky'));
        }
        const versionsDir = path.join(userDataPath, 'versions');
        if (fs.existsSync(versionsDir)) {
            try {
                const vFolders = fs.readdirSync(versionsDir);
                vFolders.forEach(vf => {
                    linkDirs.push(path.join(versionsDir, vf, 'linky'));
                    linkDirs.push(path.join(versionsDir, vf, 'resources', 'linky'));
                });
            } catch (_) { }
        }

        linkDirs.forEach(dir => {
            if (!fs.existsSync(dir)) return;
            try {
                const files = fs.readdirSync(dir);
                files.forEach(f => {
                    if (f.toLowerCase().endsWith('_custom.txt')) {
                        const nameNoCustom = f.replace(/_custom\.txt$/i, '');
                        if (!allowedSafeNums.has(nameNoCustom)) {
                            try {
                                fs.unlinkSync(path.join(dir, f));
                                console.log(`[Reconcile] Odstraněna osiřelá linka ze hry: ${path.join(dir, f)}`);
                            } catch (_) { }
                        }
                    }
                });
            } catch (_) { }
        });

        // 3. Pro všechny aktivní linky zajistit aktuální *_custom.txt soubor
        lines.forEach(l => {
            if (l && l.num) {
                try {
                    syncRouteFileToLinky(l);
                } catch (_) { }
            }
        });

        // 4. Pročistit mezipaměť v hlavním procesu Electronu
        if (typeof ipcRenderer !== 'undefined' && ipcRenderer.invoke) {
            ipcRenderer.invoke('purge-custom-route-cache').catch(() => { });
        }
    } catch (err) {
        console.warn('[reconcileLinesWithGameApplication] Chyba synchronizace:', err);
    }
}

async function loadLocalEditorLines(syncDb = true) {
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
        const curCfg = loadConfig();
        const currentUserId = String(curCfg.discord_id || curCfg.email || '').trim().toLowerCase();
        const currentUserNick = String(curCfg.discord_nick || '').trim().toLowerCase();
        const currentEmail = String(curCfg.email || '').trim().toLowerCase();

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
                    // Izolace vlastních linek podle přihlášeného účtu na stejném PC (bod 4)
                    const isCustomFile = f.startsWith('user_') || parsed.is_custom;
                    if (isCustomFile && currentUserId) {
                        if (parsed.author_id) {
                            const aId = String(parsed.author_id).trim().toLowerCase();
                            const aName = String(parsed.author_name || '').trim().toLowerCase();
                            const myHWIDStr = String(currentHWID || '').trim().toLowerCase();
                            const matchesId = (aId === currentUserId) || (currentEmail && aId === currentEmail) || (myHWIDStr && aId === myHWIDStr);
                            const matchesName = (currentUserNick && aName === currentUserNick) || (currentEmail && aName === currentEmail);
                            if (!matchesId && !matchesName) {
                                // Vlastní linka patřící jinému účtu na tomto PC
                                continue;
                            }
                        } else {
                            // Starší lokální linka bez author_id - přiřadíme k aktuálnímu účtu
                            parsed.author_id = curCfg.discord_id || curCfg.email || currentHWID;
                            parsed.author_name = curCfg.discord_nick || curCfg.email || 'Autor';
                            try {
                                fs.writeFileSync(path.join(customDataPath, f), JSON.stringify(parsed, null, 2), 'utf8');
                            } catch (_) { }
                        }
                    }
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

                    // Synchronizovat do linky jen pokud txt ještě neexistuje (nezdržovat start opakovaným zápisem)
                    const safeNum = String(parsed.num).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
                    const txtCheck = path.join(centralUserDataPath, 'linky', `${safeNum}_custom.txt`);
                    if (!fs.existsSync(txtCheck)) {
                        syncRouteFileToLinky(parsed);
                    }
                    lines.push(parsed);
                }
            } catch (err) { }
        }
        if (syncDb) {
            await syncLocalLinesWithDatabase(lines);
        }
        reconcileLinesWithGameApplication(lines);
        return lines;
    } catch (e) {
        return [];
    }
}

async function syncLocalLinesWithDatabase(lines) {
    if (!Array.isArray(lines)) lines = [];
    try {
        const customDataPath = path.join(centralUserDataPath, 'data');
        if (!fs.existsSync(customDataPath)) fs.mkdirSync(customDataPath, { recursive: true });
        const cfg = loadConfig();
        const authorId = String(cfg.discord_id || '').trim();
        const authorNick = String(cfg.discord_nick || '').trim();
        const authorEmail = String(cfg.email || '').trim().toLowerCase();
        const authorHWID = String(currentHWID || '').trim();

        let serverRoutes = [];
        try {
            const myUrl = `${API_BASE}/api/community-routes/my?discord_id=${encodeURIComponent(authorId)}&author_name=${encodeURIComponent(authorNick)}`;
            const res = await safeFetch(myUrl, {}, 5000);
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.routes)) {
                    serverRoutes = data.routes;
                }
            }
        } catch (e) { }

        // Fallback: také zkusit veřejný seznam schválených komunitních linek
        try {
            const pubRes = await safeFetch(`${API_BASE}/api/community-routes`, {}, 5000);
            if (pubRes.ok) {
                const dataPub = await pubRes.json();
                if (dataPub.success && Array.isArray(dataPub.routes)) {
                    for (const pr of dataPub.routes) {
                        const aIdStr = String(pr.author_id || '').trim();
                        const aNameStr = String(pr.author_name || '').trim().toLowerCase();
                        const isMine = Boolean(
                            (authorId && aIdStr && authorId === aIdStr) ||
                            (authorEmail && aIdStr && authorEmail === aIdStr.toLowerCase()) ||
                            (authorHWID && aIdStr && authorHWID === aIdStr) ||
                            (authorNick && aNameStr && aNameStr === authorNick.toLowerCase())
                        );
                        if (isMine && !serverRoutes.some(sr => String(sr.id) === String(pr.id))) {
                            serverRoutes.push({ ...pr, status: pr.status || 'approved' });
                        }
                    }
                }
            }
        } catch (e) { }

        if (serverRoutes.length > 0) {
            let addedNew = false;
            const activeServerRoutes = serverRoutes.filter(r => r.is_deleted_by_author !== 1 && r.status !== 'deleted_by_user');

            // 1. Aktualizace existujících lokálních linek (nejdříve přesná shoda commId)
            for (const line of lines) {
                if (line.source === 'comm' || String(line.id).startsWith('comm_')) continue;

                let match = null;
                if (line.commId) {
                    match = serverRoutes.find(r => String(r.id) === String(line.commId));
                }
                if (!match && (line.status === 'published' || line.status === 'pending')) {
                    match = activeServerRoutes.find(r =>
                        String(r.route_number).trim() === String(line.num).trim() &&
                        String(r.version || 'V1').toUpperCase() === String(line.version || 'V1').toUpperCase()
                    ) || activeServerRoutes.find(r => String(r.route_number).trim() === String(line.num).trim());
                }

                if (match) {
                    let changed = false;
                    const sStatus = String(match.status || 'approved').toLowerCase();
                    if (match.is_deleted_by_author === 1 || sStatus === 'deleted_by_user') {
                        if (line.status === 'published' || line.status === 'pending' || line.status === 'rejected' || line.commId || line.reject) {
                            line.status = 'local';
                            delete line.published;
                            delete line.commId;
                            delete line.reject;
                            delete line.downloads_enabled;
                            changed = true;
                        }
                    } else if (sStatus === 'approved') {
                        const srvDl = (match.downloads_enabled === 0 || match.downloads_enabled === false) ? 0 : 1;
                        if (line.status !== 'published' || line.reject || line.downloads_enabled !== srvDl) {
                            line.status = 'published';
                            delete line.reject;
                            line.downloads_enabled = srvDl;
                            changed = true;
                        }
                    } else if (sStatus === 'rejected') {
                        const nextRej = match.reject_reason || 'Linka nebyla schválena administrátorem.';
                        if (line.status !== 'rejected' || line.reject !== nextRej) {
                            line.status = 'rejected';
                            line.reject = nextRej;
                            changed = true;
                        }
                    } else if (sStatus === 'pending') {
                        if (line.status !== 'pending' && line.status !== 'published') {
                            line.status = 'pending';
                            delete line.reject;
                            changed = true;
                        }
                    }
                    if (match.id && line.commId !== match.id) {
                        line.commId = match.id;
                        changed = true;
                    }
                    if (match.version && line.version !== match.version && !match.version.startsWith('V1') && (line.version === 'V1' || !line.version)) {
                        line.version = match.version;
                        changed = true;
                    }
                    if (changed) {
                        try {
                            const fp = path.join(customDataPath, `${line.id}.json`);
                            if (fs.existsSync(fp)) {
                                fs.writeFileSync(fp, JSON.stringify(line, null, 2), 'utf8');
                            }
                        } catch (e) { }
                    }
                }
            }

            // 2. Obnova chybějících autorových linek do Moje linky
            const soundsDirSync = path.join(centralUserDataPath, 'sounds');
            for (const sr of activeServerRoutes) {
                const sNum = String(sr.route_number).trim();
                const sVer = String(sr.version || 'V1').toUpperCase();
                const alreadyLocal = lines.some(l =>
                    ((l.commId && String(l.commId) === String(sr.id)) ||
                    (String(l.num).trim() === sNum && String(l.version || 'V1').toUpperCase() === sVer)) &&
                    l.source !== 'comm'
                );

                if (!alreadyLocal) {
                    let stops = [];
                    try {
                        stops = typeof sr.stops_json === 'string' ? JSON.parse(sr.stops_json) : (sr.stops || []);
                        if (Array.isArray(stops)) {
                            stops = stops.map(st => {
                                if (!st || typeof st !== 'object') return st;
                                const sndName = st.audio_file || (st.snd && st.snd.name) || '';
                                let sndUrl = (st.snd && st.snd.url) || st.audio_url || '';
                                if (sndName && fs.existsSync(path.join(soundsDirSync, path.basename(sndName)))) {
                                    sndUrl = 'file:///' + path.join(soundsDirSync, path.basename(sndName)).replace(/\\/g, '/');
                                } else if (sndUrl && sndUrl.startsWith('/')) {
                                    sndUrl = `${API_BASE}${sndUrl}`;
                                }
                                if (sndName && !st.snd) {
                                    st.snd = { name: path.basename(sndName), dur: st.dur || 2.0, url: sndUrl };
                                } else if (st.snd && sndUrl) {
                                    st.snd.url = sndUrl;
                                }
                                return st;
                            });
                        }
                    } catch (_) { }

                    const firstStop = (stops && stops.length) ? (stops[0].name || stops[0].n || (Array.isArray(stops[0]) ? stops[0][0] : '')) : '';
                    const lastStop = (stops && stops.length) ? (stops[stops.length - 1].name || stops[stops.length - 1].n || (Array.isArray(stops[stops.length - 1]) ? stops[stops.length - 1][0] : '')) : '';
                    const autoJrName = (firstStop && lastStop && firstStop !== lastStop) ? `${firstStop} – ${lastStop}` : (sr.route_name || `Linka ${sNum}`);
                    const curName = (sr.route_name || '').trim();
                    const routeName = (curName && !curName.startsWith('Linka ') && curName !== sNum) ? curName : autoJrName;

                    const fileId = `user_${sNum}_${sr.id}`;
                    const restoredLine = {
                        id: fileId,
                        commId: sr.id,
                        num: sNum,
                        name: routeName,
                        dest: lastStop || sr.route_name || 'Konečná',
                        source: 'manual',
                        is_custom: true,
                        author_id: sr.author_id || authorId || authorHWID,
                        author_name: sr.author_name || authorNick || 'Autor',
                        version: sr.version || 'V1',
                        status: sr.status === 'approved' ? 'published' : (sr.status || 'local'),
                        reject: sr.reject_reason || null,
                        tags: Array.isArray(sr.tags) ? sr.tags : (sr.system_tag ? [sr.system_tag] : ['IDPK']),
                        voice: sr.voice_type || 'synt',
                        packageUrl: sr.audio_package_url || null,
                        stops: stops
                    };

                    try {
                        const fp = path.join(customDataPath, `${fileId}.json`);
                        fs.writeFileSync(fp, JSON.stringify(restoredLine, null, 2), 'utf8');
                        syncRouteFileToLinky(restoredLine);
                    } catch (_) { }

                    lines.unshift(restoredLine);
                    addedNew = true;
                }
            }

            if (addedNew && window.LC && window.LC.setLines) {
                window.LC.setLines(lines);
                if (window.LC.renderMine) window.LC.renderMine();
            }
        }
    } catch (err) {
        console.warn('Chyba při synchronizaci linek s databází:', err);
    }
    return lines;
}

async function loadCommunityEditorLines(preloadedLocalLines) {
    try {
        const res = await safeFetch(`${API_BASE}/api/community-routes`, {}, 4000);
        if (res.ok) {
            const data = await res.json();
            const list = data.routes || [];
            const customDataPath = path.join(centralUserDataPath, 'data');
            const cfg = loadConfig();
            const currentNick = (cfg && (cfg.discord_nick || cfg.discord_id || '')) || '';
            const localLines = preloadedLocalLines || await loadLocalEditorLines(false);
            const localNumMap = new Map();
            const localByCommId = new Map();
            const localByNumVer = new Map();
            localLines.forEach(l => {
                const nKey = String(l.num || '').trim();
                const vKey = String(l.version || 'V1').toUpperCase();
                if (!localNumMap.has(nKey)) localNumMap.set(nKey, l);
                localByNumVer.set(`${nKey}__${vKey}`, l);
                if (l.commId) localByCommId.set(String(l.commId), l);
            });

            const commLines = [];
            for (const r of list) {
                let stops = [];
                try {
                    stops = typeof r.stops_json === 'string' ? JSON.parse(r.stops_json) : (r.stops || []);
                    if (Array.isArray(stops)) {
                        stops = stops.map(st => {
                            if (st && typeof st === 'object' && st.audio_url && st.audio_url.startsWith('/')) {
                                st.audio_url = `${API_BASE}${st.audio_url}`;
                            }
                            return st;
                        });
                    }
                } catch (e) { }
                const firstStop = (stops && stops.length) ? (stops[0].name || stops[0].n || (Array.isArray(stops[0]) ? stops[0][0] : '')) : '';
                const lastStop = (stops && stops.length) ? (stops[stops.length - 1].name || stops[stops.length - 1].n || (Array.isArray(stops[stops.length - 1]) ? stops[stops.length - 1][0] : '')) : '';
                const autoJrName = (firstStop && lastStop && firstStop !== lastStop) ? `${firstStop} – ${lastStop}` : (r.route_name || lastStop || `Linka ${r.route_number}`);
                const curName = (r.route_name || '').trim();
                const routeName = (curName && !curName.startsWith('Linka ') && curName !== String(r.route_number)) ? curName : autoJrName;
                const dest = lastStop || r.route_name || 'Konečná';
                const isInstalled = fs.existsSync(path.join(customDataPath, `comm_${r.id}.json`));
                const nKey = String(r.route_number || '').trim();
                const vKey = String(r.version || 'V1').toUpperCase();
                const localLine = localByCommId.get(String(r.id)) || localByNumVer.get(`${nKey}__${vKey}`) || localNumMap.get(nKey);
                const authorIdStr = String(r.author_id || '').trim();
                const authorNameStr = String(r.author_name || '').trim().toLowerCase();
                const myDiscordId = String(cfg.discord_id || '').trim();
                const myEmail = String(cfg.email || '').toLowerCase().trim();
                const myNick = String(cfg.discord_nick || '').trim().toLowerCase();
                const myHWID = String(currentHWID || '').trim();

                const isOwnAuthor = Boolean(
                    (myDiscordId && authorIdStr && myDiscordId === authorIdStr) ||
                    (myEmail && authorIdStr && myEmail === authorIdStr.toLowerCase()) ||
                    (myHWID && authorIdStr && myHWID === authorIdStr) ||
                    (myNick && authorNameStr && authorNameStr === myNick) ||
                    (currentNick && authorNameStr && authorNameStr === currentNick.toLowerCase())
                );
                const isAlreadyPresent = isInstalled || (localByCommId.has(String(r.id))) || (isOwnAuthor && localByNumVer.has(`${nKey}__${vKey}`));

                const isDeleted = Boolean(r.is_deleted_by_author || r.status === 'deleted_by_user');
                if (isDeleted) {
                    if (isOwnAuthor || !isInstalled) {
                        continue;
                    }
                }

                // Detekce novější verze (update):
                let state = isAlreadyPresent ? 'installed' : 'idle';
                if (!isAlreadyPresent && localLine && !isDeleted) {
                    const localVer = parseInt(String(localLine.version || '1').replace(/\D/g, ''), 10) || 1;
                    const srvVer = parseInt(String(r.version || '1').replace(/\D/g, ''), 10) || 1;
                    if (srvVer > localVer) {
                        state = 'update';
                    }
                }

                // Zpracování tagů a detekce 80%+ bez zvuku
                let rawTags = Array.isArray(r.tags) ? [...r.tags] : (r.system_tag ? r.system_tag.split(',').map(s => s.trim()) : ['IDPK']);
                const soundStops = (stops || []).filter(s => s && (s.snd || s.audio_url || s.audio_file)).length;
                const isNoSound80 = stops.length > 0 && ((stops.length - soundStops) / stops.length) >= 0.8;
                if (isNoSound80 && !rawTags.includes('bez zvuku')) {
                    rawTags.push('bez zvuku');
                }
                const voice = (isNoSound80 || rawTags.includes('bez zvuku')) ? 'none' : (r.voice_type || 'synt');
                let pkgUrl = r.audio_package_url || '';
                if (pkgUrl && pkgUrl.startsWith('/')) {
                    pkgUrl = `${API_BASE}${pkgUrl}`;
                }

                commLines.push({
                    id: String(r.id),
                    num: String(r.route_number),
                    name: routeName,
                    full_name: autoJrName,
                    from: firstStop,
                    dest: dest,
                    version: r.version || 'V1',
                    author: r.author_name || 'Komunita',
                    dl: r.download_count || 0,
                    size: r.file_size || '35 kB',
                    type: r.route_type === 'custom' ? 'fiktivni' : (r.route_type || 'realna'),
                    voice: voice,
                    scope: r.system_tag && r.system_tag.toUpperCase() !== 'IDPK' ? 'cr' : 'idpk',
                    tags: rawTags,
                    isNew: Boolean(r.is_new),
                    is_deleted_by_author: isDeleted,
                    downloads_enabled: (r.downloads_enabled === 0 || r.downloads_enabled === false) ? 0 : 1,
                    state: state,
                    packageUrl: pkgUrl,
                    stops: stops
                });
            }
            return commLines;
        }
    } catch (e) {
        console.warn('Nelze načíst komunitní linky:', e);
    }
    return [];
}

function _mapAdminRouteRow(q) {
    let stops = q.stops || [];
    if ((!stops || !stops.length) && q.stops_json) {
        try {
            stops = typeof q.stops_json === 'string' ? JSON.parse(q.stops_json) : q.stops_json;
        } catch (_) { stops = []; }
    }
    const rawStatus = String(q.status || 'pending').toLowerCase();
    const isAuthorDel = Boolean(q.is_deleted_by_author) || rawStatus === 'deleted_by_user';
    const dlEnabled = (q.downloads_enabled === 0 || q.downloads_enabled === false) ? 0 : 1;
    let bucket = q.status_bucket;
    if (!bucket || bucket === 'archived') {
        if (isAuthorDel) bucket = 'deleted_by_user';
        else if (rawStatus === 'rejected') bucket = 'rejected';
        else if (rawStatus === 'approved') bucket = 'approved';
        else bucket = 'pending';
    }
    return {
        id: String(q.id),
        num: String(q.route_number),
        name: q.route_name,
        version: q.version || 'V1',
        created_at: q.created_at || '',
        updated_at: q.updated_at || '',
        author: q.author_name || 'Hráč',
        author_id: q.author_id || '',
        type: q.route_type === 'custom' ? 'fiktivni' : (q.route_type || 'realna'),
        voice: q.voice_type || 'synt',
        tags: q.system_tag ? String(q.system_tag).split(',').map(x => x.trim()).filter(Boolean) : ['IDPK'],
        desc: q.description || '',
        scope: q.system_tag && String(q.system_tag).toUpperCase() !== 'IDPK' ? 'cr' : 'idpk',
        status: isAuthorDel ? 'deleted_by_user' : rawStatus,
        status_bucket: bucket,
        is_deleted_by_author: isAuthorDel,
        reject_reason: isAuthorDel ? '' : (q.reject_reason || ''),
        downloads_enabled: dlEnabled,
        is_version_update: Boolean(q.is_version_update || q.existing_approved),
        existing_approved: q.existing_approved || null,
        dl: Number(q.download_count || 0),
        stops: (Array.isArray(stops) ? stops : []).map(s => {
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
}

async function loadPendingAdminQueue() {
    if (!['admin', 'sa', 'dev'].includes(mapRoleToLC(currentUserRole))) return [];
    try {
        const resAll = await authFetch(`${API_BASE}/api/admin/community-routes/all`, {}, 12000);
        if (resAll.ok) {
            const dataAll = await resAll.json();
            if (dataAll && Array.isArray(dataAll.routes)) {
                return dataAll.routes.map(_mapAdminRouteRow);
            }
        }
        // Fallback při výpadku admin endpointu: sloučit čekající + veřejně zveřejněné
        const [resPend, resPub] = await Promise.all([
            authFetch(`${API_BASE}/api/community-routes/pending`, {}, 6000).catch(() => null),
            safeFetch(`${API_BASE}/api/community-routes`, {}, 6000).catch(() => null)
        ]);
        const merged = [];
        const seen = new Set();
        if (resPend && resPend.ok) {
            const dP = await resPend.json().catch(() => ({}));
            for (const r of (dP.queue || [])) {
                seen.add(String(r.id));
                merged.push(_mapAdminRouteRow(r));
            }
        }
        if (resPub && resPub.ok) {
            const dPub = await resPub.json().catch(() => ({}));
            for (const r of (dPub.routes || [])) {
                if (!seen.has(String(r.id))) {
                    seen.add(String(r.id));
                    merged.push(_mapAdminRouteRow(r));
                }
            }
        }
        if (merged.length > 0) return merged;
    } catch (e) {
        console.warn('Nelze načíst admin seznam linek:', e);
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
                role: mapRoleToLC(currentUserRole),
                avatar_url: cfg.avatar_url || (typeof currentUserAvatarUrl !== 'undefined' ? currentUserAvatarUrl : null)
            });
        }

        // 1. Rychlé načtení lokálních linek z disku (okamžité zobrazení v UI)
        const myLines = await loadLocalEditorLines(false);
        if (window.LC.setLines) window.LC.setLines(myLines);
        reconcileLinesWithGameApplication(myLines);

        // Automatická periodická kontrola oprávnění a čerstvosti relace
        if (!window._lcAdminGuardInit) {
            window._lcAdminGuardInit = true;
            window.addEventListener('focus', () => {
                refreshLauncherSessionAndRole(false).catch(() => { });
            });
            setInterval(() => {
                if (navigator.onLine) refreshLauncherSessionAndRole(true).catch(() => { });
            }, 300000);
        }

        // 2. Paralelní načtení komunitních linek a admin fronty s využitím již načtených lokálních linek
        await refreshLauncherSessionAndRole(false);
        const [commLines, adminRoutes] = await Promise.all([
            loadCommunityEditorLines(myLines),
            loadPendingAdminQueue()
        ]);
        if (window.LC.setComm) window.LC.setComm(commLines);
        if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(adminRoutes);
        else if (window.LC.setQueue) window.LC.setQueue(adminRoutes);

        // 3. Na pozadí ověřit stavy se serverem bez zdržení startu aplikace
        syncLocalLinesWithDatabase(myLines).then(() => {
            if (window.LC && window.LC.renderMine) window.LC.renderMine();
        }).catch(() => { });

        // GTFS vyhledávání
        window.LC.setGtfsSearch(async (q) => {
            try {
                const res = await ipcRenderer.invoke('gtfs-editor-search', q);
                return Array.isArray(res) ? res : [];
            } catch (e) {
                console.error('Chyba při vyhledávání v GTFS:', e);
                return [];
            }
        });

        // Automatické párování zvuků zastávek z existujících linek
        const matchFn = async (stops) => {
            try {
                return await ipcRenderer.invoke('auto-match-stops-audio', stops);
            } catch (e) {
                console.error('Chyba při párování zvuků:', e);
                return [];
            }
        };
        window.autoMatchStopsAudio = matchFn;
        if (window.LC.setAutoMatchAudio) {
            window.LC.setAutoMatchAudio(matchFn);
        }

        // Kontrola a stahování dat celé ČR
        try {
            const hasCr = await ipcRenderer.invoke('gtfs-check-cr');
            if (hasCr && window.LC && window.LC.setCrDownloaded) {
                window.LC.setCrDownloaded(true);
            }
        } catch (e) { }

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
                } catch (err) {
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
        } catch (e) { }
    } catch (e) {
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

window._lcLaunchReadyToQuit = false;

function _abortLcLaunch(state, title, desc) {
    window._lcLaunchAborted = true;
    window._lcLaunchReadyToQuit = false;
    document.dispatchEvent(new CustomEvent('lc:launch-aborted'));
    if (window.LC) {
        if (state) window.LC.setLaunchState(state);
        if (title) window.LC.showError(title, desc || '');
    }
}

document.addEventListener('lc:launch', async (e) => {
    window._lcLaunchAborted = false;
    window._lcLaunchReadyToQuit = false;
    const verId = (e.detail && e.detail.version) || (window.LC && window.LC.S && window.LC.S.sel);
    const folder = getVersionFolder(verId);
    let config = loadConfig();

    let v = (availableVersions || []).find(x => x.db_version === verId);
    if (!isOfflineMode && navigator.onLine) {
        try {
            let id_param = config.discord_id || (config.email ? 'email-' + config.email : '');
            if (id_param) {
                const resCheck = await safeFetch(`${API_BASE}/api/launcher/versions?discord_id=${encodeURIComponent(id_param)}`, {}, 2500);
                if (resCheck.ok) {
                    const dataCheck = await resCheck.json().catch(() => ({}));
                    if (dataCheck.status === 'banned') {
                        _abortLcLaunch('locked');
                        const banEl = document.getElementById('initial-loading-overlay');
                        if (banEl) { banEl.hidden = false; banEl.style.display = 'flex'; }
                        return;
                    }
                    if (dataCheck.status === 'locked' || (dataCheck.status === 'error' && dataCheck.message && (dataCheck.message.includes('uzamčen') || dataCheck.message.includes('údržb')))) {
                        _abortLcLaunch('locked');
                        showLockedScreen(dataCheck.message || 'Launcher byl uzamčen administrátorem.');
                        return;
                    }
                    if (dataCheck.status === 'ok' && Array.isArray(dataCheck.versions)) {
                        availableVersions = dataCheck.versions;
                        v = availableVersions.find(x => x.db_version === verId) || v;
                    }
                }
            }
        } catch (_) { /* Fallback na offline / cached oprávnění při dočasném výpadku */ }
    }

    if (v && (!v.has_access || !v.can_launch)) {
        _abortLcLaunch('locked', 'Spuštění zablokováno', v.can_launch === false ? 'Administrátor zakázal spouštění této verze.' : 'Pro tuto verzi nemáte potřebné oprávnění.');
        return;
    }

    if (!isOfflineMode && v && hasVersionPatchUpdate(v, folder) && v.patch_url && v.patch_url.trim()) {
        _abortLcLaunch('update');
        if (window.LC) window.LC.toast('info', 'Vyžadována aktualizace', `Stahuji povinný build ${v.current_build || v.db_version}…`);
        document.dispatchEvent(new CustomEvent('lc:download', { detail: { version: verId } }));
        return;
    }

    const exePath = findExeInFolder(folder);
    if (!exePath) {
        _abortLcLaunch('error', 'Hru se nepodařilo spustit', 'Spustitelný soubor hry (.exe) nebyl ve složce verze nalezen.');
        return;
    }

    config.last_version = verId;
    config.launcher_path = process.execPath;
    saveConfig(config);
    reconcileLinesWithGameApplication();
    try {
        const proc = spawn(exePath, ['--no-launcher'], {
            detached: true,
            stdio: 'ignore'
        });
        proc.on('error', (err) => {
            _abortLcLaunch('error', 'Hru se nepodařilo spustit', err.message);
        });
        proc.unref();
        if (proc && !proc.killed) {
            window._lcLaunchReadyToQuit = true;
        }
    } catch (err) {
        _abortLcLaunch('error', 'Hru se nepodařilo spustit', err.message);
    }
});

document.addEventListener('lc:launched', () => {
    if (window._lcLaunchReadyToQuit && !window._lcLaunchAborted) {
        ipcRenderer.send('quit-app');
    }
});

document.addEventListener('lc:download', async (e) => {
    const verId = (e.detail && e.detail.version) || (window.LC && window.LC.S && window.LC.S.sel);
    const v = (availableVersions || []).find(x => x.db_version === verId);
    if (!v) {
        if (window.LC) {
            window.LC.showDownload(false);
            window.LC.showError('Chyba při stahování', `Verze ${verId} nebyla nalezena.`);
            window.LC.setLaunchState('error');
        }
        return;
    }
    if (!v.has_access || !v.can_launch) {
        if (window.LC) {
            window.LC.showDownload(false);
            window.LC.showError('Přístup zamítnut', 'Pro stažení této verze nemáte oprávnění nebo byla uzamčena.');
            window.LC.setLaunchState('locked');
        }
        return;
    }
    const folder = getVersionFolder(v.db_version);
    const isInstalled = Boolean(findExeInFolder(folder));
    if (isInstalled && hasVersionPatchUpdate(v, folder) && v.patch_url && v.patch_url.trim()) {
        await downloadAndApplyPatch(v.db_version, folder, v.patch_url.trim(), v.current_build || v.db_version);
        return;
    }
    if (!v.file_url) {
        if (window.LC) {
            window.LC.showDownload(false);
            window.LC.showError('Chyba při stahování', `Verze ${verId} nemá v databázi nastavený platný odkaz ke stažení.`);
            window.LC.setLaunchState('error');
        }
        return;
    }
    const downloadUrl = v.file_url.split(',')[0].trim();
    await downloadAndExtract(downloadUrl, folder, v.db_version);
});

document.addEventListener('lc:cancel-download', () => {
    if (activeDownloadCleanup) {
        try { activeDownloadCleanup(true); } catch (e) { }
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

document.addEventListener('lc:login', (e) => {
    const identifier = e.detail && e.detail.identifier;
    if (!identifier) return;
    performDiscordAuth(identifier);
});

document.addEventListener('lc:login-email', (e) => {
    const { mode, nick, email } = e.detail || {};
    performEmailAuth(email, nick, mode || 'login');
});

document.addEventListener('lc:verify-code', (e) => {
    const code = e.detail && e.detail.code;
    if (!code) return;
    performVerifyCode(code);
});

document.addEventListener('lc:logout', () => {
    if (authPollInterval) { clearInterval(authPollInterval); authPollInterval = null; }
    if (window.emailPollInterval) { clearInterval(window.emailPollInterval); window.emailPollInterval = null; }
    if (window.emailAuthTimeoutTimer) { clearTimeout(window.emailAuthTimeoutTimer); window.emailAuthTimeoutTimer = null; }

    let config = loadConfig();
    config.discord_id = '';
    config.discord_nick = '';
    config.email = '';
    config.web_session_token = '';
    config.avatar_url = '';
    config.user_role = 'User';
    saveConfig(config);

    try {
        if (typeof launcherCachePath === 'string' && fs.existsSync(launcherCachePath)) {
            fs.unlinkSync(launcherCachePath);
        }
    } catch (_) { }

    currentUserRole = 'User';
    currentUserAvatarUrl = '';
    availableVersions = [];
    if (window.LC) {
        if (window.LC.setLines) window.LC.setLines([]);
        if (window.LC.setAdminRoutes) window.LC.setAdminRoutes([]);
        else if (window.LC.setQueue) window.LC.setQueue([]);
        if (window.LC.setVersions) window.LC.setVersions([]);
        window.LC.setUser({ name: '', hwid: currentHWID, role: 'user', avatar_url: null });
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

        // Zajištění unikátního bezpečného ID bez nepovolených znaků cesty
        const safeNumId = String(line.num || 'custom').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom';
        if (!line.id || String(line.id).startsWith('n') || String(line.id).startsWith('l')) {
            line.id = `user_${safeNumId}_${Date.now()}`;
        } else {
            line.id = String(line.id).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        }
        line.is_custom = true;
        const curCfg = loadConfig();
        if (!line.author_id) line.author_id = curCfg.discord_id || curCfg.email || currentHWID;
        if (!line.author_name) line.author_name = curCfg.discord_nick || curCfg.email || 'Autor';
        const filePath = path.join(customDataPath, `${line.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(line, null, 2), 'utf8');
        syncRouteFileToLinky(line);
        reconcileLinesWithGameApplication();
        try { if (typeof ipcRenderer !== 'undefined' && ipcRenderer.send) ipcRenderer.send('notify-routes-updated'); } catch (_) { }
        if (window.LC) {
            window.LC.toast('ok', `Linka ${line.num} uložena`, 'Linka byla uložena do vašich linek.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba ukládání linky', err.message);
    }
});

function getFolderSize(dirPath) {
    let size = 0;
    if (!fs.existsSync(dirPath)) return 0;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const fp = path.join(dirPath, file);
            try {
                const stat = fs.statSync(fp);
                if (stat.isFile()) size += stat.size;
                else if (stat.isDirectory()) size += getFolderSize(fp);
            } catch (_) { }
        }
    } catch (_) { }
    return size;
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return (bytes / 1024).toFixed(1) + ' KB';
    return mb.toFixed(1) + ' MB';
}

document.addEventListener('lc:storage-manager-open', async () => {
    try {
        const soundsDir = path.join(centralUserDataPath, 'sounds');
        const dataDir = path.join(centralUserDataPath, 'data');
        const linkyDir = path.join(centralUserDataPath, 'linky');

        const soundsBytes = getFolderSize(soundsDir);
        const dataBytes = getFolderSize(dataDir) + getFolderSize(linkyDir);
        const totalBytes = soundsBytes + dataBytes;

        const lines = (window.LC && window.LC.S && window.LC.S.lines || []).map(l => {
            const stops = l.stops || [];
            let audioCount = 0;
            stops.forEach(s => {
                if (s.snd || s.audio_file || s.audio) audioCount++;
            });
            return {
                id: l.id,
                num: l.num,
                name: l.name,
                source: l.source,
                stopsCount: stops.length,
                audioCount: audioCount
            };
        });

        if (window.LC && window.LC.updateStorageUI) {
            window.LC.updateStorageUI({
                soundsSize: formatBytes(soundsBytes),
                dataSize: formatBytes(dataBytes),
                totalSize: formatBytes(totalBytes),
                lines: lines
            });
        }
    } catch (err) {
        console.warn('[storage-manager-open]', err);
    }
});

document.addEventListener('lc:storage-clean-orphans', async () => {
    try {
        const soundsDir = path.join(centralUserDataPath, 'sounds');
        if (!fs.existsSync(soundsDir)) {
            if (window.LC) window.LC.toast('info', 'Žádné zvuky', 'Složka zvuků je prázdná.');
            return;
        }

        const referencedSounds = new Set();
        const allLines = (window.LC && window.LC.S && window.LC.S.lines || []);
        const _collectLineAudio = (lObj) => {
            if (!lObj || typeof lObj !== 'object') return;
            (lObj.stops || []).forEach(st => {
                const sndName = (st && st.snd && st.snd.name) ? st.snd.name : (st && (st.audio_file || st.audio)) || null;
                if (sndName) referencedSounds.add(path.basename(String(sndName)).toLowerCase());
            });
            const gs = lObj.general_sounds || {};
            ['next', 'req', 'terminus'].forEach(k => {
                const n = gs[k] && gs[k].snd && gs[k].snd.name;
                if (n) referencedSounds.add(path.basename(String(n)).toLowerCase());
            });
            [lObj.ann_next, lObj.ann_req, lObj.ann_term].forEach(a => {
                if (a && a.name) referencedSounds.add(path.basename(String(a.name)).toLowerCase());
            });
        };

        allLines.forEach(_collectLineAudio);

        const dataDir = path.join(centralUserDataPath, 'data');
        if (fs.existsSync(dataDir)) {
            const jFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
            jFiles.forEach(jf => {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(dataDir, jf), 'utf-8'));
                    _collectLineAudio(content);
                } catch (_) { }
            });
        }

        let deletedCount = 0;
        let deletedBytes = 0;
        const soundFiles = fs.readdirSync(soundsDir);
        soundFiles.forEach(sf => {
            const fp = path.join(soundsDir, sf);
            try {
                const st = fs.statSync(fp);
                if (!st.isFile()) return;
                const lower = sf.toLowerCase();
                if (!referencedSounds.has(lower)) {
                    fs.unlinkSync(fp);
                    deletedCount++;
                    deletedBytes += st.size;
                }
            } catch (_) { }
        });

        if (window.LC) {
            if (deletedCount > 0) {
                window.LC.toast('ok', 'Úložiště vyčištěno', `Smazáno ${deletedCount} nepoužívaných souborů (${formatBytes(deletedBytes)} uvolněno).`);
            } else {
                window.LC.toast('info', 'Úložiště je čisté', 'Nebyly nalezeny žádné nepotřebné zvukové soubory.');
            }
        }

        document.dispatchEvent(new CustomEvent('lc:storage-manager-open'));
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba čištění', err.message);
    }
});

document.addEventListener('lc:line-delete', async (e) => {
    const detail = e.detail || {};
    const id = detail.id;
    const num = detail.num;
    if (!id && !num) return;
    try {
        const isUnpub = Boolean(detail.unpublish);
        const safeNum = num ? String(num).trim().replace(/[^a-zA-Z0-9_-]/g, '_') : null;
        const allIds = new Set();
        if (id) allIds.add(String(id));
        if (Array.isArray(detail.ids)) {
            detail.ids.forEach(x => x && allIds.add(String(x)));
        }

        // Pokud jde pouze o smazání z veřejné komunity (unpublish), NEMAZAT lokální soubor z PC
        if (!isUnpub) {
            const customDataPath = path.join(centralUserDataPath, 'data');
            const linkyDir = path.join(centralUserDataPath, 'linky');
            const lineSounds = new Set();

            // A. Smazat odpovídající JSON soubory z centralUserDataPath/data
            if (fs.existsSync(customDataPath)) {
                try {
                    const jFiles = fs.readdirSync(customDataPath).filter(f => f.endsWith('.json'));
                    jFiles.forEach(jf => {
                        const base = jf.replace('.json', '');
                        let shouldDel = false;
                        if (allIds.has(base) || (detail.commId && base === `comm_${detail.commId}`)) shouldDel = true;
                        if (safeNum && (base === safeNum || base === `user_${safeNum}` || base === `comm_${safeNum}` || jf.startsWith(`user_${safeNum}_`))) {
                            if (detail.deleteAll) shouldDel = true;
                        }

                        const fp = path.join(customDataPath, jf);
                        try {
                            const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                            const parsedNum = parsed.num ? String(parsed.num).trim().replace(/[^a-zA-Z0-9_-]/g, '_') : null;
                            const parsedVer = parsed.version || 'V1';
                            if (parsed.id && allIds.has(String(parsed.id))) shouldDel = true;
                            if (parsed.commId && allIds.has(String(parsed.commId))) shouldDel = true;
                            if (safeNum && parsedNum === safeNum) {
                                if (detail.deleteAll) shouldDel = true;
                                if (detail.version && parsedVer === detail.version && !id) shouldDel = true;
                            }
                            if (shouldDel) {
                                (parsed.stops || []).forEach(st => {
                                    const snd = st.audio || st.audio_file || (st.snd && st.snd.name);
                                    if (snd) lineSounds.add(path.basename(String(snd)).toLowerCase());
                                });
                                fs.unlinkSync(fp);
                            }
                        } catch (_) {
                            if (shouldDel) {
                                try { fs.unlinkSync(fp); } catch (__) { }
                            }
                        }
                    });
                } catch (_) { }
            }

            // B. Smazat soubory z centralUserDataPath/linky
            if (fs.existsSync(linkyDir)) {
                try {
                    const txtFiles = fs.readdirSync(linkyDir);
                    txtFiles.forEach(tf => {
                        let shouldDel = false;
                        allIds.forEach(targetId => {
                            if (tf.includes(targetId)) shouldDel = true;
                        });
                        if (safeNum) {
                            if (tf === `${safeNum}_custom.txt` || tf === `${safeNum}.txt` || tf.startsWith(`${safeNum}_custom`)) {
                                shouldDel = true;
                            }
                        }
                        if (shouldDel) {
                            try { fs.unlinkSync(path.join(linkyDir, tf)); } catch (_) { }
                        }
                    });
                } catch (_) { }
            }

            // C. Smazat z VŠECH nainstalovaných verzí hry (userDataPath/versions/*) a jejich podsložek!
            const versionsDir = path.join(userDataPath, 'versions');
            if (fs.existsSync(versionsDir)) {
                try {
                    const subdirs = fs.readdirSync(versionsDir);
                    subdirs.forEach(vName => {
                        const vFolder = path.join(versionsDir, vName);
                        // Linky složky ve verzi
                        const vLinkyDirs = findLinkyFoldersInVersion(vFolder);
                        vLinkyDirs.forEach(dir => {
                            if (fs.existsSync(dir)) {
                                try {
                                    const vFiles = fs.readdirSync(dir);
                                    vFiles.forEach(vf => {
                                        let shouldDel = false;
                                        allIds.forEach(targetId => { if (vf.includes(targetId)) shouldDel = true; });
                                        if (safeNum && (vf === `${safeNum}_custom.txt` || vf === `${safeNum}.txt` || vf.startsWith(`${safeNum}_custom`))) {
                                            shouldDel = true;
                                        }
                                        if (shouldDel) {
                                            try { fs.unlinkSync(path.join(dir, vf)); } catch (_) { }
                                        }
                                    });
                                } catch (_) { }
                            }
                        });
                        // Data složky ve verzi
                        const vDataDirs = findDataFoldersInVersion(vFolder);
                        vDataDirs.forEach(dir => {
                            if (fs.existsSync(dir)) {
                                try {
                                    const vFiles = fs.readdirSync(dir);
                                    vFiles.forEach(vf => {
                                        let shouldDel = false;
                                        allIds.forEach(targetId => { if (vf.includes(targetId)) shouldDel = true; });
                                        if (safeNum && (vf === `${safeNum}.json` || vf.startsWith(`user_${safeNum}_`) || vf.startsWith(`comm_${safeNum}`))) {
                                            shouldDel = true;
                                        }
                                        if (shouldDel) {
                                            try { fs.unlinkSync(path.join(dir, vf)); } catch (_) { }
                                        }
                                    });
                                } catch (_) { }
                            }
                        });
                    });
                } catch (_) { }
            }

            // D. Smazat z DEV a lokálních adresářů
            const devDirs = [
                path.join(__dirname, '..', 'linky'),
                path.join(__dirname, 'linky'),
                path.join(__dirname, '..', 'data'),
                path.join(__dirname, 'data')
            ];
            devDirs.forEach(d => {
                if (fs.existsSync(d)) {
                    try {
                        const dFiles = fs.readdirSync(d);
                        dFiles.forEach(df => {
                            if (safeNum && (df === `${safeNum}_custom.txt` || df === `${safeNum}.json`)) {
                                try { fs.unlinkSync(path.join(d, df)); } catch (_) { }
                            }
                        });
                    } catch (_) { }
                }
            });

            // E. Pročistit in-memory cache v main procesu
            try {
                if (typeof ipcRenderer !== 'undefined' && ipcRenderer.invoke) {
                    ipcRenderer.invoke('purge-custom-route-cache', { lineNum: num, id: id });
                }
            } catch (_) { }

            // F. Aktualizovat stav v launcheru (S.lines / S.comm) a obnovit UI + správce úložiště
            if (window.LC && window.LC.S) {
                const targetCommId = detail.commId ? String(detail.commId) : (String(id || '').startsWith('comm_') ? String(id).slice(5) : null);
                if (Array.isArray(window.LC.S.lines)) {
                    window.LC.S.lines = window.LC.S.lines.filter(x => {
                        if (!x) return false;
                        if (allIds.has(String(x.id))) return false;
                        if (targetCommId && (String(x.commId) === targetCommId || String(x.id) === `comm_${targetCommId}`)) return false;
                        if (detail.deleteAll && safeNum && String(x.num || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') === safeNum) return false;
                        return true;
                    });
                }
                if (Array.isArray(window.LC.S.comm)) {
                    window.LC.S.comm.forEach(c => {
                        if (!c) return;
                        if ((targetCommId && String(c.id) === targetCommId) || allIds.has(`comm_${c.id}`) || allIds.has(String(c.id))) {
                            c.state = 'idle';
                        }
                    });
                }
                if (window.LC.renderMine) window.LC.renderMine();
                if (window.LC.renderComm) window.LC.renderComm();
            }

            const smModal = document.getElementById('storage-mgr-modal');
            const shouldRefreshStorage = Boolean(detail.fromStorageManager || (smModal && !smModal.hidden));
            if (shouldRefreshStorage) {
                document.dispatchEvent(new CustomEvent('lc:storage-manager-open'));
            }

            // G. Úklid osiřelých zvuků
            if (lineSounds.size > 0 || shouldRefreshStorage) {
                setTimeout(() => {
                    try {
                        if (lineSounds.size > 0) {
                            document.dispatchEvent(new CustomEvent('lc:storage-clean-orphans'));
                        } else if (shouldRefreshStorage) {
                            document.dispatchEvent(new CustomEvent('lc:storage-manager-open'));
                        }
                    } catch (_) { }
                }, 250);
            }
        }

        // 2. Požadavek na server pro komunitní / zveřejněné linky
        const isInstalledOnly = Boolean(detail.isInstalledOnly);
        if (!isInstalledOnly && (detail.unpublish || detail.isPublished || (detail.deleteAll && !String(id).startsWith('comm_')))) {
            const cfg = loadConfig();
            try {
                await authFetch(`${API_BASE}/api/community-routes/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        route_id: detail.commId || (String(id).startsWith('comm_') ? id.replace('comm_', '') : undefined),
                        route_number: detail.num || (detail.deleteAll ? (detail.num || '') : undefined),
                        version: detail.version || undefined,
                        author_id: cfg.discord_id || cfg.email || currentHWID,
                        discord_id: cfg.discord_id || (cfg.email ? 'email-' + cfg.email : currentHWID),
                        author_name: cfg.discord_nick || cfg.email || 'Hráč'
                    })
                }, 10000);
                if (typeof syncLocalLinesWithDatabase === 'function') {
                    await syncLocalLinesWithDatabase();
                }
                const [updatedComm, allAdmin] = await Promise.all([
                    loadCommunityEditorLines(),
                    loadPendingAdminQueue()
                ]);
                if (window.LC) {
                    if (window.LC.setComm) window.LC.setComm(updatedComm);
                    if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(allAdmin);
                    else if (window.LC.setQueue) window.LC.setQueue(allAdmin);
                    if (window.LC.renderComm) window.LC.renderComm();
                    if (window.LC.renderMine) window.LC.renderMine();
                }
            } catch (_) { }
        }
        reconcileLinesWithGameApplication();
        try { if (typeof ipcRenderer !== 'undefined' && ipcRenderer.send) ipcRenderer.send('notify-routes-updated'); } catch (_) { }
    } catch (err) {
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
        } catch (err) {
            console.error('Chyba při kopírování zvuku:', err);
        }
    }
});

let isDevBuildLaunching = false;
document.addEventListener('lc:launch-dev-build', async () => {
    if (isDevBuildLaunching) return;
    try {
        let cfg = loadConfig();
        let id_param = cfg.discord_id || (cfg.email ? 'email-' + cfg.email : '');
        if (navigator.onLine && id_param) {
            const resCheck = await safeFetch(`${API_BASE}/api/launcher/versions?discord_id=${id_param}`, {}, 4000);
            if (resCheck.ok) {
                const dataCheck = await resCheck.json();
                if (dataCheck.status === 'locked' || (dataCheck.status === 'error' && dataCheck.message && (dataCheck.message.includes('uzamčen') || dataCheck.message.includes('údržb')))) {
                    showLockedScreen(dataCheck.message || "Launcher byl uzamčen administrátorem.");
                    return;
                }
            }
        }
    } catch (_) { }
    isDevBuildLaunching = true;
    reconcileLinesWithGameApplication();
    ipcRenderer.send('launch-dev-build');
    setTimeout(() => { isDevBuildLaunching = false; }, 3000);
});

document.addEventListener('lc:line-publish', async (e) => {
    const { line, type, voice, tags, desc } = e.detail;
    let cfg = loadConfig();
    try {
        const stops = line.stops || [];
        const firstStop = (stops.length) ? (stops[0].n || stops[0].name || (Array.isArray(stops[0]) ? stops[0][0] : '')) : '';
        const lastStop = (stops.length) ? (stops[stops.length - 1].n || stops[stops.length - 1].name || (Array.isArray(stops[stops.length - 1]) ? stops[stops.length - 1][0] : '')) : '';
        const autoJr = (firstStop && lastStop && firstStop !== lastStop) ? `${firstStop} – ${lastStop}` : `Linka ${line.num}`;
        const curName = (line.name || '').trim();
        const resolvedRouteName = (curName && !curName.startsWith('Linka ') && curName !== String(line.num)) ? curName : autoJr;

        const sndCount = stops.filter(s => s && s.snd).length;
        const isNoSound80 = stops.length > 0 && ((stops.length - sndCount) / stops.length) >= 0.8;
        const finalTags = Array.isArray(tags) ? [...tags] : ['IDPK'];
        if (isNoSound80 && !finalTags.includes('bez zvuku')) {
            finalTags.push('bez zvuku');
        }

        const formData = new FormData();
        formData.append('legal_confirmed', '1');
        formData.append('route_number', line.num);
        formData.append('route_name', resolvedRouteName);
        formData.append('version', line.version || 'V1');
        formData.append('route_type', type || 'gtfs');
        formData.append('voice_type', isNoSound80 ? 'none' : (voice || 'synt'));
        formData.append('system_tag', finalTags.join(', '));
        formData.append('tags_json', JSON.stringify(finalTags));
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

        const res = await authFetch(`${API_BASE}/api/community-routes/submit`, {
            method: 'POST',
            body: formData
        }, 20000);
        const respData = await res.json().catch(() => ({}));
        if (res.status === 401) {
            if (window.LC) window.LC.toast('err', 'Ověření relace selhalo', 'Automatické obnovení relace se nezdařilo. Zkuste se prosím odhlásit a přihlásit znovu.');
            return;
        }
        if (respData.success) {
            line.status = 'pending';
            line.tags = finalTags;
            const customDataPath = path.join(centralUserDataPath, 'data');
            fs.writeFileSync(path.join(customDataPath, `${line.id}.json`), JSON.stringify(line, null, 2), 'utf8');
            if (window.LC) {
                window.LC.renderMine(line.id);
                window.LC.toast('ok', 'Linka odeslána ke schválení', 'Linka byla odeslána správcům ke kontrole. Po schválení v dashboardu nebo launcheru se objeví v komunitních linkách.');
                loadPendingAdminQueue().then(queue => {
                    if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(queue);
                    else if (window.LC.setQueue) window.LC.setQueue(queue);
                });
            }
        } else {
            if (window.LC) window.LC.toast('err', 'Chyba odeslání', respData.error || 'Server odmítl linku.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba spojení', err.message);
    }
});

document.addEventListener('lc:line-decision', async (e) => {
    const { id, ok, discord, message, version_mode, target_version } = e.detail;
    try {
        const res = await authFetch(`${API_BASE}/api/community-routes/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                route_id: id,
                id: id,
                ok: ok,
                discord: discord,
                message: message,
                version_mode: version_mode || 'new_version',
                target_version: target_version || ''
            })
        }, 12000);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            if (window.LC) window.LC.toast('err', 'Ověření relace selhalo', 'Automatické obnovení relace se nezdařilo. Zkuste se prosím odhlásit a přihlásit znovu.');
            return;
        }
        if (res.status === 403) {
            await refreshLauncherSessionAndRole(true);
            if (window.LC) window.LC.toast('err', 'Přístup odepřen', data.error || 'Nemáte administrátorská oprávnění.');
            return;
        }
        if (data.success) {
            if (window.LC) {
                const statusTitle = ok
                    ? (data.replaced_existing ? `Verze ${data.version || 'V1'} aktualizována` : `Linka schválena (${data.version || 'V1'})`)
                    : 'Linka zamítnuta';
                window.LC.toast('ok', statusTitle, 'Rozhodnutí bylo uloženo a uživatel byl informován.');
                const [allAdmin, commLines] = await Promise.all([loadPendingAdminQueue(), loadCommunityEditorLines()]);
                if (typeof syncLocalLinesWithDatabase === 'function') {
                    await syncLocalLinesWithDatabase();
                }
                if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(allAdmin);
                else window.LC.setQueue(allAdmin);
                window.LC.setComm(commLines);
                if (window.LC.renderMine) window.LC.renderMine();
            }
        } else {
            if (window.LC) window.LC.toast('err', 'Chyba', data.error || 'Operace selhala.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba spojení', err.message);
    }
});

document.addEventListener('lc:admin-verify', async () => {
    try {
        const ref = await refreshLauncherSessionAndRole(true);
        if (ref && ref.is_admin) {
            const allAdmin = await loadPendingAdminQueue();
            if (window.LC) {
                if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(allAdmin);
                else if (window.LC.setQueue) window.LC.setQueue(allAdmin);
            }
        }
    } catch (_) { }
});

document.addEventListener('lc:admin-refresh', async () => {
    try {
        const ref = await refreshLauncherSessionAndRole(true);
        if (!ref || !ref.is_admin) {
            if (window.LC) window.LC.toast('err', 'Přístup odepřen', 'Nemáte administrátorská oprávnění.');
            return;
        }
        const allAdmin = await loadPendingAdminQueue();
        if (window.LC) {
            if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(allAdmin);
            else if (window.LC.setQueue) window.LC.setQueue(allAdmin);
            window.LC.toast('ok', 'Seznam správy obnoven', `Načteno ${allAdmin.length} komunitních linek.`);
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba načítání', err.message);
    }
});

document.addEventListener('lc:admin-purge', async (e) => {
    const id = e.detail && e.detail.id;
    if (!id) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/community-routes/purge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_id: id })
        }, 12000);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            if (window.LC) window.LC.toast('err', 'Ověření relace selhalo', 'Automatické obnovení relace se nezdařilo. Zkuste se prosím odhlásit a přihlásit znovu.');
            return;
        }
        if (res.status === 403) {
            await refreshLauncherSessionAndRole(true);
            if (window.LC) window.LC.toast('err', 'Přístup odepřen', data.error || 'Nemáte administrátorská oprávnění.');
            return;
        }
        if (data.success) {
            const [allAdmin, commLines] = await Promise.all([loadPendingAdminQueue(), loadCommunityEditorLines()]);
            if (window.LC) {
                if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(allAdmin);
                else window.LC.setQueue(allAdmin);
                if (window.LC.setComm) window.LC.setComm(commLines);
                window.LC.toast('ok', 'Trvale smazáno', 'Linka i její zvukové soubory byly smazány.');
            }
        } else {
            if (window.LC) window.LC.toast('err', 'Chyba', data.error || 'Smazání selhalo.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba spojení', err.message);
    }
});

document.addEventListener('lc:admin-toggle-download', async (e) => {
    const detail = e.detail || {};
    const id = detail.id;
    if (!id) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/community-routes/toggle-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                route_id: id,
                downloads_enabled: detail.downloads_enabled
            })
        }, 12000);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            if (window.LC) window.LC.toast('err', 'Ověření relace selhalo', 'Automatické obnovení relace se nezdařilo. Zkuste se prosím odhlásit a přihlásit znovu.');
            return;
        }
        if (res.status === 403) {
            await refreshLauncherSessionAndRole(true);
            if (window.LC) window.LC.toast('err', 'Přístup odepřen', data.error || 'Nemáte administrátorská oprávnění.');
            return;
        }
        if (data.success) {
            const isOn = Number(data.downloads_enabled) !== 0;
            const [allAdmin, commLines] = await Promise.all([loadPendingAdminQueue(), loadCommunityEditorLines()]);
            if (typeof syncLocalLinesWithDatabase === 'function') {
                await syncLocalLinesWithDatabase();
            }
            if (window.LC) {
                if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(allAdmin);
                else window.LC.setQueue(allAdmin);
                if (window.LC.setComm) window.LC.setComm(commLines);
                if (window.LC.renderMine) window.LC.renderMine();
                window.LC.toast(
                    isOn ? 'ok' : 'warn',
                    isOn ? 'Stahování zapnuto' : 'Stahování vypnuto',
                    isOn ? 'Hráči si mohou tuto linku opět stáhnout.' : 'Linka zůstává evidovaná jako zveřejněná, ale nové stahování je zablokováno.'
                );
            }
        } else {
            if (window.LC) window.LC.toast('err', 'Chyba', data.error || 'Změna stavu stahování selhala.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba spojení', err.message);
    }
});

document.addEventListener('lc:admin-export-official', async (e) => {
    const { id, mode } = e.detail || {};
    if (!id) return;
    const fmt = mode === 'txt' ? 'txt' : 'zip';
    const srcList = (window.LC && window.LC.S && Array.isArray(window.LC.S.adminRoutes) && window.LC.S.adminRoutes.length)
        ? window.LC.S.adminRoutes
        : ((window.LC && window.LC.S && window.LC.S.queue) || []);
    const item = srcList.find(x => String(x.id) === String(id));
    const safeNum = item ? (String(item.num || 'custom').replace(/[^a-zA-Z0-9_-]/g, '') || 'custom') : String(id);
    const defaultName = fmt === 'txt' ? `${safeNum}_auto.txt` : `linka_${safeNum}_oficialni_export.zip`;
    try {
        if (window.LC) window.LC.toast('info', 'Připravuji export…', fmt === 'txt' ? `Generuji ${safeNum}_auto.txt` : `Balím ${safeNum}_auto.txt a hlášení…`);
        const res = await authFetch(`${API_BASE}/api/admin/community-routes/${encodeURIComponent(id)}/export-official?format=${fmt}`, {}, 20000);
        if (res.status === 401) {
            if (window.LC) window.LC.toast('err', 'Ověření relace selhalo', 'Automatické obnovení relace se nezdařilo. Zkuste se prosím odhlásit a přihlásit znovu.');
            return;
        }
        if (res.status === 403) {
            await refreshLauncherSessionAndRole(true);
            if (window.LC) window.LC.toast('err', 'Přístup odepřen', 'Nemáte administrátorská oprávnění.');
            return;
        }
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `HTTP ${res.status}`);
        }
        const ab = await res.arrayBuffer();
        const base64Data = Buffer.from(ab).toString('base64');
        const saveRes = await ipcRenderer.invoke('admin-save-official-export', { mode: mode || 'zip', defaultName, base64Data });
        if (saveRes && saveRes.success) {
            if (mode === 'folder') {
                if (window.LC) window.LC.toast('ok', 'Uloženo do složky', `Vloženo do ${saveRes.path} (linky: ${saveRes.txtCount || 0}, zvuky: ${saveRes.sndCount || 0}).`);
            } else {
                if (window.LC) window.LC.toast('ok', 'Export uložen', `Soubor uložen: ${path.basename(saveRes.path)}`);
            }
        } else if (saveRes && !saveRes.canceled) {
            if (window.LC) window.LC.toast('err', 'Uložení selhalo', saveRes.error || 'Neznámá chyba.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Export selhal', err.message);
    }
});

document.addEventListener('lc:line-export', async (e) => {
    const id = e.detail && e.detail.id;
    const line = (window.LC && window.LC.S && window.LC.S.lines || []).find(x => x.id === id);
    if (!line) return;
    try {
        const res = await ipcRenderer.invoke('export-line-zip', line);
        if (res.success) {
            if (window.LC) window.LC.toast('ok', 'Linka exportována', 'Balíček ZIP byl úspěšně uložen do vašeho počítače.');
        } else if (!res.canceled) {
            if (window.LC) window.LC.toast('err', 'Export selhal', res.error || 'Neznámá chyba.');
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba', err.message);
    }
});

document.addEventListener('lc:save-template', async (e) => {
    const { filename, content } = e.detail || {};
    try {
        const res = await ipcRenderer.invoke('save-text-file', { defaultName: filename || 'vzor-linka.txt', content: content || '' });
        if (res && res.success) {
            if (window.LC) window.LC.toast('ok', 'Vzor uložen', `Soubor uložen: ${path.basename(res.path)}`);
        } else if (res && !res.canceled && res.error) {
            if (window.LC) window.LC.toast('err', 'Uložení selhalo', res.error);
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba', err.message);
    }
});

document.addEventListener('lc:community-download', async (e) => {
    const id = e.detail && e.detail.id;
    const commItem = (window.LC && window.LC.S && window.LC.S.comm || []).find(x => x.id === id);
    if (!commItem) return;
    if (commItem.downloads_enabled === 0) {
        commItem.state = 'idle';
        if (window.LC && window.LC.renderComm) window.LC.renderComm();
        if (window.LC) window.LC.toast('warn', 'Stahování vypnuto', 'Stahování této linky je dočasně vypnuto administrátorem.');
        return;
    }

    const customDataPath = path.join(centralUserDataPath, 'data');
    if (!fs.existsSync(customDataPath)) fs.mkdirSync(customDataPath, { recursive: true });

    if (commItem.packageUrl) {
        let pkgUrl = String(commItem.packageUrl).trim();
        if (pkgUrl.startsWith('/')) pkgUrl = `${API_BASE}${pkgUrl}`;
        const tempZip = path.join(os.tmpdir(), `comm_pkg_${id}_${Date.now()}.zip`);
        const tmpExtractDir = path.join(os.tmpdir(), `comm_ext_${id}_${Date.now()}`);
        try {
            await downloadFileWithProgress({
                url: pkgUrl,
                destPath: tempZip,
                onProgress: (dl, tot, pct) => {
                    commItem.p = pct;
                    if (window.LC && window.LC.renderComm) window.LC.renderComm();
                }
            });
            const soundsDir = path.join(centralUserDataPath, 'sounds');
            const zastavkyDir = path.join(centralUserDataPath, 'zvuky', 'zastavky');
            if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
            if (!fs.existsSync(zastavkyDir)) fs.mkdirSync(zastavkyDir, { recursive: true });
            await extract(tempZip, { dir: tmpExtractDir });

            const copyAudioFlat = (dir) => {
                if (!fs.existsSync(dir)) return;
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        copyAudioFlat(full);
                    } else if (/\.(mp3|wav|ogg|aac|m4a|flac|opus)$/i.test(entry.name)) {
                        try { fs.copyFileSync(full, path.join(soundsDir, entry.name)); } catch (_) { }
                        try { fs.copyFileSync(full, path.join(zastavkyDir, entry.name)); } catch (_) { }
                    }
                }
            };
            copyAudioFlat(tmpExtractDir);
        } catch (err) {
            console.warn('Chyba při stahování zvuků balíčku:', err);
        } finally {
            try { if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip); } catch (_) { }
            try { if (fs.existsSync(tmpExtractDir)) fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (_) { }
        }
    }

    const soundsDirNorm = path.join(centralUserDataPath, 'sounds');
    if (Array.isArray(commItem.stops)) {
        commItem.stops = commItem.stops.map(st => {
            if (!st || typeof st !== 'object') return st;
            const rawAudio = (st.snd && st.snd.name) || st.audio_file || st.audio || '';
            if (rawAudio) {
                const baseAudio = path.basename(String(rawAudio));
                const localAudioPath = path.join(soundsDirNorm, baseAudio);
                st.audio_file = baseAudio;
                if (fs.existsSync(localAudioPath)) {
                    const localUrl = 'file:///' + localAudioPath.replace(/\\/g, '/');
                    st.snd = { name: baseAudio, dur: (st.snd && st.snd.dur) || st.dur || 2.0, url: localUrl };
                }
            }
            return st;
        });
    }

    // Uložit linku do dat
    // Smazání starších stažených verzí stejné linky (čistá instalace bez duplicit)
    try {
        const existingFiles = fs.readdirSync(customDataPath).filter(f => f.startsWith('comm_') && f.endsWith('.json') && f !== `comm_${id}.json`);
        for (const ef of existingFiles) {
            try {
                const cPath = path.join(customDataPath, ef);
                const cData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
                if (String(cData.num).trim() === String(commItem.num).trim()) {
                    fs.unlinkSync(cPath);
                    if (window.LC && window.LC.S && window.LC.S.lines) {
                        window.LC.S.lines = window.LC.S.lines.filter(x => x.id !== cData.id);
                    }
                }
            } catch (_) { }
        }
    } catch (_) { }

    const firstStop = (commItem.stops && commItem.stops.length) ? (commItem.stops[0].name || commItem.stops[0].n || (Array.isArray(commItem.stops[0]) ? commItem.stops[0][0] : '')) : (commItem.from || '');
    const lastStop = (commItem.stops && commItem.stops.length) ? (commItem.stops[commItem.stops.length - 1].name || commItem.stops[commItem.stops.length - 1].n || (Array.isArray(commItem.stops[commItem.stops.length - 1]) ? commItem.stops[commItem.stops.length - 1][0] : '')) : (commItem.dest || '');
    const autoJrName = (firstStop && lastStop && firstStop !== lastStop) ? `${firstStop} – ${lastStop}` : (commItem.dest || `Linka ${commItem.num}`);
    const fullTitle = (commItem.name && !commItem.name.startsWith('Linka ') && commItem.name !== String(commItem.num)) ? commItem.name : (commItem.full_name || autoJrName);

    const lineData = {
        id: `comm_${id}`,
        commId: id,
        num: commItem.num,
        version: commItem.version || 'V1',
        name: fullTitle,
        dest: commItem.dest,
        source: 'comm',
        scope: commItem.scope || 'idpk',
        type: commItem.type || 'realna',
        voice: commItem.voice || 'synt',
        tags: Array.isArray(commItem.tags) ? [...commItem.tags] : [],
        status: 'published',
        stops: commItem.stops || [],
        general_sounds: commItem.general_sounds || {}
    };
    if (!lineData.tags.includes('Komunita')) lineData.tags.unshift('Komunita');
    fs.writeFileSync(path.join(customDataPath, `comm_${id}.json`), JSON.stringify(lineData, null, 2), 'utf8');
    syncRouteFileToLinky(lineData);
    commItem.state = 'installed';
    try { if (typeof ipcRenderer !== 'undefined' && ipcRenderer.send) ipcRenderer.send('notify-routes-updated'); } catch (_) { }

    // Zaznamenat stažení do serverového počítadla (s automatickým vyloučením autora linky)
    try {
        const cfg = loadConfig();
        const curUid = cfg.discord_id || (cfg.email ? 'email-' + cfg.email : currentHWID);
        const curUname = cfg.discord_nick || cfg.email || '';
        fetch(`${API_BASE}/api/community-routes/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                route_id: id,
                user_id: curUid,
                user_name: curUname
            })
        }).then(r => r.json()).then(dlData => {
            if (dlData && dlData.success && typeof dlData.download_count === 'number') {
                commItem.dl = dlData.download_count;
                if (window.LC && window.LC.renderComm) window.LC.renderComm();
            }
        }).catch(() => { });
    } catch (_) { }

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
    ensureCentralUserDataFolders();
    safeOpenFolder(centralUserDataPath);
});

document.addEventListener('lc:open-custom-routes', () => {
    ensureCentralUserDataFolders();
    safeOpenFolder(path.join(centralUserDataPath, 'linky'));
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
        try { fs.rmSync(versionsDir, { recursive: true, force: true }); } catch (e) { }
    }
    if (window.LC) {
        window.LC.toast('ok', 'Data smazána', 'Všechny stažené verze byly odstraněny.');
        syncWithLCVersions();
    }
});

async function syncGtfsData() {
    try {
        return await ipcRenderer.invoke('sync-gtfs-data');
    } catch (e) {
        console.warn('[syncGtfsData IPC fallback error]', e);
        return { error: e.message };
    }
}
window.syncGtfsData = syncGtfsData;

document.addEventListener('lc:gtfs-download', async () => {
    try {
        if (window.LC) window.LC.toast('info', 'Stahování GTFS dat', 'Zahajuji stahování databáze GTFS...');
        const resCr = await ipcRenderer.invoke('gtfs-download-cr');
        if (resCr && resCr.error) {
            throw new Error(resCr.error);
        }
        const resSync = await ipcRenderer.invoke('sync-gtfs-data');
        if (resSync && resSync.error) {
            console.warn('[sync-gtfs-data] Upozornění:', resSync.error);
        }
        if (window.LC) {
            window.LC.setGtfsCR(true);
            window.LC.toast('ok', 'GTFS data aktualizována', 'Byla stažena aktuální data zastávek a linek celé ČR.');
        }
    } catch (e) {
        if (window.LC) window.LC.toast('err', 'Chyba GTFS', e.message || 'Nepodařilo se stáhnout GTFS data');
    }
});

document.addEventListener('lc:community-refresh', async () => {
    try {
        const myLines = await loadLocalEditorLines(false);
        await syncLocalLinesWithDatabase(myLines);
        const [commLines, pendingQueue] = await Promise.all([
            loadCommunityEditorLines(myLines),
            loadPendingAdminQueue()
        ]);
        if (window.LC) {
            if (window.LC.setLines) window.LC.setLines(myLines);
            if (window.LC.setComm) window.LC.setComm(commLines);
            if (window.LC.setAdminRoutes) window.LC.setAdminRoutes(pendingQueue);
            else if (window.LC.setQueue) window.LC.setQueue(pendingQueue);
            if (window.LC.renderComm) window.LC.renderComm();
            if (window.LC.renderMine) window.LC.renderMine();
            window.LC.toast('ok', 'Seznam aktualizován', `Načteno ${commLines.length} komunitních linek.`);
        }
    } catch (err) {
        if (window.LC) window.LC.toast('err', 'Chyba načítání', err.message || 'Nepodařilo se obnovit seznam linek.');
    }
});

document.addEventListener('lc:launcher-update', async () => {
    const btn = document.getElementById('btn-check-launcher-update');
    const txt = document.getElementById('btn-check-launcher-text');
    if (btn) btn.disabled = true;
    if (txt) txt.textContent = 'Kontroluji…';
    try {
        const hasUpdate = await checkForLauncherUpdate();
        if (!hasUpdate && window.LC) {
            window.LC.toast('ok', 'Launcher je aktuální', `Používáte nejnovější verzi v${LAUNCHER_VERSION}.`);
        }
    } catch (e) {
        if (window.LC) window.LC.toast('err', 'Chyba aktualizace', e.message);
    } finally {
        if (btn) btn.disabled = false;
        if (txt) txt.textContent = 'Zkontrolovat launcher';
    }
});
