const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const http = require('http'); 
const { exec } = require('child_process');
const log = require('electron-log');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
global.WebSocket = WebSocket; // DŮLEŽITÉ: Musí se nastavit přímo do Node.js global objektu
const extract = require('extract-zip');
const https = require('https');
const os = require('os');

// Zamezení chyb "Unable to move the cache" / "Gpu Cache Creation failed"
app.commandLine.appendSwitch('disable-gpu-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-disk-cache');

log.info('App starting...');

const SUPABASE_URL = 'https://tdonrppusbwhoftdontz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkb25ycHB1c2J3aG9mdGRvbnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDI1NDIsImV4cCI6MjA4ODM3ODU0Mn0.4RLDe65aE5aW1HtWkfgS0QL6JY1MNzGrA7yfnehBFzo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

process.on('uncaughtException', (error) => {
    console.error('Kritická chyba (Aplikace nespadne):', error);
    if (debugWindow) debugWindow.webContents.send('new-log', `[CRITICAL ERROR] ${error.message}`);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Neošetřený Promise:', reason);
    if (debugWindow) debugWindow.webContents.send('new-log', `[PROMISE ERROR] ${reason}`);
});

let controllerWindow;
let panelWindow;
let debugWindow;
let stopWindow; 
let announcementWindow = null; 

let currentStopState = false; 

const PATH_EXE = path.dirname(process.execPath);
const PATH_DEV = __dirname;
// Cesta k permanentním uživatelským datům (nepřepsána updatem)
const PATH_USERDATA = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'userdata');
const CUSTOM_ROUTES_CACHE = new Map();
try {
    const fsRef = require('fs');
    const customDataPath = path.join(PATH_USERDATA, 'data');
    if (!fsRef.existsSync(customDataPath)) fsRef.mkdirSync(customDataPath, { recursive: true });
    
    const sablonaPath = path.join(customDataPath, '_sablona_vlastni_linky.json');
    if (!fsRef.existsSync(sablonaPath)) {
        const sablona = [
            {
                "spoj": 1,
                "zastavky": [
                    { "name": "Plzeň, Terminál Hlavní nádraží", "zone": "001", "time": "12:00" },
                    { "name": "Plzeň, Mrakodrap", "zone": "001", "time": "12:05" },
                    { "name": "Plzeň, Náměstí Republiky", "zone": "001", "time": "12:10" }
                ]
            }
        ];
        fsRef.writeFileSync(sablonaPath, JSON.stringify(sablona, null, 4));
    }
} catch(e) {}

const cleanStr = (s) => (s === null || s === undefined) ? "" : String(s).replace(/["'\r\n]+/g, '').trim();

function shortenStopName(stopName) {
    return formatStopForDisplay(stopName);
}

function getUniversalPath(folder, filename) {
    // 0. Priorita: uživatelská data (zvuky, obraz, linky) – NIKDY nepřepsáno updatem
    let p_user = path.join(PATH_USERDATA, folder, filename);
    if (fs.existsSync(p_user)) return p_user;

    // 1. Zkontrolujeme userData složku Electronu (pro stažená GTFS data)
    let p0 = path.join(app.getPath('userData'), folder, filename);
    if (fs.existsSync(p0)) return p0;

    // 2. Zkontrolujeme složku vedle EXE
    let p1 = path.join(PATH_EXE, folder, filename);
    if (fs.existsSync(p1)) return p1;

    // 3. Zkontrolujeme vývojářskou složku
    let p2 = path.join(PATH_DEV, folder, filename);
    if (fs.existsSync(p2)) return p2;

    // 4. Zkontrolujeme resources (zabalené)
    let p3 = path.join(process.resourcesPath, folder, filename);
    if (fs.existsSync(p3)) return p3;

    return null;
}

function getUnlockedCustomRoutes() {
    let customRoutes = new Set();
    // Skenujeme userdata/linky (priorita), pak vedle EXE a ve vývojářské složce
    let dirsToScan = [
        path.join(PATH_USERDATA, 'linky'),
        path.join(PATH_EXE, 'linky'),
        path.join(PATH_DEV, 'linky')
    ];
    dirsToScan.forEach(dir => {
        if (fs.existsSync(dir)) {
            let files = fs.readdirSync(dir);
            files.filter(f => f.endsWith('.txt')).forEach(f => {
                try {
                    let content = fs.readFileSync(path.join(dir, f), 'utf-8');
                    let match = content.match(/Linka:\s*["']?(\d+)["']?/i);
                    if (match && match[1]) {
                        customRoutes.add(match[1]);
                    }
                } catch(e) { console.error(e); }
            });
        }
    });
    return customRoutes;
}

function getJsonRouteId(shortName) {
    if (!shortName) return null;
    const clean = String(shortName).trim();
    // 1. Zkontrolujeme přímou shodu názvu souboru
    let p = getUniversalPath('data', `${clean}.json`);
    if (p && fs.existsSync(p)) return clean;

    let numStr = clean.replace(/\D/g, '').replace(/^0+/, '');
    if (numStr) {
        let pNum = getUniversalPath('data', `${numStr}.json`);
        if (pNum && fs.existsSync(pNum)) return numStr;
    }

    // 2. Prohledat složky dat pro nalezení podle parsed.id nebo parsed.num
    const scanDirs = [
        path.join(PATH_USERDATA, 'data'),
        path.join(PATH_EXE, 'data'),
        path.join(PATH_DEV, 'data'),
        path.join(app.getPath('userData'), 'data')
    ];
    for (const dir of scanDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
            for (const f of files) {
                const base = f.replace('.json', '');
                if (base === clean) return base;
                try {
                    const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                    if (parsed && typeof parsed === 'object') {
                        if (String(parsed.id) === clean || String(parsed.num) === clean || (numStr && String(parsed.num) === numStr)) {
                            return base;
                        }
                    }
                } catch(_) {}
            }
        } catch(_) {}
    }
    return null;
}

function loadWindowFile(window, filename) {
    const externalPath = path.join(PATH_EXE, filename);
    if (app.isPackaged && fs.existsSync(externalPath)) {
        window.loadFile(externalPath);
    } else {
        window.loadFile(path.join(__dirname, filename));
    }
}

function initExternalFolders() {
    console.log("Info: Složka data se prohledává dynamicky.");
}

ipcMain.handle('get-hwid', async () => {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            exec('wmic csproduct get uuid', (err, stdout) => {
                if (err) resolve("UNKNOWN-HWID-" + Math.random().toString(36).substr(2, 9));
                else {
                    let lines = stdout.split('\n');
                    let uuid = lines[1] ? lines[1].trim() : ("UNKNOWN-HWID-" + Math.random().toString(36).substr(2, 9));
                    resolve(uuid);
                }
            });
        } else {
            resolve("NON-WIN-HWID-" + Math.random().toString(36).substr(2, 9));
        }
    });
});

function createDebugWindow() {
    debugWindow = new BrowserWindow({
        width: 600, height: 400, title: "Diagnostický Log OIS IDPK V1.6.3", autoHideMenuBar: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    loadWindowFile(debugWindow, 'diagnostika.html');
    debugWindow.on('closed', () => { debugWindow = null; });
}

ipcMain.on('open-stop-window', () => {
    if (stopWindow) { stopWindow.focus(); return; }
    stopWindow = new BrowserWindow({
        width: 800, height: 400, title: "Znamení k zastavení", autoHideMenuBar: true, backgroundColor: '#000000',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    loadWindowFile(stopWindow, 'stop.html');
    stopWindow.on('closed', () => { stopWindow = null; });
});

ipcMain.on('request-stop-state', (event) => { event.reply('update-stop-state', currentStopState); });
ipcMain.on('broadcast-stop-state', (event, isStopPressed) => {
    currentStopState = isStopPressed;
    if (stopWindow) { stopWindow.webContents.send('update-stop-state', isStopPressed); }
});

function createController() {
    controllerWindow = new BrowserWindow({
        width: 380, height: 750, resizable: false, autoHideMenuBar: true, title: "OIS IDPK V1.6.3",
        webPreferences: { nodeIntegration: true, contextIsolation: false, autoplayPolicy: 'no-user-gesture-required', webSecurity: false },
        icon: path.join(__dirname, 'icon.ico')
    });
    loadWindowFile(controllerWindow, 'ovladac.html');
    controllerWindow.on('closed', () => { app.quit(); });
}

// resize-controller byl odstraněn – nastavení nyní používá overlay, ne zvětšení okna



ipcMain.on('open-panel-window', () => {
    if (panelWindow) return;
    panelWindow = new BrowserWindow({ 
        width: 1200, height: 800, autoHideMenuBar: true, frame: true, title: "Informační Panel", 
        webPreferences: { nodeIntegration: true, contextIsolation: false, autoplayPolicy: 'no-user-gesture-required', webSecurity: false },
        icon: path.join(__dirname, 'icon.ico')
    });
    loadWindowFile(panelWindow, 'panel.html');
    panelWindow.maximize();
    panelWindow.on('closed', () => { panelWindow = null; });
});

ipcMain.on('check-announcements', async (event, data) => {
    try {
        const discord_id = data.discord_id;
        const app_id = data.app_id;
        if (!discord_id) return;

        const response = await fetch('https://datacorebot.koyeb.app/api/get_messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: discord_id, app_id: app_id })
        });
        const resData = await response.json();
        
        if (resData.messages && resData.messages.length > 0) {
            showNextAnnouncement(resData.messages, 0, discord_id);
        }
    } catch (e) {
        console.error("Chyba při stahování oznámení: ", e);
    }
});

function showNextAnnouncement(messages, index, discord_id) {
    if (index >= messages.length) return; 

    if (announcementWindow) {
        announcementWindow.close();
        announcementWindow = null;
    }

    const msg = messages[index];
    
    announcementWindow = new BrowserWindow({
        width: 500, height: 400,
        frame: false, transparent: true, alwaysOnTop: true, center: true, resizable: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    let btnHtml = '';
    if (msg.link_url && msg.link_url.trim() !== '') {
        btnHtml = `<a href="#" onclick="require('electron').shell.openExternal('${msg.link_url}')" style="display:inline-block; padding:10px 20px; background:#38bdf8; color:#000; font-weight:bold; text-decoration:none; border-radius:5px; margin-bottom:10px; width:100%; box-sizing:border-box;">Otevřít odkaz</a>`;
    }

    const htmlContent = `
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: transparent; margin: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh; }
            .box { background: #0f172a; border: 2px solid #38bdf8; border-radius: 15px; width: 90%; height: 90%; display: flex; flex-direction: column; color: white; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
            .header { background: #1e293b; padding: 15px; text-align: center; border-radius: 13px 13px 0 0; border-bottom: 2px solid #38bdf8; font-size: 20px; font-weight: 900; text-transform: uppercase; color: #38bdf8; letter-spacing: 1px; }
            .content { padding: 20px; flex-grow: 1; overflow-y: auto; font-size: 15px; line-height: 1.5; text-align: center; }
            .footer { padding: 15px; background: #1e293b; border-radius: 0 0 13px 13px; text-align: center; }
            .close-btn { display:inline-block; width:100%; padding:10px; background:#ef4444; color:white; font-weight:bold; text-decoration:none; border-radius:5px; box-sizing:border-box; cursor:pointer; text-transform:uppercase; border:none; }
            .close-btn:hover { background: #dc2626; }
            ::-webkit-scrollbar { width: 8px; }
            ::-webkit-scrollbar-thumb { background: #38bdf8; border-radius: 4px; }
        </style>
    </head>
    <body>
        <div class="box">
            <div class="header">${msg.title}</div>
            <div class="content">${msg.content}</div>
            <div class="footer">
                ${btnHtml}
                <button class="close-btn" onclick="const { ipcRenderer } = require('electron'); ipcRenderer.send('close-announcement', { id: '${msg.id}', index: ${index} })">Zavřít oznámení</button>
            </div>
        </div>
    </body>
    </html>
    `;

    announcementWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
    
    ipcMain.once('close-announcement', (e, data) => {
        if (announcementWindow) {
            announcementWindow.close();
            announcementWindow = null;
        }
        
        fetch('https://datacorebot.koyeb.app/api/mark_message_read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: discord_id, message_id: msg.id })
        }).catch(() => {});

        showNextAnnouncement(messages, index + 1, discord_id);
    });
}

ipcMain.on('debug-log', (event, msg) => { console.log(msg); if (debugWindow) debugWindow.webContents.send('new-log', msg); });
ipcMain.on('forward-key-to-controller', (event, key) => { if (controllerWindow) controllerWindow.webContents.send('trigger-key-action', key); });
ipcMain.on('update-panel-data', (event, data) => { if (panelWindow) panelWindow.webContents.send('update-panel-data', data); });
ipcMain.on('update-time-delay', (event, data) => { if (panelWindow) panelWindow.webContents.send('update-time-delay', data); });
ipcMain.on('reset-panel', () => { if (panelWindow) panelWindow.webContents.send('reset-panel-ui'); });
ipcMain.on('reload-panel-window', () => { if (panelWindow) panelWindow.reload(); });
ipcMain.on('panel-boot', () => { if (panelWindow) panelWindow.webContents.send('show-boot-screen'); });
ipcMain.on('panel-idle', () => { if (panelWindow) panelWindow.webContents.send('reset-panel-ui'); });
function sendStatsToBackend(data) {
    return new Promise((resolve) => {
        try {
            if (!data || !data.line) return resolve();
            const lStr = String(data.line).trim();
            if (lStr.startsWith('user_') || lStr.startsWith('comm_') || lStr.includes(':::') || lStr.includes('1794516125535') || lStr.includes('user_732')) {
                return resolve();
            }
            const payload = JSON.stringify(data);
            const req = https.request('https://datacorebot.koyeb.app/api/submit_stats', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                },
                timeout: 3000
            }, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', () => resolve());
            req.on('timeout', () => { req.destroy(); resolve(); });
            req.write(payload);
            req.end();
        } catch(e) {
            resolve();
        }
    });
}

let pendingStatsPromise = Promise.resolve();

ipcMain.on('save-stats-on-close', (event, data) => {
    if (data && data.line && data.stops && data.stops.length > 0) {
        pendingStatsPromise = sendStatsToBackend(data);
    }
});

ipcMain.on('quit-app', async (event, data) => {
    try {
        if (data && data.line && data.stops && data.stops.length > 0) {
            await sendStatsToBackend(data);
        } else if (pendingStatsPromise) {
            await Promise.race([pendingStatsPromise, new Promise(r => setTimeout(r, 2000))]);
        }
    } catch(e) {}
    app.quit();
});

app.on('before-quit', async (e) => {
    try {
        if (pendingStatsPromise) {
            await Promise.race([pendingStatsPromise, new Promise(r => setTimeout(r, 2000))]);
        }
    } catch(e) {}
});
ipcMain.on('relaunch-app', () => { app.relaunch(); app.exit(); });
ipcMain.on('install-launcher-update', (event, installerPath) => {
    try {
        const { spawn } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        if (!installerPath || !fs.existsSync(installerPath)) {
            console.error('[install-launcher-update] Soubor instalátoru neexistuje:', installerPath);
            return;
        }

        const stat = fs.statSync(installerPath);
        if (stat.size < 5000000) {
            console.error('[install-launcher-update] Instalátor je neúplný nebo poškozený (velikost: ' + stat.size + ' B):', installerPath);
            try { fs.unlinkSync(installerPath); } catch (_) {}
            return;
        }

        const appExe = process.execPath;
        const tempBatch = path.join(os.tmpdir(), `idpk_updater_${Date.now()}.bat`);

        const scriptContent = [
            '@echo off',
            'timeout /t 2 /nobreak >nul',
            `start "" /wait "${installerPath}" /S`,
            'timeout /t 1 /nobreak >nul',
            `start "" "${appExe}"`,
            'del "%~f0"'
        ].join('\r\n');

        fs.writeFileSync(tempBatch, scriptContent, 'utf8');

        const child = spawn('cmd.exe', ['/c', tempBatch], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();

        app.quit();
    } catch (e) {
        console.error('Error starting launcher updater:', e);
    }
});
ipcMain.on('minimize-app', () => { 
    if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.minimize();
    }
    // Also support minimizing controller if that sends it
    if (controllerWindow && !controllerWindow.isDestroyed() && !launcherWindow) {
        controllerWindow.minimize();
    }
});
ipcMain.on('fallback-to-launcher', () => {
    if (controllerWindow && !controllerWindow.isDestroyed()) {
        controllerWindow.removeAllListeners('closed');
        controllerWindow.close();
    }
    createLauncher();
});
ipcMain.on('open-userdata-folder', () => {
    const udPath = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'userdata', 'linky');
    if (!fs.existsSync(udPath)) fs.mkdirSync(udPath, { recursive: true });
    require('electron').shell.openPath(udPath);
});

function getDataFilePath(filename) { return getUniversalPath('data', filename) || path.join(__dirname, 'data', filename); }

ipcMain.handle('get-link-files', async () => {
    try {
        const routeNameMap = new Map();
        try {
            await ensureGtfsCache();
            if (idpkDb) {
                let stmt = idpkDb.prepare("SELECT route_short_name, route_long_name FROM routes WHERE (route_type = '3' OR route_type = 3)");
                while (stmt.step()) {
                    let row = stmt.getAsObject();
                    let rShort = cleanStr(row.route_short_name);
                    let rLong = cleanStr(row.route_long_name);
                    
                    if (rLong) {
                        rLong = rLong.replace(/(^|[\s-])([a-zěščřžýáíéóúůďťň])/g, (match) => match.toUpperCase());
                    }
                    
                    let rNum = parseInt(rShort);
                    if (!isNaN(rNum) && rShort.length >= 5) {
                        const inRange = (rNum >= 400621 && rNum <= 405611) || 
                                        (rNum >= 430432 && rNum <= 440649) || 
                                        (rNum >= 450411 && rNum <= 475211) || 
                                        (rNum >= 490722 && rNum <= 496711);
                        if (inRange) {
                            let endStr = rShort.slice(-3).replace(/^0+/, '');
                            if (endStr.length > 0) routeNameMap.set(endStr, rLong);
                        }
                    }
                }
                stmt.free();
            }
        } catch(e) { console.error(e); }

        let files = new Set();
        function processDir(dir) {
            if (!fs.existsSync(dir)) return;
            let fileList = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
            fileList.forEach(f => {
                let name = f.replace('.txt', '');
                let routeNum = name.replace(/\D/g, ''); // Extract just the number e.g. 739
                let dest = routeNameMap.get(routeNum) || "";
                
                if (dest) {
                    files.add(name + ' | ' + dest);
                } else {
                    files.add(name);
                }
            });
        }
        processDir(path.join(PATH_USERDATA, 'linky'));
        processDir(path.join(PATH_EXE, 'linky'));
        processDir(path.join(PATH_DEV, 'linky'));
        processDir(path.join(process.resourcesPath, 'linky'));
        return Array.from(files).sort();
    } catch (error) { return []; }
});

ipcMain.handle('read-route-file', async (event, filename) => {
    let cleanName = filename.split('|')[0].toLowerCase().replace('.txt', '').replace(/[\r\n]+/g, '').trim();
    let p = getUniversalPath('linky', `${cleanName}.txt`); if (p) return fs.readFileSync(p, 'utf-8');
    let pCustom = getUniversalPath('linky', `${cleanName}_custom.txt`); if (pCustom) return fs.readFileSync(pCustom, 'utf-8');
    let pAuto = getUniversalPath('linky', `${cleanName}_auto.txt`); if (pAuto) return fs.readFileSync(pAuto, 'utf-8');
    let pOde = getUniversalPath('linky', `${cleanName}_ode.txt`); if (pOde) return fs.readFileSync(pOde, 'utf-8');
    let pBeta = getUniversalPath('linky', `${cleanName}_auto-beta.txt`); if (pBeta) return fs.readFileSync(pBeta, 'utf-8');

    const dirsToSearch = [
        path.join(PATH_USERDATA, 'linky'),
        path.join(PATH_EXE, 'linky'),
        path.join(PATH_DEV, 'linky')
    ];
    for (const d of dirsToSearch) {
        if (!fs.existsSync(d)) continue;
        const matched = fs.readdirSync(d).find(f => {
            const low = f.toLowerCase();
            return low === `${cleanName}.txt` || low.startsWith(`${cleanName}_`) || low.includes(`${cleanName}_custom`);
        });
        if (matched) return fs.readFileSync(path.join(d, matched), 'utf-8');
    }
    return null;
});

function cleanZones(zoneStr) { if (!zoneStr) return ""; let parts = String(zoneStr).split(/[ ,;]+/).map(x => x.trim().replace(/^P/i, '')).filter(x => x.length > 0); return [...new Set(parts)].join('<br>'); }

function parseCSV(str) {
    if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1);
    const arr = []; let quote = false; let col = '';
    for (let c of str) {
        if (c === '"') { quote = !quote; continue; }
        if (c === ',' && !quote) { arr.push(col.replace(/[\r\n]+/g, '').trim()); col = ''; continue; }
        col += c;
    }
    arr.push(col.replace(/[\r\n]+/g, '').trim()); return arr;
}

// Universal Stop Display Formatter (standardized Czech transit abbreviations for panel & screen)
function formatStopForDisplay(name) {
    if (!name) return "";
    let s = name.trim();
    s = s.replace(/,+/g, ',');
    s = s.replace(/,\s*/g, ', ');
    
    // Specific transit abbreviations for display
    s = s.replace(/(?<!\p{L})(h[aá]jen[kc]\p{L}*|h[aá]jovn\p{L}*|h[aá]j)\.?(?!\p{L})/giu, 'háj.');
    s = s.replace(/\bautobusov[aá]\s+stanice\b/gi, 'aut. st.');
    s = s.replace(/\bautobusov[eé]\s+stanovi[sš]t[eě]\b/gi, 'aut. st.');
    s = s.replace(/\bautobusov[eé]\s+n[aá]dra[zž][ií]\b/gi, 'aut. nádr.');
    s = s.replace(/\b[zž]elezni[cč]n[ií]\s+stanice\b/gi, 'žel. st.');
    s = s.replace(/\brozcest[ií]\b/gi, 'rozc.');
    s = s.replace(/\brestaurace\b/gi, 'rest.');
    s = s.replace(/\bpr[uů]myslov[aá]\s+z[oó]na\b/gi, 'prům. zóna');
    s = s.replace(/\bn[aá]m[eě]st[ií]\b/gi, 'nám.');
    s = s.replace(/\bnemocnice\b/gi, 'nem.');
    s = s.replace(/\bz[aá]vod\b/gi, 'záv.');
    s = s.replace(/\bzdravotn[ií]\s+st[rř]edisko\b/gi, 'zdrav. stř.');
    s = s.replace(/\b(obecn[ií]\s+[uú][rř]ad|ob[uú])\b/gi, 'ObÚ');
    
    s = s.replace(/\.\.+/g, '.');
    s = s.replace(/\s+/g, ' ');
    return s.trim();
}

// Universal Stop Canonicalizer & Audio Resolution System
function canonicalizeStopName(str) {
    if (!str) return "";
    let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    
    // Normalize punctuation & decimal numbers (e.g. 2.0 / 2,0 -> 2)
    s = s.replace(/\b(\d+)[\.,]0+\b/g, "$1");
    s = s.replace(/[\/\\–—_\-.,;()]/g, " ");
    
    // Normalize Roman numerals
    s = s.replace(/\bviii\b/g, "8").replace(/\bvii\b/g, "7").replace(/\bvi\b/g, "6").replace(/\bv\b/g, "5").replace(/\biv\b/g, "4").replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\bi\b/g, "1");
    
    // Czech transit abbreviations & inflections (lemmatization)
    s = s.replace(/\b(autobusove\s+nadrazi|aut\s*nadr|aut\s*nadrazi)\b/g, "aut nadr");
    s = s.replace(/\b(autobusova\s+stanice|autobusove\s+stanoviste|aut\s*st|aut\s*stanice|aut\s*stanoviste)\b/g, "aut st");
    s = s.replace(/\b(zeleznicni\s+stanice|zel\s*st|zel\s*stanice)\b/g, "zel st");
    s = s.replace(/\b(nadrazi|nadr|nadraz)\b/g, "nadr");
    s = s.replace(/\b(rozcesti|rozc)\b/g, "rozc");
    s = s.replace(/\b(namesti|nam)\b/g, "nam");
    s = s.replace(/\b(nemocnice|nemocnici|nem)\b/g, "nem");
    s = s.replace(/\b(skola|skoly|skole|skolou|skolni|skol|sk|zs|zakladni\s+skola)\b/g, "skola");
    s = s.replace(/\b(hrbitov|hrbitove|hrb)\b/g, "hrbitov");
    s = s.replace(/\b(restaurace|restauraci|rest)\b/g, "rest");
    s = s.replace(/\b(prumyslova\s+zona|prum\s*zona|pz)\b/g, "prumyslova zona");
    s = s.replace(/\b(hajenk\w*|hajovn\w*|haj)\b/g, "haj");
    s = s.replace(/\b(hradiste|hrad)\b/g, "hrad");
    s = s.replace(/\b(zdravotni\s+stredisko|zdrav\s*str|zdrav)\b/g, "zdrav str");
    s = s.replace(/\b(predmesti|predm)\b/g, "predmesti");
    s = s.replace(/\b(stredisko|str)\b/g, "stredisko");
    s = s.replace(/\b(sidliste|sidl)\b/g, "sidliste");
    s = s.replace(/\b(krizovatka|kriz)\b/g, "krizovatka");
    s = s.replace(/\b(zavod|zav)\b/g, "zavod");
    s = s.replace(/\b(obecni\s+urad|ob\s*urad|obu)\b/g, "obu");
    s = s.replace(/\b(ulice|ul)\b/g, " ");
    s = s.replace(/\b(pod|p)\b/g, "pod");
    s = s.replace(/\b(city\s*servis)\b/g, "cityservis");
    // Strip Czech prepositions when canonicalizing stop identity
    s = s.replace(/\b(u|v|ve|na|nad|k|ke|ku|od|do)\b/g, " ");
    s = s.replace(/[^a-z0-9\s]/g, " ");
    return s.replace(/\s+/g, " ").trim();
}

function getStopTokens(str) {
    return str.split(" ").filter(t => t.length > 0);
}

function matchCanonicalStops(gtfsCanon, candCanon) {
    if (!gtfsCanon || !candCanon) return false;
    if (gtfsCanon === candCanon) return true;
    
    const t1 = getStopTokens(gtfsCanon);
    const t2 = getStopTokens(candCanon);
    if (t1.length === t2.length) {
        if ([...t1].sort().join(" ") === [...t2].sort().join(" ")) return true;
    }
    return false;
}

function normalizeName(str) { 
    return canonicalizeStopName(str);
}

let _GLOBAL_STOP_CATALOG = null;
let _AUDIO_FILES_INDEX = null;

function getSearchDirectories(subFolder) {
    const dirs = [];
    if (typeof PATH_USERDATA !== 'undefined' && PATH_USERDATA) dirs.push(path.join(PATH_USERDATA, subFolder));
    if (typeof PATH_EXE !== 'undefined' && PATH_EXE) dirs.push(path.join(PATH_EXE, subFolder));
    if (typeof PATH_DEV !== 'undefined' && PATH_DEV) dirs.push(path.join(PATH_DEV, subFolder));
    if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, subFolder));
    return dirs.filter((d, i, self) => fs.existsSync(d) && self.indexOf(d) === i);
}

function loadGlobalStopCatalog() {
    if (_GLOBAL_STOP_CATALOG) return _GLOBAL_STOP_CATALOG;
    _GLOBAL_STOP_CATALOG = new Map();
    const dirs = getSearchDirectories('linky');
    for (const dir of dirs) {
        try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(dir, file), 'utf8');
                    for (const line of content.split('\n')) {
                        if (!line.includes('=')) continue;
                        const parts = line.split('=');
                        const stopName = parts[0].trim();
                        const right = parts[1].trim();
                        const rParts = right.split('|');
                        let rawAudio = rParts[0].trim().replace(/"/g, '');
                        if (!rawAudio) continue;
                        if (!rawAudio.toLowerCase().endsWith('.wav')) rawAudio += '.wav';
                        
                        const canon = canonicalizeStopName(stopName);
                        if (!_GLOBAL_STOP_CATALOG.has(canon)) {
                            _GLOBAL_STOP_CATALOG.set(canon, { audio: rawAudio, rawName: stopName, lineData: right });
                        }
                    }
                } catch(e) {}
            }
        } catch(e) {}
    }
    return _GLOBAL_STOP_CATALOG;
}

function loadAudioFilesIndex() {
    if (_AUDIO_FILES_INDEX) return _AUDIO_FILES_INDEX;
    _AUDIO_FILES_INDEX = new Map();
    const dirs = [
        ...getSearchDirectories(path.join('zvuky', 'zastavky')),
        ...getSearchDirectories(path.join('zvuky', 'hlaseni')),
        ...getSearchDirectories('zvuky')
    ];
    for (const dir of dirs) {
        try {
            const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.wav'));
            for (const file of files) {
                const base = file.replace(/\.wav$/i, '');
                const canon = canonicalizeStopName(base.replace(/_/g, ' '));
                if (!_AUDIO_FILES_INDEX.has(canon)) _AUDIO_FILES_INDEX.set(canon, file);
                const noSpace = canon.replace(/\s+/g, '');
                if (!_AUDIO_FILES_INDEX.has(noSpace)) _AUDIO_FILES_INDEX.set(noSpace, file);
                const baseLower = base.toLowerCase();
                if (!_AUDIO_FILES_INDEX.has(baseLower)) _AUDIO_FILES_INDEX.set(baseLower, file);
            }
        } catch(e) {}
    }
    return _AUDIO_FILES_INDEX;
}

function resolveStopAudio(stopName, localStopMap = null) {
    if (!stopName) return null;
    const canon = canonicalizeStopName(stopName);
    if (!canon) return null;
    
    // 1. Zkontrolovat v lokální mapě načteného .txt souboru linky
    if (localStopMap) {
        if (localStopMap[canon]) {
            const val = localStopMap[canon];
            const audio = val.split('|')[0].trim().replace(/"/g, '');
            return { source: 'local_exact', audio: audio.endsWith('.wav') ? audio : audio + '.wav', lineData: val };
        }
        for (const [k, v] of Object.entries(localStopMap)) {
            if (matchCanonicalStops(canon, canonicalizeStopName(k))) {
                const audio = v.split('|')[0].trim().replace(/"/g, '');
                return { source: 'local_canon', audio: audio.endsWith('.wav') ? audio : audio + '.wav', lineData: v };
            }
        }
    }
    
    // 2. Prohledat globální katalog zastávek ze všech .txt souborů
    const catalog = loadGlobalStopCatalog();
    if (catalog.has(canon)) {
        const entry = catalog.get(canon);
        return { source: 'global_txt_exact', audio: entry.audio, lineData: entry.lineData };
    }
    for (const [cKey, entry] of catalog.entries()) {
        if (matchCanonicalStops(canon, cKey)) {
            return { source: 'global_txt_token', audio: entry.audio, lineData: entry.lineData };
        }
    }
    
    // 3. Prohledat fyzické zvukové soubory ve složkách zvuky/zastavky a zvuky/hlaseni
    const audioIdx = loadAudioFilesIndex();
    if (audioIdx.has(canon)) {
        return { source: 'direct_wav', audio: audioIdx.get(canon), lineData: "" };
    }
    const noSpace = canon.replace(/\s+/g, '');
    if (audioIdx.has(noSpace)) {
        return { source: 'direct_wav_nospace', audio: audioIdx.get(noSpace), lineData: "" };
    }
    
    return null;
}

function cleanLineDisplay(val) {
    if (!val) return '';
    let s = String(val).trim();
    s = s.replace(/^(user|comm|ai)_+/i, '');
    s = s.replace(/_custom.*/i, '');
    s = s.replace(/_auto.*/i, '');
    if (s.includes('_')) {
        s = s.split('_')[0];
    }
    if (s.length >= 5 && !isNaN(parseInt(s, 10))) {
        s = s.slice(-3).replace(/^0+/, '');
    }
    return s;
}

function parseTextFileStopsToMap(lines) { 
    let map = {}; 
    for(let line of lines) { 
        if(line.includes('=')) { 
            let parts = line.split('='); 
            map[canonicalizeStopName(parts[0].trim())] = parts[1].trim(); 
        } 
    } 
    return map; 
}

function findBestMatch(normGtfs, stopMap) { 
    let res = resolveStopAudio(normGtfs, stopMap);
    return res && res.lineData ? res.lineData : (res && res.audio ? `${res.audio} | Display: ${normGtfs}` : null);
}

function normalizeJsonRouteTrips(rawJson, defaultRouteNum = '') {
    if (Array.isArray(rawJson)) {
        if (rawJson.length > 0 && rawJson[0] && Array.isArray(rawJson[0].zastavky)) {
            return rawJson;
        }
        if (rawJson.length > 0 && typeof rawJson[0] === 'object') {
            return [{
                spoj: 1,
                smer: rawJson[rawJson.length - 1].name || rawJson[rawJson.length - 1].n || 'Konečná',
                odjezd: rawJson[0].time || '08:00',
                zastavky: rawJson.map(s => ({
                    name: s.name || s.n || '',
                    zone: cleanZones(s.zone || s.z || '1'),
                    time: s.time || '',
                    type: s.req ? 'z' : 'n',
                    audio: (s.snd && s.snd.name) ? s.snd.name : (s.audio || '')
                }))
            }];
        }
        return [];
    }
    if (!rawJson || typeof rawJson !== 'object') return [];

    const stops = (Array.isArray(rawJson.stops) ? rawJson.stops : []).filter(Boolean);
    const stopMap = new Map();
    stops.forEach((s, idx) => {
        const sId = s.id != null ? String(s.id) : String(idx);
        const name = (s.n || s.name || s.orig || '').trim();
        const zone = cleanZones(s.z || s.zone || '1');
        const req = !!s.req;
        const audio = (s.snd && s.snd.name) ? s.snd.name : (s.audio_file || s.audio || '');
        stopMap.set(sId, { name, zone, req, audio });
    });

    const routeNum = rawJson.num || defaultRouteNum || '';
    const trips = Array.isArray(rawJson.trips) ? rawJson.trips : [];
    const resultTrips = [];

    if (trips.length > 0) {
        trips.forEach((t, tIdx) => {
            const spojNum = parseInt(t.no) || (tIdx + 1);
            const items = Array.isArray(t.items) ? t.items : [];
            const tripStops = [];
            for (const item of items) {
                const sObj = stopMap.get(String(item.s)) || { name: String(item.s || ''), zone: '1', req: false, audio: '' };
                tripStops.push({
                    name: sObj.name,
                    zone: sObj.zone,
                    time: item.time || '',
                    type: sObj.req ? 'z' : 'n',
                    audio: sObj.audio
                });
            }
            if (tripStops.length > 0) {
                const firstStop = tripStops[0].name;
                const lastStop = tripStops[tripStops.length - 1].name;
                const smer = lastStop;
                const odjezd = tripStops[0].time || '08:00';
                resultTrips.push({
                    spoj: spojNum,
                    smer: smer,
                    odjezd: odjezd,
                    zastavky: tripStops
                });
            }
        });
    }

    // Pokud nejsou žádné explicitní spoje (nebo bylo vytvořeno z GTFS / AI bez spojů),
    // automaticky vygenerujeme základní spoje tam a zpět (pravidlo uživatele #2)!
    if (resultTrips.length === 0 && stops.length >= 2) {
        const forwardStops = stops.map((s, idx) => {
            const sName = (s.n || s.name || s.orig || '').trim();
            const sZone = cleanZones(s.z || s.zone || '1');
            const sReq = !!s.req;
            const sAudio = (s.snd && s.snd.name) ? s.snd.name : (s.audio_file || s.audio || '');
            const m = idx * 3;
            const hh = String(6 + Math.floor(m / 60)).padStart(2, '0');
            const mm = String(m % 60).padStart(2, '0');
            return {
                name: sName,
                zone: sZone,
                time: `${hh}:${mm}`,
                type: sReq ? 'z' : 'n',
                audio: sAudio
            };
        });
        resultTrips.push({
            spoj: 1,
            smer: forwardStops[forwardStops.length - 1].name,
            odjezd: forwardStops[0].time,
            zastavky: forwardStops
        });

        [3, 5, 7].forEach((spojNum, sIdx) => {
            const startHour = 8 + sIdx * 3;
            const tStops = forwardStops.map((st, idx) => {
                const m = idx * 3;
                const hh = String(startHour + Math.floor(m / 60)).padStart(2, '0');
                const mm = String(m % 60).padStart(2, '0');
                return { ...st, time: `${hh}:${mm}` };
            });
            resultTrips.push({
                spoj: spojNum,
                smer: tStops[tStops.length - 1].name,
                odjezd: tStops[0].time,
                zastavky: tStops
            });
        });

        const backwardStops = stops.slice().reverse().map((s, idx) => {
            const sName = (s.n || s.name || s.orig || '').trim();
            const sZone = cleanZones(s.z || s.zone || '1');
            const sReq = !!s.req;
            const sAudio = (s.snd && s.snd.name) ? s.snd.name : (s.audio_file || s.audio || '');
            const m = idx * 3;
            const hh = String(7 + Math.floor(m / 60)).padStart(2, '0');
            const mm = String(m % 60).padStart(2, '0');
            return {
                name: sName,
                zone: sZone,
                time: `${hh}:${mm}`,
                type: sReq ? 'z' : 'n',
                audio: sAudio
            };
        });
        resultTrips.push({
            spoj: 2,
            smer: backwardStops[backwardStops.length - 1].name,
            odjezd: backwardStops[0].time,
            zastavky: backwardStops
        });

        [4, 6, 8].forEach((spojNum, sIdx) => {
            const startHour = 9 + sIdx * 3;
            const tStops = backwardStops.map((st, idx) => {
                const m = idx * 3;
                const hh = String(startHour + Math.floor(m / 60)).padStart(2, '0');
                const mm = String(m % 60).padStart(2, '0');
                return { ...st, time: `${hh}:${mm}` };
            });
            resultTrips.push({
                spoj: spojNum,
                smer: tStops[tStops.length - 1].name,
                odjezd: tStops[0].time,
                zastavky: tStops
            });
        });
    }

    return resultTrips;
}

function loadJsonData(jsonId) {
    try {
        let p = getUniversalPath('data', `${jsonId}.json`);
        if (!p) {
            const resolvedId = getJsonRouteId(jsonId);
            if (resolvedId) p = getUniversalPath('data', `${resolvedId}.json`);
        }
        if (p && fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(content);
            return normalizeJsonRouteTrips(parsed, jsonId);
        }
    } catch(e) {
        console.error('[loadJsonData] Chyba:', e);
    }
    return [];
}

function loadRawJsonRoute(jsonId) {
    try {
        let p = getUniversalPath('data', `${jsonId}.json`);
        if (!p) {
            const resolvedId = getJsonRouteId(jsonId);
            if (resolvedId) p = getUniversalPath('data', `${resolvedId}.json`);
        }
        if (p && fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            return JSON.parse(content);
        }
    } catch(e) {
        console.error('[loadRawJsonRoute] Chyba:', e);
    }
    return null;
}

function extractSpojNumber(tripId, routeId) {
    let cleanTrip = cleanStr(tripId);
    let routeNumeric = routeId.trim().replace(/\D/g, '');
    let parts = cleanTrip.split(/[-_]/);
    for (let i = 0; i < parts.length - 1; i++) {
        let pClean = parts[i].replace(/\D/g, '');
        if (pClean === routeNumeric || (routeNumeric.length >= 3 && pClean.endsWith(routeNumeric))) {
            let cand = parts[i+1].replace(/\D/g, '').replace(/^0+/, ''); 
            if (cand) return cand;
        }
    }
    let numericTrip = cleanTrip.replace(/\D/g, '');
    if (routeNumeric.length > 0 && numericTrip.includes(routeNumeric)) {
        let splitParts = numericTrip.split(routeNumeric);
        let suffix = splitParts[splitParts.length - 1];
        if (suffix.length > 0) {
            if (suffix.length > 3 && (suffix.endsWith('1') || suffix.endsWith('2'))) { suffix = suffix.slice(0, -1); }
            let cleaned = suffix.replace(/^0+/, '');
            if (cleaned.length > 0) return cleaned;
        }
    }
    let match = cleanTrip.match(/_(\d+)$|-(\d+)$/);
    if (match) return match[1] ? match[1].replace(/^0+/, '') : match[2].replace(/^0+/, '');
    let last3 = numericTrip.slice(-3).replace(/^0+/, '');
    if (last3.length > 0) return last3;
    return numericTrip.slice(-1) || '1';
}

function getActiveServiceIds(db) {
    if (!db) return [];
    try {
        const today = new Date();
        const yyyymmdd = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
        const dayOfWeekStr = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][today.getDay()];
        
        let query = `
            SELECT service_id FROM calendar 
            WHERE start_date <= ? AND end_date >= ? AND ${dayOfWeekStr} = 1
        `;
        let stmt = db.prepare(query);
        stmt.bind([yyyymmdd, yyyymmdd]);
        let active = new Set();
        while(stmt.step()) active.add(stmt.getAsObject().service_id);
        stmt.free();
        
        let exQuery = `SELECT service_id, exception_type FROM calendar_dates WHERE date = ?`;
        let stmt2 = db.prepare(exQuery);
        stmt2.bind([yyyymmdd]);
        while(stmt2.step()) {
            let row = stmt2.getAsObject();
            if (row.exception_type === 1) active.add(row.service_id);
            else if (row.exception_type === 2) active.delete(row.service_id);
        }
        stmt2.free();
        
        return Array.from(active);
    } catch(e) {
        return [];
    }
}

function parseJsonTripId(tripId) {
    if (!tripId) return null;
    if (tripId.startsWith('json:::')) {
        const parts = tripId.split(':::');
        return { jsonId: parts[1], spojNum: parseInt(parts[2], 10) || 1 };
    }
    if (tripId.startsWith('json_')) {
        const lastUnderscore = tripId.lastIndexOf('_');
        if (lastUnderscore > 5) {
            return {
                jsonId: tripId.substring(5, lastUnderscore),
                spojNum: parseInt(tripId.substring(lastUnderscore + 1), 10) || 1
            };
        }
        return { jsonId: tripId.replace('json_', ''), spojNum: 1 };
    }
    return null;
}

function getRouteIdsForShortName(routeId, db) {
    if (!db) return [routeId];
    try {
        let clean = String(routeId).trim();
        let rIds = new Set();
        let shortNames = new Set();

        let stmt1 = db.prepare("SELECT route_id, route_short_name FROM routes WHERE (route_type = '3' OR route_type = 3) AND (route_id = ? OR route_short_name = ?)");
        stmt1.bind([clean, clean]);
        while (stmt1.step()) {
            let row = stmt1.getAsObject();
            if (row.route_id) rIds.add(row.route_id);
            if (row.route_short_name && String(row.route_short_name).trim().length > 0) {
                shortNames.add(String(row.route_short_name).trim());
            }
        }
        stmt1.free();

        if (rIds.size === 0 && /^\d+$/.test(clean)) {
            let stmt2 = db.prepare("SELECT route_id, route_short_name FROM routes WHERE (route_type = '3' OR route_type = 3) AND (route_short_name LIKE ? OR route_id LIKE ?)");
            stmt2.bind(['%' + clean, '%' + clean]);
            while (stmt2.step()) {
                let row = stmt2.getAsObject();
                let sn = String(row.route_short_name || '').trim();
                let rid = String(row.route_id || '').trim();
                if (sn === clean || sn.endsWith(clean) || rid === clean || rid.endsWith(clean)) {
                    if (row.route_id) rIds.add(row.route_id);
                    if (sn.length > 0) shortNames.add(sn);
                }
            }
            stmt2.free();
        }

        for (let sn of shortNames) {
            let stmt3 = db.prepare("SELECT route_id FROM routes WHERE (route_type = '3' OR route_type = 3) AND route_short_name = ?");
            stmt3.bind([sn]);
            while (stmt3.step()) {
                let row = stmt3.getAsObject();
                if (row.route_id) rIds.add(row.route_id);
            }
            stmt3.free();
        }

        if (!rIds.has(clean)) rIds.add(clean);
        return Array.from(rIds);
    } catch(e) {
        return [routeId];
    }
}

async function getDbTargetsForRoute(routeId) {
    await ensureGtfsCache();
    await ensureCrCache();
    const cleanId = String(routeId).trim();

    // 1. Prioritize IDPK database: if route has trips in IDPK, strictly use IDPK only!
    if (idpkDb) {
        const rIds = getRouteIdsForShortName(cleanId, idpkDb);
        let has = false;
        try {
            let stmt = idpkDb.prepare(`SELECT 1 FROM trips WHERE route_id IN (${rIds.map(()=>'?').join(',')}) LIMIT 1`);
            stmt.bind(rIds);
            if (stmt.step()) has = true;
            stmt.free();
        } catch(_) {}
        if (has) {
            return [{ db: idpkDb, rIds, isCr: false }];
        }
    }

    // 2. Only if not in IDPK, query national CR database
    if (crDb) {
        const rIds = getRouteIdsForShortName(cleanId, crDb);
        let has = false;
        try {
            let stmt = crDb.prepare(`SELECT 1 FROM trips WHERE route_id IN (${rIds.map(()=>'?').join(',')}) LIMIT 1`);
            stmt.bind(rIds);
            if (stmt.step()) has = true;
            stmt.free();
        } catch(_) {}
        if (has) {
            return [{ db: crDb, rIds, isCr: true }];
        }
    }

    if (idpkDb) return [{ db: idpkDb, rIds: getRouteIdsForShortName(cleanId, idpkDb), isCr: false }];
    if (crDb) return [{ db: crDb, rIds: getRouteIdsForShortName(cleanId, crDb), isCr: true }];
    return [];
}

async function findRouteId(shortName, exactRouteId = null) {
    await ensureGtfsCache();
    await ensureCrCache();
    let query = "SELECT route_id, route_short_name FROM routes WHERE (route_type = '3' OR route_type = 3)";
    
    const checkRow = (rId, rShort) => {
        const sClean = String(shortName || '').trim();
        const eClean = String(exactRouteId || '').trim();
        const rIdClean = String(rId || '').trim();
        const rShortClean = String(rShort || '').trim();

        if (eClean && (rShortClean === eClean || rIdClean === eClean)) return rId;
        if (sClean && (rShortClean === sClean || rIdClean === sClean)) return rId;

        if (sClean.length >= 3) {
            if (rShortClean.endsWith(sClean) || rIdClean.endsWith(sClean)) return rId;
        }
        if (eClean.length >= 3) {
            if (rShortClean.endsWith(eClean) || rIdClean.endsWith(eClean)) return rId;
        }
        return null;
    };
    
    const scanDb = (db) => {
        if (!db) return null;
        try {
            let stmt = db.prepare(query);
            while(stmt.step()) {
                let row = stmt.getAsObject();
                let match = checkRow(row.route_id, row.route_short_name);
                if (match) { stmt.free(); return match; }
            }
            stmt.free();
        } catch(e) { console.error(e); }
        return null;
    };

    let found = scanDb(idpkDb);
    if (!found && crDb) found = scanDb(crDb);
    if (found) return found;

    let jsonId = getJsonRouteId(shortName) || (exactRouteId ? getJsonRouteId(exactRouteId) : null);
    if (jsonId) return jsonId;

    return null;
}

ipcMain.handle('process-hybrid-file', async (event, fileContent) => {
    try {
        const lines = fileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let targetLinkospoj = ""; let textFileStops = []; let isStopsSection = false;
        for (let line of lines) {
            if (line.toUpperCase().includes('GTFS-DATA')) continue;
            if (line.startsWith('Linkospoj:') || line.startsWith('Linka:')) { targetLinkospoj = line.replace('Linkospoj:', '').replace('Linka:', '').replace(/"/g, '').trim(); } 
            else if (line.startsWith('Zastávky:')) { isStopsSection = true; } 
            else if (isStopsSection) { if (line.includes('|')) textFileStops.push(line); }
        }
        if (!targetLinkospoj || targetLinkospoj.length < 1) return { error: "Chybný formát Linky" };

        let rawRoutePart = targetLinkospoj.includes('/') ? targetLinkospoj.split('/')[0].trim() : targetLinkospoj.trim();
        let spojNum = targetLinkospoj.includes('/') ? targetLinkospoj.split('/')[1].trim().replace(/\D/g, '') : "";
        let jsonMatchId = getJsonRouteId(rawRoutePart);

        let exactRouteId = rawRoutePart;
        if (!jsonMatchId && !rawRoutePart.startsWith('user_') && !rawRoutePart.startsWith('comm_') && !rawRoutePart.includes('_custom')) {
            exactRouteId = rawRoutePart.replace(/\D/g, '');
        }
        
        let customRoutes = getUnlockedCustomRoutes();
        let linkaNum = exactRouteId;
        let forcedRouteId = null;
        
        if (exactRouteId.includes('|')) {
            let parts = exactRouteId.split('|');
            forcedRouteId = parts[2] ? parts[2].trim() : null;
            linkaNum = parts[0].trim();
        } else if (exactRouteId.length >= 5 && !customRoutes.has(exactRouteId) && !jsonMatchId) {
            linkaNum = exactRouteId.slice(-3).replace(/^0+/, ''); 
        } else if (!jsonMatchId) {
            linkaNum = exactRouteId.replace(/^0+/, ''); 
        }

        let isJsonMatch = false;
        let jsonId = jsonMatchId || getJsonRouteId(linkaNum) || getJsonRouteId(exactRouteId);
        let routeId = null;
        let routeName = "";

        if (jsonId) {
            const rawJson = loadRawJsonRoute(jsonId);
            if (rawJson && rawJson.name) routeName = rawJson.name;
            if (rawJson && (rawJson.source === 'gtfs' || rawJson.license || rawJson.gtfs_route_id)) {
                const cand = rawJson.license || rawJson.gtfs_route_id || rawJson.num || linkaNum;
                const foundGId = await findRouteId(rawJson.num || linkaNum, cand);
                if (foundGId && !foundGId.startsWith('user_') && !foundGId.startsWith('comm_')) {
                    routeId = foundGId;
                    linkaNum = cleanLineDisplay(rawJson.num || linkaNum);
                    isJsonMatch = false;
                } else {
                    linkaNum = cleanLineDisplay(rawJson.num || linkaNum);
                    isJsonMatch = true;
                    routeId = jsonId;
                }
            } else {
                linkaNum = cleanLineDisplay(rawJson ? (rawJson.num || linkaNum) : linkaNum);
                isJsonMatch = true;
                routeId = jsonId;
            }
        } else if (forcedRouteId) {
            routeId = forcedRouteId;
        } else {
            routeId = await findRouteId(linkaNum, exactRouteId);
            if (!routeId) {
                if (textFileStops.length > 0) {
                    const parsedStops = textFileStops.map(line => {
                        let parts = line.split('|');
                        let soundPart = parts[0].trim();
                        let audio = soundPart.includes('=') ? soundPart.split('=')[0].trim() : soundPart;
                        let stopName = soundPart.includes('=') ? soundPart.split('=')[1].trim() : soundPart;
                        let display = stopName;
                        let zone = "1";
                        let time = "";
                        let type = "";
                        for (let p of parts) {
                            let pt = p.trim();
                            if (pt.startsWith('Display:')) display = pt.replace('Display:', '').trim();
                            else if (pt.startsWith('Tarifní zona:')) zone = cleanZones(pt.replace('Tarifní zona:', '').trim());
                            else if (pt.startsWith('Čas:')) time = pt.replace('Čas:', '').trim();
                            else if (pt.includes('ZZ') || pt.includes('KZ')) type = 'z';
                        }
                        return { audio, name: display || stopName, zone: cleanZones(zone), time, type };
                    });

                    const customRouteKey = 'custom_' + cleanLineDisplay(linkaNum).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                    const cleanNum = cleanLineDisplay(linkaNum);
                    const start1 = parsedStops[0].name;
                    const start2 = parsedStops[parsedStops.length - 1].name;
                    const isBidirectional = parsedStops.length >= 2 && start1 !== start2;

                    const forwardStops = parsedStops.map((s, idx) => {
                        let t = s.time;
                        if (!t) {
                            let m = idx * 3;
                            let hh = String(6 + Math.floor(m / 60)).padStart(2, '0');
                            let mm = String(m % 60).padStart(2, '0');
                            t = `${hh}:${mm}`;
                        }
                        return { ...s, time: t };
                    });

                    const backwardStops = isBidirectional ? parsedStops.slice().reverse().map((s, idx) => {
                        let m = idx * 3;
                        let hh = String(7 + Math.floor(m / 60)).padStart(2, '0');
                        let mm = String(m % 60).padStart(2, '0');
                        return { ...s, time: `${hh}:${mm}` };
                    }) : [];

                    const trips = [];
                    [1, 3, 5, 7].forEach((sNo, sIdx) => {
                        const startH = 6 + sIdx * 2;
                        const tStops = forwardStops.map((st, idx) => {
                            let m = idx * 3;
                            let hh = String(startH + Math.floor(m / 60)).padStart(2, '0');
                            let mm = String(m % 60).padStart(2, '0');
                            return { ...st, time: `${hh}:${mm}` };
                        });
                        trips.push({
                            tripId: `custom:::${customRouteKey}:::${sNo}`,
                            spojNum: sNo,
                            start: start1,
                            dest: start2,
                            time: tStops[0].time,
                            stops: tStops
                        });
                    });

                    if (isBidirectional) {
                        [2, 4, 6, 8].forEach((sNo, sIdx) => {
                            const startH = 7 + sIdx * 2;
                            const tStops = backwardStops.map((st, idx) => {
                                let m = idx * 3;
                                let hh = String(startH + Math.floor(m / 60)).padStart(2, '0');
                                let mm = String(m % 60).padStart(2, '0');
                                return { ...st, time: `${hh}:${mm}` };
                            });
                            trips.push({
                                tripId: `custom:::${customRouteKey}:::${sNo}`,
                                spojNum: sNo,
                                start: start2,
                                dest: start1,
                                time: tStops[0].time,
                                stops: tStops
                            });
                        });
                    }

                    CUSTOM_ROUTES_CACHE.set(customRouteKey, {
                        routeId: customRouteKey,
                        lineNum: cleanNum,
                        starts: isBidirectional ? [start1, start2] : [start1],
                        destsMap: isBidirectional ? {
                            [start1]: [start2],
                            [start2]: [start1]
                        } : {
                            [start1]: [start1]
                        },
                        trips: trips
                    });

                    if (spojNum) {
                        const sNumInt = parseInt(spojNum, 10) || 1;
                        const matchTrip = trips.find(t => t.spojNum === sNumInt) || trips[0];
                        return {
                            success: true,
                            line: cleanNum,
                            linkospoj: targetLinkospoj,
                            destination: matchTrip.dest,
                            stops: matchTrip.stops
                        };
                    }

                    return {
                        isTemplate: true,
                        lineNum: cleanNum,
                        routeId: customRouteKey,
                        routeName: routeName,
                        stopMap: parseTextFileStopsToMap(textFileStops)
                    };
                }
                return { error: `Linka ${exactRouteId} nenalezena v GTFS` };
            }
        }

        if (!spojNum) return { isTemplate: true, lineNum: cleanLineDisplay(linkaNum), routeId: routeId, routeName: routeName, stopMap: parseTextFileStopsToMap(textFileStops) };

        let tripId = await findTripId(routeId, spojNum);
        if (!tripId) return { error: `Spoj ${spojNum} nenalezen` };

        let gtfsStops = await getGtfsStopsForTrip(tripId);
        if (gtfsStops.length === 0) return { error: `Spoj ${spojNum} nemá data.` };

        let finalStops = mergeStops(gtfsStops, textFileStops);
        return { success: true, line: linkaNum, linkospoj: targetLinkospoj, destination: await getHeadsign(tripId), stops: finalStops };
    } catch (e) { return { error: "Chyba: " + e.message }; }
});

ipcMain.handle('hybrid-get-trip-data', async (event, { tripId, stopMapObj }) => {
    try {
        if (tripId && tripId.startsWith('custom:::')) {
            const parts = tripId.split(':::');
            const customRouteKey = parts[1];
            const spojNum = parseInt(parts[2], 10) || 1;
            const cRoute = CUSTOM_ROUTES_CACHE.get(customRouteKey);
            if (cRoute) {
                const trip = cRoute.trips.find(t => t.spojNum === spojNum) || cRoute.trips[0];
                if (trip) {
                    const finalStops = trip.stops.map(st => {
                        let res = resolveStopAudio(st.name, stopMapObj);
                        return {
                            audio: res ? res.audio : (st.audio || ""),
                            name: formatStopForDisplay(st.name),
                            zone: cleanZones(st.zone || "1"),
                            time: st.time || "",
                            type: st.type || "n"
                        };
                    });
                    return { stops: finalStops, destination: formatStopForDisplay(trip.dest) };
                }
            }
        }
        let gtfsStops = await getGtfsStopsForTrip(tripId); 
        let finalStops = []; 
        const stopMap = stopMapObj;
        for (let gStop of gtfsStops) {
            let res = resolveStopAudio(gStop.name, stopMap);
            let finalName = formatStopForDisplay(gStop.name); 
            let finalZone = gStop.zone; 
            let finalTime = gStop.time; 
            let finalType = gStop.type; 
            let finalAudio = res ? res.audio : (gStop.audio || "");
            if (res && res.lineData) {
                let parts = res.lineData.split('|');
                const checkAndGet = (key) => { let part = parts.find(p => p.trim().startsWith(key)); if (!part) return null; let colonIdx = part.indexOf(':'); if (colonIdx === -1) return null; let val = part.substring(colonIdx + 1).trim(); if (val === "") return null; return val.replace(/"/g, ''); };
                let tName = checkAndGet('Display'); if (tName) finalName = tName;
                let tZone = checkAndGet('Tarifní zona'); if (tZone) finalZone = tZone;
                let tTime = checkAndGet('Čas'); if (tTime) finalTime = tTime;
                let tOthers = checkAndGet('Další znaky'); if (tOthers && (tOthers.includes('ZZ') || tOthers.includes('KZ'))) finalType = 'z';
            }
            finalZone = cleanZones(finalZone); 
            finalStops.push({ audio: finalAudio, name: finalName, zone: finalZone, time: finalTime, type: finalType });
        }
        return { stops: finalStops, destination: await getHeadsign(tripId) };
    } catch(e) { return { error: e.message }; }
});

function mergeStops(gtfsStops, textFileLines) {
    const localStopMap = parseTextFileStopsToMap(textFileLines);
    let finalStops = [];
    for (let i = 0; i < gtfsStops.length; i++) {
        let gStop = gtfsStops[i]; 
        let res = resolveStopAudio(gStop.name, localStopMap);
        let finalName = formatStopForDisplay(gStop.name); 
        let finalZone = gStop.zone; 
        let finalTime = gStop.time; 
        let finalType = gStop.type; 
        let finalAudio = res ? res.audio : (gStop.audio || "");
        if (res && res.lineData) {
            let parts = res.lineData.split('|'); 
            const checkAndGet = (key) => { let part = parts.find(p => p.trim().startsWith(key)); if (!part) return null; let colonIdx = part.indexOf(':'); if (colonIdx === -1) return null; let val = part.substring(colonIdx + 1).trim(); if (val === "") return null; return val.replace(/"/g, ''); };
            let tName = checkAndGet('Display'); if (tName) finalName = tName; 
            let tZone = checkAndGet('Tarifní zona'); if (tZone) finalZone = tZone; 
            let tTime = checkAndGet('Čas'); if (tTime) finalTime = tTime; 
            let tOthers = checkAndGet('Další znaky'); if (tOthers && (tOthers.includes('ZZ') || tOthers.includes('KZ'))) finalType = 'z';
        }
        finalZone = cleanZones(finalZone); 
        finalStops.push({ audio: finalAudio, name: finalName, zone: finalZone, time: finalTime, type: finalType });
    }
    return finalStops;
}

async function findTripId(routeId, cleanSpojNum) {
    if (CUSTOM_ROUTES_CACHE.has(routeId)) {
        return `custom:::${routeId}:::${cleanSpojNum}`;
    }
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) return `json:::${jsonId}:::${cleanSpojNum}`;

    const targets = await getDbTargetsForRoute(routeId);
    let query = "SELECT trip_id FROM trips WHERE route_id = $r";
    let tidList = [];
    
    for (const { db, rIds } of targets) {
        if (!db) continue;
        for (const rid of rIds) {
            try {
                let stmt = db.prepare(query);
                stmt.bind({$r: String(rid).trim()});
                while(stmt.step()) tidList.push(stmt.getAsObject().trip_id);
                stmt.free();
            } catch(e) { log.error(e); }
        }
    }
    
    for (let tid of tidList) {
        if (extractSpojNumber(tid, routeId) === cleanSpojNum) return tid;
    }

    return null;
}

async function getHeadsign(tripId) {
    if (tripId && tripId.startsWith('custom:::')) {
        const parts = tripId.split(':::');
        const customRouteKey = parts[1];
        const spojNum = parseInt(parts[2], 10) || 1;
        const cRoute = CUSTOM_ROUTES_CACHE.get(customRouteKey);
        if (cRoute) {
            const trip = cRoute.trips.find(t => t.spojNum === spojNum) || cRoute.trips[0];
            if (trip) return formatStopForDisplay(trip.dest);
        }
        return "";
    }
    const jsonInfo = parseJsonTripId(tripId);
    if (jsonInfo) {
        const data = loadJsonData(jsonInfo.jsonId);
        const trip = data.find(t => t.spoj === jsonInfo.spojNum);
        return trip ? formatStopForDisplay(trip.smer) : "";
    }
    
    await ensureGtfsCache();
    await ensureCrCache();
    let query = "SELECT CASE WHEN trip_headsign = '' OR trip_headsign IS NULL THEN (SELECT s2.name FROM stop_times st2 JOIN stops s2 ON st2.stop_id = s2.stop_id WHERE st2.trip_id = trips.trip_id AND NOT (st2.pickup_type = '1' AND (st2.arrival_time = '' OR st2.arrival_time IS NULL)) ORDER BY st2.stop_sequence DESC LIMIT 1) ELSE trip_headsign END as headsign FROM trips WHERE trip_id = $t";
    
    const checkDbHeadsign = (db) => {
        if (!db) return null;
        try {
            let stmt = db.prepare(query);
            stmt.bind({$t: tripId.trim()});
            if (stmt.step()) {
                let res = stmt.getAsObject().headsign;
                stmt.free();
                return formatStopForDisplay(res);
            }
            stmt.free();
        } catch(e) { console.error(e); }
        return null;
    };

    let hs = checkDbHeadsign(idpkDb);
    if (!hs && crDb) hs = checkDbHeadsign(crDb);
    return hs || "";
}

// ============================================================
// GTFS SQLITE (sql.js)
// ============================================================
const initSqlJs = require('sql.js');
let idpkDb = null;

let sqlJsPromise = null;
async function getSqlJs() {
    if (global.SQL) return global.SQL;
    if (sqlJsPromise) return sqlJsPromise;
    sqlJsPromise = (async () => {
        global.SQL = await initSqlJs({ locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file) });
        return global.SQL;
    })();
    return sqlJsPromise;
}

let gtfsCachePromise = null;
async function ensureGtfsCache() {
    if (idpkDb) return idpkDb;
    if (gtfsCachePromise) return gtfsCachePromise;
    gtfsCachePromise = (async () => {
        try {
            log.info('[GTFS DB] Načítám IDPK DB do paměti...');
            const SQL = await getSqlJs();
            const dbPath = getDataFilePath('gtfs_stops_idpk.db');
            if (fs.existsSync(dbPath)) {
                const fileBuffer = fs.readFileSync(dbPath);
                idpkDb = new SQL.Database(fileBuffer);
            }
            return idpkDb;
        } finally {
            gtfsCachePromise = null;
        }
    })();
    return gtfsCachePromise;
}

function invalidateGtfsCache() {
    if (idpkDb) { idpkDb.close(); idpkDb = null; }
    if (crDb) { crDb.close(); crDb = null; }
    log.info('[GTFS Cache] DB invalidována.');
}

let crDb = null;
let crCachePromise = null;
function getCrDbPath() {
    let p0 = path.join(PATH_USERDATA, 'data', 'gtfs_stops_cr.db');
    if (fs.existsSync(p0) && fs.statSync(p0).size > 1000000) return p0;
    let p1 = getDataFilePath('gtfs_stops_cr.db');
    if (fs.existsSync(p1) && fs.statSync(p1).size > 1000000) return p1;
    let p2 = getDataFilePath('gtfs_stops_fallback.db');
    if (fs.existsSync(p2) && fs.statSync(p2).size > 1000000) return p2;
    return p0;
}
async function ensureCrCache() {
    if (crDb) return crDb;
    if (crCachePromise) return crCachePromise;
    crCachePromise = (async () => {
        try {
            const dbPath = getCrDbPath();
            if (fs.existsSync(dbPath)) {
                log.info('[GTFS DB] Načítám ČR DB do paměti (' + path.basename(dbPath) + ')...');
                const SQL = await getSqlJs();
                const fileBuffer = fs.readFileSync(dbPath);
                crDb = new SQL.Database(fileBuffer);
            }
            return crDb;
        } catch(e) {
            log.error('[ensureCrCache]', e);
            return null;
        } finally {
            crCachePromise = null;
        }
    })();
    return crCachePromise;
}

async function interpolateMissingTimes(stops) {
    let lastTimeInMins = 0;
    for (let i = 0; i < stops.length; i++) {
        if (stops[i].time) {
            let parts = stops[i].time.split(':');
            lastTimeInMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        } else {
            let nextTimeInMins = null;
            let nextIndex = i;
            for (let j = i + 1; j < stops.length; j++) {
                if (stops[j].time) {
                    let parts = stops[j].time.split(':');
                    nextTimeInMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    nextIndex = j;
                    break;
                }
            }
            if (nextTimeInMins !== null && lastTimeInMins > 0) {
                let diff = nextTimeInMins - lastTimeInMins;
                let steps = nextIndex - i + 1;
                let stepSize = diff / steps;
                let currentMins = Math.round(lastTimeInMins + stepSize);
                lastTimeInMins = currentMins;
                let h = Math.floor(currentMins / 60);
                let m = currentMins % 60;
                stops[i].time = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
            } else {
                lastTimeInMins += 2; // Arbitrary 2 mins if no data
                let h = Math.floor(lastTimeInMins / 60);
                let m = lastTimeInMins % 60;
                stops[i].time = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
            }
        }
    }
}
async function getGtfsStopsForTrip(tripId) {
    if (tripId && tripId.startsWith('custom:::')) {
        const parts = tripId.split(':::');
        const customRouteKey = parts[1];
        const spojNum = parseInt(parts[2], 10) || 1;
        const cRoute = CUSTOM_ROUTES_CACHE.get(customRouteKey);
        if (cRoute) {
            const trip = cRoute.trips.find(t => t.spojNum === spojNum) || cRoute.trips[0];
            if (trip) {
                return trip.stops.map(st => ({
                    name: formatStopForDisplay(st.name),
                    zone: cleanZones(st.zone || "1"),
                    time: st.time || "",
                    type: st.type || "n",
                    seq: 0,
                    isPhoneDemand: false,
                    audio: st.audio || ""
                }));
            }
        }
        return [];
    }

    const jsonInfo = parseJsonTripId(tripId);
    if (jsonInfo) {
        const data = loadJsonData(jsonInfo.jsonId);
        const trip = data.find(t => t.spoj === jsonInfo.spojNum);
        if(trip && Array.isArray(trip.zastavky)) {
            return trip.zastavky.map(z => ({
                name: formatStopForDisplay(z.name || z.n || ""),
                zone: cleanZones(z.zone || z.z || "1"),
                time: z.time || "",
                type: z.type || (z.req ? 'z' : 'n'),
                seq: 0,
                isPhoneDemand: false,
                audio: (z.snd && z.snd.name) ? z.snd.name : (z.audio || "")
            }));
        }
        return [];
    }

    await ensureGtfsCache();
    await ensureCrCache();
    let query = "SELECT st.arrival_time as time, st.pickup_type, s.name, st.stop_sequence as seq, s.zone_id, s.cisjr_id FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $tripId AND NOT (st.pickup_type = '1' AND (st.arrival_time = '' OR st.arrival_time IS NULL)) ORDER BY st.stop_sequence";
    let fallbackQuery = "SELECT st.arrival_time as time, st.pickup_type, s.name, st.stop_sequence as seq, '' as zone_id, '' as cisjr_id FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $tripId AND NOT (st.pickup_type = '1' AND (st.arrival_time = '' OR st.arrival_time IS NULL)) ORDER BY st.stop_sequence";
    let results = [];
    
    let zonesOverride = {};
    try {
        const overridePath = path.join(app.getPath('userData'), 'data', 'zones_override.json');
        if (fs.existsSync(overridePath)) {
            zonesOverride = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
        }
    } catch (e) { log.error("Failed to load zones_override.json: " + e); }
    
    const processRow = (row) => {
        if (row.pickup_type === '1' && (!row.time || row.time.trim() === '')) return;
        let type = (row.pickup_type === '2' || row.pickup_type === '3') ? 'z' : 'n';
        let timeStr = row.time ? row.time.substring(0, 5) : "";
        
        let stopName = formatStopForDisplay(row.name);
        
        let rawZone = row.zone_id || "";
        if (row.cisjr_id && zonesOverride[row.cisjr_id]) {
            rawZone = zonesOverride[row.cisjr_id];
        }
        
        let zonesList = rawZone.split(",").map(z => z.trim().replace(/^P/i, "")).filter(z => z !== "");
        let finalZone = zonesList.join("<br>");
        let isPhoneDemand = (row.pickup_type == 2 || row.pickup_type == 3);
        let resAudio = resolveStopAudio(stopName);
        let finalAudio = resAudio ? resAudio.audio : "";
        results.push({ name: stopName, zone: finalZone, time: timeStr, type: type, seq: row.seq, isPhoneDemand: isPhoneDemand, audio: finalAudio });
    };

    const runStopsQuery = (db) => {
        if (!db) return false;
        let foundAny = false;
        try {
            let stmt = db.prepare(query);
            stmt.bind({$tripId: tripId.trim()});
            while(stmt.step()) {
                processRow(stmt.getAsObject());
                foundAny = true;
            }
            stmt.free();
        } catch(e) { 
            try {
                let stmt = db.prepare(fallbackQuery);
                stmt.bind({$tripId: tripId.trim()});
                while(stmt.step()) {
                    processRow(stmt.getAsObject());
                    foundAny = true;
                }
                stmt.free();
            } catch(e2) {
                console.error("Fallback query also failed:", e2);
            }
        }
        return foundAny;
    };

    let hasStops = runStopsQuery(idpkDb);
    if (!hasStops && crDb) {
        runStopsQuery(crDb);
    }
    
    await interpolateMissingTimes(results);
    return results;
}

ipcMain.on('open-editor', () => {
    let editorWin = new BrowserWindow({
        width: 1000, height: 700, frame: true, title: "Editor vlastních linek",
        webPreferences: { nodeIntegration: true, contextIsolation: false },
        icon: path.join(__dirname, 'icon.ico'),
        backgroundColor: '#0f172a'
    });
    loadWindowFile(editorWin, 'editor.html');
});

ipcMain.handle('editor-get-routes', () => {
    let routes = [];
    const customDataPath = path.join(PATH_USERDATA, 'data');
    if (fs.existsSync(customDataPath)) {
        fs.readdirSync(customDataPath).filter(f => f.endsWith('.json')).forEach(f => {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(customDataPath, f), 'utf8'));
                routes.push({ id: f.replace('.json', ''), data: content });
            } catch(e) {}
        });
    }
    return routes;
});

ipcMain.handle('editor-save-route', (e, id, data) => {
    const customDataPath = path.join(PATH_USERDATA, 'data');
    if (!fs.existsSync(customDataPath)) fs.mkdirSync(customDataPath, { recursive: true });
    fs.writeFileSync(path.join(customDataPath, id + '.json'), JSON.stringify(data, null, 4));
    return true;
});

ipcMain.handle('editor-delete-route', (e, id) => {
    const p = path.join(PATH_USERDATA, 'data', id + '.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
});

ipcMain.handle('editor-export-gtfs', async (e, routeId) => {
    await ensureGtfsCache();
    if (!idpkDb) return { success: false, msg: "Databáze není načtena" };
    
    // Získání spojů pro danou linku z tabulky trips, které jedou dnes
    const dz = idpkDb.prepare("SELECT trip_id FROM trips WHERE route_id = $r LIMIT 1");
    dz.bind({$r: routeId});
    let trip = null;
    if (dz.step()) trip = dz.getAsObject().trip_id;
    dz.free();
    
    if (!trip) return { success: false, msg: "Nebyl nalezen žádný spoj pro export" };
    
    // Získat zastávky spojů
    let stops = [];
    try {
        let stmt = idpkDb.prepare("SELECT st.arrival_time as time, st.pickup_type, s.name, s.zone_id FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $tripId AND NOT (st.pickup_type = '1' AND (st.arrival_time = '' OR st.arrival_time IS NULL)) ORDER BY st.stop_sequence");
        stmt.bind({$tripId: trip});
        while(stmt.step()) {
            let row = stmt.getAsObject();
            let timeStr = row.time ? row.time.substring(0, 5) : "";
            stops.push({
                name: row.name,
                zone: row.zone_id || "",
                time: timeStr,
                na_znameni: (row.pickup_type == 2 || row.pickup_type == 3)
            });
        }
        stmt.free();
    } catch(err) { return { success: false, msg: "Chyba dotazu: " + err.message }; }
    
    const sablona = [{ "spoj": 1, "zastavky": stops }];
    
    const customDataPath = path.join(PATH_USERDATA, 'data');
    if (!fs.existsSync(customDataPath)) fs.mkdirSync(customDataPath, { recursive: true });
    fs.writeFileSync(path.join(customDataPath, routeId + '_export.json'), JSON.stringify(sablona, null, 4));
    
    return { success: true, id: routeId + '_export', msg: "Exportováno jako " + routeId + "_export.json" };
});

ipcMain.handle('gtfs-load-routes', async () => {
    const results = [];
    let customRoutes = getUnlockedCustomRoutes();

    // JSON linky ze složky data (komunitní, vytvořené přes GTFS, ručně nebo AI)
    try {
        let dirsToScan = [path.join(PATH_USERDATA, 'data'), path.join(PATH_EXE, 'data'), path.join(PATH_DEV, 'data')];
        const seenJsonRoutes = new Set();
        const IGNORED = new Set([
            'stop_importance', 'via_priority', 'zones_override',
            'gtfs_version', 'build_info', 'cached_launcher_state', 'config',
            '_sablona_vlastni_linky'
        ]);
        dirsToScan.forEach(dir => {
            if (fs.existsSync(dir)) {
                fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
                    const base = f.replace('.json', '');
                    if (seenJsonRoutes.has(base) || IGNORED.has(base) || base.startsWith('_')) return;
                    seenJsonRoutes.add(base);
                    try {
                        const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                        const lineNum = parsed.num || parsed.line || base;
                        const lineName = parsed.name || (`Linka ${lineNum}`);
                        const author = parsed.author ? parsed.author : 'Uživatel';
                        // Zvýraznění autora a čisté číslo linky (pravidlo #11)
                        results.unshift(`${lineNum} | ${lineName} · LINKA VYTVOŘENA: ${author} | ${base}`);
                    } catch (_) {
                        results.unshift(`${base} | Lokální JSON Linka ${base} | ${base}`);
                    }
                });
            }
        });
    } catch(e) { console.error('[gtfs-load-routes] scan error:', e); }

    await ensureGtfsCache();
    if (idpkDb) {
        try {
            let res = idpkDb.exec("SELECT route_id, route_short_name, route_long_name FROM routes WHERE (route_type = '3' OR route_type = 3)");
            if (res.length > 0) {
                let seenNames = new Set();
                res[0].values.forEach(v => {
                    let routeId = v[0].trim();
                    let routeShortOrig = v[1] ? v[1].trim() : "";
                    let routeLongOrig = v[2] ? v[2].trim() : "";
                    
                    let routeShortClean = cleanStr(routeShortOrig);
                    let routeLongClean = cleanStr(routeLongOrig);
                    
                    let key = `${routeShortClean} | ${routeLongClean}`;
                    if (seenNames.has(key)) return;
                    seenNames.add(key);
                    
                    if (customRoutes.has(routeShortClean) || customRoutes.has(routeId)) {
                        results.push(`${routeShortOrig} | ${routeLongOrig} | ${routeId}`);
                        return;
                    }
                    const num = parseInt(routeShortClean);
                    if (!isNaN(num)) {
                        if (num === 440424 || num === 424) return;
                        const inRange = (num >= 400621 && num <= 405611) ||
                                        (num >= 430432 && num <= 440649) ||
                                        (num >= 450411 && num <= 475211) ||
                                        (num >= 490722 && num <= 496711);
                        if (inRange) results.push(`${routeShortOrig} | ${routeLongOrig} | ${routeId}`);
                    }
                });
            }
        } catch(e) { console.error(e); }
    }
    return [...new Set(results)].sort();
});

ipcMain.handle('gtfs-get-start-stops', async (event, routeId) => {
    if (CUSTOM_ROUTES_CACHE.has(routeId)) {
        return CUSTOM_ROUTES_CACHE.get(routeId).starts;
    }
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) {
        const data = loadJsonData(jsonId);
        const starts = new Set();
        data.forEach(t => { if (t.zastavky && t.zastavky.length > 0) starts.add(t.zastavky[0].name); });
        return Array.from(starts).sort();
    }

    const targets = await getDbTargetsForRoute(routeId);
    let starts = new Set();
    
    for (const { db, rIds } of targets) {
        if (!db || !rIds.length) continue;
        let placeholders = rIds.map(() => '?').join(',');
        let query = `
            SELECT s.name 
            FROM trips t
            JOIN stop_times st ON t.trip_id = st.trip_id
            JOIN stops s ON st.stop_id = s.stop_id
            WHERE t.route_id IN (${placeholders})
            AND NOT (st.pickup_type = '1' AND (st.arrival_time = '' OR st.arrival_time IS NULL))
            AND st.stop_sequence = (
                SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id AND NOT (pickup_type = '1' AND (arrival_time = '' OR arrival_time IS NULL))
            )
        `;
        try {
            let stmt = db.prepare(query);
            stmt.bind(rIds);
            while(stmt.step()) starts.add(shortenStopName(stmt.getAsObject().name));
            stmt.free();
        } catch(e) { console.error('[gtfs-get-start-stops]', e); }
    }
    
    return Array.from(starts).sort();
});

ipcMain.handle('gtfs-get-destinations-from-start', async (event, {routeId, startStopName}) => {
    if (CUSTOM_ROUTES_CACHE.has(routeId)) {
        const cRoute = CUSTOM_ROUTES_CACHE.get(routeId);
        return cRoute.destsMap[startStopName] || cRoute.starts.filter(s => s !== startStopName);
    }
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) {
        const data = loadJsonData(jsonId);
        const dests = new Set();
        data.forEach(t => {
            if (t.zastavky && t.zastavky.length > 0 && (t.zastavky[0].name === startStopName || shortenStopName(t.zastavky[0].name) === startStopName)) {
                dests.add(t.smer);
            }
        });
        return Array.from(dests).sort();
    }

    const targets = await getDbTargetsForRoute(routeId);
    let dests = new Set();
    const canonStart = canonicalizeStopName(startStopName);
    
    for (const { db, rIds } of targets) {
        if (!db || !rIds.length) continue;
        let placeholders = rIds.map(() => '?').join(',');
        let query = `
            SELECT DISTINCT s.name as start_name,
            CASE WHEN t.trip_headsign = '' OR t.trip_headsign IS NULL THEN 
                (SELECT s2.name FROM stop_times st2 JOIN stops s2 ON st2.stop_id = s2.stop_id WHERE st2.trip_id = t.trip_id AND NOT (st2.pickup_type = '1' AND (st2.arrival_time = '' OR st2.arrival_time IS NULL)) ORDER BY st2.stop_sequence DESC LIMIT 1)
            ELSE t.trip_headsign END as trip_headsign
            FROM trips t
            JOIN stop_times st ON t.trip_id = st.trip_id
            JOIN stops s ON st.stop_id = s.stop_id
            WHERE t.route_id IN (${placeholders})
            AND NOT (st.pickup_type = '1' AND (st.arrival_time = '' OR st.arrival_time IS NULL))
            AND st.stop_sequence = (
                SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id AND NOT (pickup_type = '1' AND (arrival_time = '' OR arrival_time IS NULL))
            )
        `;
        try {
            let stmt = db.prepare(query);
            stmt.bind(rIds);
            while(stmt.step()) {
                let row = stmt.getAsObject();
                let dbStart = row.start_name || "";
                let match = (dbStart === startStopName) || 
                            (shortenStopName(dbStart) === startStopName) || 
                            matchCanonicalStops(canonStart, canonicalizeStopName(dbStart));
                if (match && row.trip_headsign) {
                    dests.add(shortenStopName(row.trip_headsign));
                }
            }
            stmt.free();
        } catch(e) { console.error('[gtfs-get-destinations-from-start]', e); }
    }
    
    return Array.from(dests).sort();
});

ipcMain.handle('gtfs-get-final-trips', async (event, {routeId, startStopName, headsign}) => {
    console.log('gtfs-get-final-trips called with:', routeId, startStopName, headsign);
    if (CUSTOM_ROUTES_CACHE.has(routeId)) {
        const cRoute = CUSTOM_ROUTES_CACHE.get(routeId);
        const canonStart = canonicalizeStopName(startStopName);
        const canonHead = canonicalizeStopName(headsign);
        const matched = cRoute.trips.filter(t => {
            const cStart = canonicalizeStopName(t.start);
            const cDest = canonicalizeStopName(t.dest);
            return (t.start === startStopName || shortenStopName(t.start) === shortenStopName(startStopName) || cStart === canonStart) &&
                   (t.dest === headsign || shortenStopName(t.dest) === shortenStopName(headsign) || cDest === canonHead);
        });
        return matched.map(t => ({
            tripId: t.tripId,
            time: t.time,
            formattedName: `${cRoute.lineNum}/${t.spojNum}`,
            spojNum: t.spojNum,
            headsign: t.dest,
            tripNumber: `${cRoute.lineNum}/${t.spojNum}`
        })).sort((a, b) => a.time.localeCompare(b.time));
    }
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) {
        const rawJson = loadRawJsonRoute(jsonId);
        const data = loadJsonData(jsonId);
        const results = [];
        const cleanNum = cleanLineDisplay(rawJson ? (rawJson.num || jsonId) : jsonId);
        data.forEach(t => {
            if (t.smer === headsign && t.zastavky && t.zastavky.length > 0 && (t.zastavky[0].name === startStopName || shortenStopName(t.zastavky[0].name) === startStopName)) {
                const tid = `json:::${jsonId}:::${t.spoj}`;
                const dispCode = `${cleanNum}/${t.spoj}`;
                results.push({
                    tripId: tid,
                    time: t.odjezd,
                    formattedName: dispCode,
                    spojNum: t.spoj,
                    headsign: t.smer,
                    tripNumber: dispCode
                });
            }
        });
        return results.sort((a, b) => a.time.localeCompare(b.time));
    }

    const targets = await getDbTargetsForRoute(routeId);
    let customRoutes = getUnlockedCustomRoutes();
    let rIdStr = routeId.trim();

    let routeShortName = rIdStr;
    for (const { db } of targets) {
        if (!db) continue;
        try {
            let stmt = db.prepare("SELECT route_short_name FROM routes WHERE route_id = ? OR route_short_name = ?");
            stmt.bind([rIdStr, rIdStr]);
            if (stmt.step()) {
                routeShortName = stmt.getAsObject().route_short_name;
                stmt.free();
                break;
            }
            stmt.free();
        } catch(_) {}
    }

    let lineNumber = routeShortName;
    if (!customRoutes.has(rIdStr) && !customRoutes.has(routeShortName)) {
        lineNumber = routeShortName.replace(/\D/g, '').slice(-3) || routeShortName;
    }

    // Today's date in YYYYMMDD format for calendar filtering
    const todayDate = new Date();
    const todayStr = todayDate.getFullYear().toString() +
        (todayDate.getMonth()+1).toString().padStart(2,'0') +
        todayDate.getDate().toString().padStart(2,'0');
    const todayDow = todayDate.getDay(); // 0=Sunday
    const dowMap = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const todayDowCol = dowMap[todayDow];

    const finalResults = [];
    const seenCombos = new Set();
    const canonStart = canonicalizeStopName(startStopName);
    const canonHead = canonicalizeStopName(headsign);

    for (const { db, rIds } of targets) {
        if (!db || !rIds.length) continue;
        let placeholders = rIds.map(() => '?').join(',');
        try {
            let query = `
                SELECT t.trip_id, t.spoj_cislo, t.service_id, st.arrival_time as time,
                cal.start_date, cal.end_date,
                cal.monday, cal.tuesday, cal.wednesday, cal.thursday, cal.friday, cal.saturday, cal.sunday,
                s.name as start_stop,
                (
                    (
                        cal.start_date <= ? AND cal.end_date >= ?
                        AND cal.${todayDowCol} = 1
                        AND t.service_id NOT IN (
                            SELECT service_id FROM calendar_dates WHERE date = ? AND exception_type = 2
                        )
                    )
                    OR
                    t.service_id IN (
                        SELECT service_id FROM calendar_dates WHERE date = ? AND exception_type = 1
                    )
                ) as is_running_today,
                CASE WHEN t.trip_headsign = '' OR t.trip_headsign IS NULL THEN 
                    (SELECT s2.name FROM stop_times st2 JOIN stops s2 ON st2.stop_id = s2.stop_id WHERE st2.trip_id = t.trip_id AND NOT (st2.pickup_type = '1' AND (st2.arrival_time = '' OR st2.arrival_time IS NULL)) ORDER BY st2.stop_sequence DESC LIMIT 1)
                ELSE t.trip_headsign END as headsign
                FROM trips t
                JOIN stop_times st ON t.trip_id = st.trip_id
                JOIN stops s ON st.stop_id = s.stop_id
                LEFT JOIN calendar cal ON t.service_id = cal.service_id
                WHERE t.route_id IN (${placeholders})
                AND NOT (st.pickup_type = '1' AND (st.arrival_time = '' OR st.arrival_time IS NULL))
                AND st.stop_sequence = (
                    SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id AND NOT (pickup_type = '1' AND (arrival_time = '' OR arrival_time IS NULL))
                )
            `;
            let fullBVals = [todayStr, todayStr, todayStr, todayStr, ...rIds];
            let stmt = db.prepare(query);
            stmt.bind(fullBVals);
            while(stmt.step()) {
                let obj = stmt.getAsObject();
                let dbStart = obj.start_stop || "";
                let matchStart = (dbStart === startStopName) || 
                                 (shortenStopName(dbStart) === startStopName) || 
                                 matchCanonicalStops(canonStart, canonicalizeStopName(dbStart));
                if (!matchStart) continue;

                let dbHead = obj.headsign || "";
                let matchHead = (dbHead === headsign) || 
                                (shortenStopName(dbHead) === headsign) || 
                                matchCanonicalStops(canonHead, canonicalizeStopName(dbHead));
                if (!matchHead) continue;

                let tid = obj.trip_id;
                let dbHeadsign = obj.headsign ? obj.headsign : headsign;
                if (seenCombos.has(tid)) continue;
                seenCombos.add(tid);
                let spojNum = obj.spoj_cislo || 0;
                let cleanSpoj = spojNum.toString();
                const formattedName = `${lineNumber}/${cleanSpoj}`;
                let timeStr = obj.time ? obj.time.substring(0, 5) : "";
                const validFrom = obj.start_date ? `${obj.start_date.substring(6,8)}.${obj.start_date.substring(4,6)}.${obj.start_date.substring(0,4)}` : "?";
                const validTo = obj.end_date ? `${obj.end_date.substring(6,8)}.${obj.end_date.substring(4,6)}.${obj.end_date.substring(0,4)}` : "?";
                
                let isInSeason = false;
                if (obj.start_date && obj.end_date && todayStr >= obj.start_date && todayStr <= obj.end_date) {
                    isInSeason = true;
                }
                
                finalResults.push({ 
                    tripId: tid, 
                    time: timeStr, 
                    formattedName, 
                    spojNum, 
                    headsign: cleanStr(shortenStopName(dbHeadsign)), 
                    tripNumber: formattedName, 
                    serviceValidFrom: validFrom, 
                    serviceValidTo: validTo,
                    isInSeason: isInSeason,
                    isRunningToday: (obj.is_running_today == 1),
                    dow: [obj.monday, obj.tuesday, obj.wednesday, obj.thursday, obj.friday, obj.saturday, obj.sunday],
                    rawStartDate: obj.start_date,
                    rawEndDate: obj.end_date
                });
            }
            stmt.free();
        } catch(e) { console.error('processTrips error:', e); }
    }
    
    console.log(`[GTFS] gtfs-get-final-trips: nalezeno ${finalResults.length} spojů pro dnešek (${todayStr})`);
    return finalResults.sort((a, b) => a.time.localeCompare(b.time));
});

ipcMain.handle('gtfs-get-stops', async (event, tripId) => { return getGtfsStopsForTrip(tripId); });

app.whenReady().then(() => { 
    if (app.isPackaged) {
        protocol.interceptFileProtocol('file', (request, callback) => {
            let url = request.url.replace(/^file:\/\//, '');
            if (process.platform === 'win32' && url.startsWith('/')) {
                url = url.substring(1);
            }
            url = decodeURIComponent(url);
            url = url.split('?')[0].split('#')[0]; 
            url = path.normalize(url);

            const externalFolders = ['obraz', 'zvuky', 'data', 'linky'];
            
            for (let folder of externalFolders) {
                let search1 = `\\${folder}\\`;
                let search2 = `/${folder}/`;
                
                let idx = url.indexOf(search1);
                if (idx === -1) idx = url.indexOf(search2);
                
                if (idx !== -1) {
                    let relativePath = url.substring(idx);
                    let externalPath = path.join(path.dirname(process.execPath), relativePath);
                    
                    if (fs.existsSync(externalPath)) {
                        return callback({ path: externalPath });
                    }
                }
            }
            callback({ path: url });
        });
    }
    initExternalFolders(); 
});

async function syncGtfsData() {
    return new Promise((resolve) => {
        log.info("Zahajuji kontrolu aktualizací GTFS dat (SQLite)...");
        const options = {
            hostname: 'api.github.com',
            path: '/repos/marek-1cz/DataCoreBot/releases/latest',
            method: 'GET',
            headers: { 'User-Agent': 'IDPK-Palubni-Pocitac' }
        };

        const dataDir = path.join(PATH_USERDATA, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', async () => {
                if (res.statusCode !== 200) {
                    log.error("Nepodařilo se ověřit GTFS data na GitHubu: " + res.statusCode);
                    return resolve();
                }
                try {
                    const release = JSON.parse(data);
                    
                    // Extrakce hashe z body
                    const bodyText = release.body || "";
                    const hashMatch = bodyText.match(/Hash:.*?([a-f0-9]{40,})/i);
                    const latestHash = hashMatch ? hashMatch[1] : null;
                    
                    const validityMatch = bodyText.match(/Platnost dat:\s*(.*)/i);
                    const gtfsValidity = validityMatch ? validityMatch[1].trim() : "";

                    if (!latestHash) {
                        log.error("Nenalezen Hash v popisu releasu.");
                        return resolve();
                    }

                    const versionFile = path.join(dataDir, 'gtfs_version.json');
                    const dbFileIdpk = path.join(dataDir, 'gtfs_stops_idpk.db');
                    
                    let currentHash = "";
                    let currentValidity = "";
                    if (fs.existsSync(versionFile)) {
                        try {
                            const verData = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
                            currentHash = verData.hash;
                            currentValidity = verData.validity || "";
                        } catch(e) { console.error(e); }
                    }

                    if (currentHash === latestHash && fs.existsSync(dbFileIdpk)) {
                        log.info("GTFS DB je aktuální (Hash: " + currentHash + ")");
                        if (controllerWindow) controllerWindow.webContents.send('gtfs-update-status', { status: 'ok', validity: currentValidity || gtfsValidity });
                        return resolve();
                    }

                    const assetIdpk = release.assets.find(a => a.name === 'gtfs_stops_idpk.db');
                    if (!assetIdpk) {
                        log.error("V releasu chybí asset gtfs_stops_idpk.db");
                        return resolve();
                    }

                    log.info("Nalezena nová verze GTFS DB. Stahuji z GitHubu...");
                    if (controllerWindow) controllerWindow.webContents.send('gtfs-update-status', { status: 'downloading' });
                    
                    const downloadAsset = (asset, destFile) => {
                        return new Promise((dlResolve, dlReject) => {
                            const downloadOptions = {
                                hostname: 'api.github.com',
                                path: '/repos/marek-1cz/DataCoreBot/releases/assets/' + asset.id,
                                method: 'GET',
                                headers: { 
                                    'User-Agent': 'IDPK-Palubni-Pocitac',
                                    'Accept': 'application/octet-stream'
                                }
                            };

                            const handleDownload = (resDl) => {
                                if (resDl.statusCode === 301 || resDl.statusCode === 302) {
                                    https.get(resDl.headers.location, handleDownload).on('error', dlReject);
                                    return;
                                }
                                if (resDl.statusCode !== 200) {
                                    return dlReject(new Error("HTTP status " + resDl.statusCode));
                                }
                                
                                const file = fs.createWriteStream(destFile);
                                resDl.pipe(file);
                                file.on('finish', () => {
                                    file.close();
                                    dlResolve();
                                });
                            };
                            https.get(downloadOptions, handleDownload).on('error', dlReject);
                        });
                    };

                    try {
                        await downloadAsset(assetIdpk, dbFileIdpk);
                        fs.writeFileSync(versionFile, JSON.stringify({ hash: latestHash, validity: gtfsValidity }));
                        log.info("GTFS DB úspěšně aktualizována.");
                        invalidateGtfsCache();
                        if (controllerWindow) controllerWindow.webContents.send('gtfs-update-status', { status: 'done', validity: gtfsValidity });
                        resolve();
                    } catch (err) {
                        log.error("Chyba při stahování DB: " + err.message);
                        if (!fs.existsSync(dbFileIdpk)) {
                            log.error("Lokální kopie DB neexistuje!");
                        }
                        if (controllerWindow) controllerWindow.webContents.send('gtfs-update-status', { status: 'error' });
                        resolve();
                    }
                } catch (e) {
                    log.error("Chyba při zpracování verze z GitHubu: " + e.message);
                    resolve();
                }
            });
        });
        
        req.on('error', (e) => {
            log.error("Chyba spojení s GitHubem: " + e.message);
            const dbFileIdpk = path.join(dataDir, 'gtfs_stops_idpk.db');
            if (!fs.existsSync(dbFileIdpk)) {
                log.error("Lokální kopie GTFS DB chybí — aplikace nemusí fungovat správně!");
            } else {
                log.info("Bude použita poslední lokální kopie GTFS DB.");
            }
            resolve();
        });
        req.end();
    });
}

const { autoUpdater } = require('electron-updater');

// Setup AutoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
    log.info('Aktualizace nalezena: ' + info.version);
    // Pokud máme zobrazený launcher, můžeme mu to poslat
    // V budoucnu můžeme do launcher.html přidat naslouchátko na 'update-available'
});
autoUpdater.on('update-downloaded', (info) => {
    log.info('Aktualizace stažena, připravuji instalaci při ukončení aplikace.');
    // Můžeme natvrdo aplikaci zavřít a nainstalovat, ale autoInstallOnAppQuit=true to udělá při zavření Launcheru uživatelem.
});
autoUpdater.on('error', (err) => {
    log.error('Chyba AutoUpdateru: ' + err);
});

app.on('ready', async () => {
    // Check for updates
    try {
        if (app.isPackaged) {
            autoUpdater.checkForUpdatesAndNotify();
        }
    } catch(e) {
        log.error("Chyba při kontrole aktualizací:", e);
    }
    if (process.argv.includes('--no-launcher')) {
        let allowGame = false;
        try {
            const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
            const configPath = path.join(userDataPath, 'config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                let id_param = config.discord_id;
                if (!id_param && config.email) id_param = 'email-' + config.email;
                if (id_param) {
                    const response = await fetch(`https://datacorebot.koyeb.app/api/launcher/versions?discord_id=${id_param}`);
                    const data = await response.json();
                    
                    if (data.status !== 'banned' && data.status !== 'error' && data.versions) {
                        const myVer = "V" + app.getVersion();
                        const targetVer = data.versions.find(v => v.db_version === myVer || v.version_name === myVer || myVer.startsWith(v.db_version) || (config.last_version && v.db_version === config.last_version));
                        if (targetVer && targetVer.has_access && targetVer.can_launch) {
                            allowGame = true;
                        } else {
                            console.log(`Security check failed: No access or can_launch is false for version ${myVer}`);
                            allowGame = false;
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Security check failed:", err);
        }

        if (allowGame) {
            createController();
            await syncGtfsData();
        } else {
            // Pokud je ban nebo chyba, spadneme do Launcheru, který ukáže červenou BAN obrazovku
            createLauncher();
        }
    } else {
        const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
        const configPath = path.join(userDataPath, 'config.json');
        let autoLaunched = false;

        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                } catch (e) { console.error("Chyba při čtení config.json", e); }
        }
        
        if (!autoLaunched) {
            createLauncher();
        }
    }
});

let launcherWindow;
function createLauncher() {
    launcherWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        useContentSize: true,
        center: true,
        resizable: false,
        maximizable: false,
        frame: false,
        title: "Lancher OIS IDPK",
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false, autoplayPolicy: 'no-user-gesture-required' },
        icon: path.join(__dirname, 'icon.ico'),
        backgroundColor: '#080d1a'
    });
    loadWindowFile(launcherWindow, 'launcher.html');

    launcherWindow.on('closed', () => { app.quit(); });
}

ipcMain.on('window-minimize', () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.minimize();
    }
});
ipcMain.on('window-close', () => {
    app.quit();
});
ipcMain.on('open-custom-routes-folder', () => {
    const crPath = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'userdata', 'data');
    if (!fs.existsSync(crPath)) fs.mkdirSync(crPath, { recursive: true });
    require('electron').shell.openPath(crPath);
});
ipcMain.handle('gtfs-editor-get-all-stops', async () => {
    try {
        await ensureGtfsCache();
        if (idpkDb) {
            const res = idpkDb.exec("SELECT DISTINCT name, zone_id FROM stops WHERE name IS NOT NULL AND name != ''");
            if (res.length > 0 && res[0].values) {
                return res[0].values.map(v => ({ n: v[0], z: v[1] || '' }));
            }
        }
    } catch(e) { console.error('[gtfs-editor-get-all-stops]', e); }
    return [];
});
ipcMain.handle('gtfs-check-cr', async () => {
    try {
        const dbPath = getCrDbPath();
        return fs.existsSync(dbPath) && fs.statSync(dbPath).size > 1000000;
    } catch(e) {
        return false;
    }
});

ipcMain.handle('gtfs-download-cr', async () => {
    try {
        log.info('[GTFS ČR] Stahování databáze celé ČR (fallback DB z ověřeného zdroje CIS JŘ)...');
        const options = {
            hostname: 'api.github.com',
            path: '/repos/marek-1cz/DataCoreBot/releases/latest',
            method: 'GET',
            headers: { 'User-Agent': 'IDPK-Palubni-Pocitac' }
        };

        const release = await new Promise((res, rej) => {
            https.get(options, (resp) => {
                let d = '';
                resp.on('data', chunk => d += chunk);
                resp.on('end', () => {
                    if (resp.statusCode === 200) {
                        try { res(JSON.parse(d)); } catch(e) { rej(e); }
                    } else {
                        rej(new Error('GitHub HTTP ' + resp.statusCode));
                    }
                });
            }).on('error', rej);
        });

        const asset = (release.assets || []).find(a => a.name === 'gtfs_stops_fallback.db');
        if (!asset) {
            throw new Error('V releasu nebyl nalezen asset gtfs_stops_fallback.db');
        }

        const dataDir = path.join(PATH_USERDATA, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const destFile = path.join(dataDir, 'gtfs_stops_cr.db');
        const tempFile = path.join(dataDir, 'gtfs_stops_cr.db.tmp');
        const totalSize = asset.size || 0;
        let downloaded = 0;

        await new Promise((dlResolve, dlReject) => {
            const dlOptions = {
                hostname: 'api.github.com',
                path: '/repos/marek-1cz/DataCoreBot/releases/assets/' + asset.id,
                method: 'GET',
                headers: {
                    'User-Agent': 'IDPK-Palubni-Pocitac',
                    'Accept': 'application/octet-stream'
                }
            };

            const handleDl = (resDl) => {
                if (resDl.statusCode === 301 || resDl.statusCode === 302) {
                    https.get(resDl.headers.location, handleDl).on('error', dlReject);
                    return;
                }
                if (resDl.statusCode !== 200) {
                    return dlReject(new Error('HTTP ' + resDl.statusCode));
                }
                const file = fs.createWriteStream(tempFile);
                resDl.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (totalSize > 0 && launcherWindow && !launcherWindow.isDestroyed()) {
                        const pct = Math.min(99, Math.round((downloaded / totalSize) * 100));
                        launcherWindow.webContents.send('gtfs-cr-progress', {
                            percent: pct,
                            text: `Stahování GTFS ČR (${(downloaded / (1024*1024)).toFixed(1)} MB / ${(totalSize / (1024*1024)).toFixed(1)} MB)…`
                        });
                    }
                });
                resDl.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        try {
                            if (fs.existsSync(destFile)) fs.unlinkSync(destFile);
                            fs.renameSync(tempFile, destFile);
                            dlResolve();
                        } catch(e) { dlReject(e); }
                    });
                });
            };
            https.get(dlOptions, handleDl).on('error', dlReject);
        });

        invalidateGtfsCache();
        await ensureCrCache();
        log.info('[GTFS ČR] Stahování a inicializace databáze ČR dokončena.');
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send('gtfs-cr-progress', { percent: 100, text: 'Hotovo! GTFS ČR načteno.' });
        }
        return { success: true };
    } catch(err) {
        log.error('[GTFS ČR] Selhání stahování:', err);
        return { success: false, error: err.message };
    }
});

function getBuiltinLineNumbers() {
    const builtin = new Set();
    const dirs = [
        path.join(PATH_EXE, 'linky'),
        path.join(PATH_DEV, 'linky'),
        path.join(process.resourcesPath, 'linky'),
        path.join(__dirname, 'linky')
    ];
    for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        try {
            const files = fs.readdirSync(d);
            for (const f of files) {
                if (!f.endsWith('.txt')) continue;
                if (f.includes('_custom') || f.startsWith('comm_')) continue;
                const match = f.match(/^([0-9a-zA-Z]+)(?:_auto)?(?:\.txt)?$/i);
                if (match && match[1]) {
                    builtin.add(match[1].toLowerCase());
                }
            }
        } catch(e) {}
    }
    return builtin;
}

ipcMain.handle('gtfs-editor-search', async (event, query) => {
    try {
        await ensureGtfsCache();
        await ensureCrCache();
        if (!query) return [];
        const qClean = cleanStr(String(query).trim());
        const builtinLines = getBuiltinLineNumbers();

        const searchInDb = (dbInstance, scopeName) => {
            if (!dbInstance) return [];
            try {
                let stmt = dbInstance.prepare("SELECT route_id, route_short_name, route_long_name FROM routes WHERE (route_type = '3' OR route_type = 3) AND (route_short_name LIKE $q OR route_long_name LIKE $q OR route_id LIKE $q) LIMIT 80");
                stmt.bind({ $q: `%${qClean}%` });
                let routes = [];
                while (stmt.step()) {
                    routes.push(stmt.getAsObject());
                }
                stmt.free();

                let results = [];
                let routesByKey = new Map();

                for (let r of routes) {
                    let rawShort = cleanStr(r.route_short_name);
                    let rawId = cleanStr(r.route_id);
                    let num = rawShort;
                    let license = rawShort.length >= 5 ? rawShort : (rawId.length >= 5 ? rawId : '');
                    if (num.length >= 5) {
                        num = num.slice(-3).replace(/^0+/, '') || num;
                    }

                    let dedupKey = `${num}_${license}`;
                    if (!routesByKey.has(dedupKey)) {
                        routesByKey.set(dedupKey, { num, license, name: cleanStr(r.route_long_name) || `Linka ${num}`, routeIds: [] });
                    }
                    routesByKey.get(dedupKey).routeIds.push(r.route_id);
                }

                for (let [dedupKey, group] of routesByKey) {
                    let bestTripId = null;
                    let maxStopCount = 0;
                    let bestRouteId = group.routeIds[0];

                    for (let rId of group.routeIds) {
                        try {
                            let tStmt = dbInstance.prepare("SELECT t.trip_id, COUNT(st.stop_sequence) as cnt FROM trips t JOIN stop_times st ON t.trip_id = st.trip_id WHERE t.route_id = $r GROUP BY t.trip_id ORDER BY cnt DESC LIMIT 1");
                            tStmt.bind({ $r: rId });
                            if (tStmt.step()) {
                                let row = tStmt.getAsObject();
                                if (row.cnt > maxStopCount) {
                                    maxStopCount = row.cnt;
                                    bestTripId = row.trip_id;
                                    bestRouteId = rId;
                                }
                            }
                            tStmt.free();
                        } catch (_) {}
                    }

                    let tripStops = [];
                    if (bestTripId) {
                        try {
                            let sStmt = dbInstance.prepare("SELECT s.name, COALESCE(s.zone_id, '') as zone_id, CASE WHEN st.pickup_type = '3' THEN 1 ELSE 0 END as req FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $t ORDER BY st.stop_sequence ASC");
                            sStmt.bind({ $t: bestTripId });
                            while (sStmt.step()) {
                                let row = sStmt.getAsObject();
                                let rawZone = cleanStr(row.zone_id);
                                let zClean = rawZone.split(/[,;]+/).map(z => z.trim().replace(/^P/i, '')).filter(z => z.length > 0).join(',');
                                tripStops.push([cleanStr(row.name), zClean, row.req ? 1 : 0]);
                            }
                            sStmt.free();
                        } catch (_) {}
                    }

                    if (tripStops.length > 0) {
                        const isBuiltin = builtinLines.has(group.num.toLowerCase()) || (group.license && builtinLines.has(group.license.toLowerCase()));
                        results.push({
                            num: group.num,
                            license: group.license,
                            gtfs_route_id: bestRouteId,
                            routeIds: group.routeIds,
                            name: group.name,
                            from: tripStops[0][0],
                            to: tripStops[tripStops.length - 1][0],
                            stops: tripStops,
                            scope: scopeName,
                            dir: 0,
                            alreadyExists: Boolean(isBuiltin)
                        });
                    }
                }

                // Inteligentní řazení: přesná shoda čísla nahoře, pak začínající na q, pak zbytek
                results.sort((a, b) => {
                    const qLow = qClean.toLowerCase();
                    const aExact = a.num.toLowerCase() === qLow || (a.license && a.license.toLowerCase() === qLow);
                    const bExact = b.num.toLowerCase() === qLow || (b.license && b.license.toLowerCase() === qLow);
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;

                    const aEnds = a.num.toLowerCase().endsWith(qLow) || (a.license && a.license.toLowerCase().endsWith(qLow));
                    const bEnds = b.num.toLowerCase().endsWith(qLow) || (b.license && b.license.toLowerCase().endsWith(qLow));
                    if (aEnds && !bEnds) return -1;
                    if (!aEnds && bEnds) return 1;

                    const aStarts = a.num.toLowerCase().startsWith(qLow) || (a.license && a.license.toLowerCase().startsWith(qLow));
                    const bStarts = b.num.toLowerCase().startsWith(qLow) || (b.license && b.license.toLowerCase().startsWith(qLow));
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;

                    return a.num.localeCompare(b.num, undefined, { numeric: true });
                });

                return results;
            } catch(e) {
                console.error(`[gtfs-editor-search][${scopeName}]`, e);
                return [];
            }
        };

        const idpkResults = searchInDb(idpkDb, 'idpk');
        const crResults = searchInDb(crDb, 'cr');
        return [...idpkResults, ...crResults];
    } catch(e) {
        console.error('[gtfs-editor-search]', e);
        return [];
    }
});

let isLaunchingDevBuild = false;
ipcMain.on('launch-dev-build', async () => {
    if (isLaunchingDevBuild) return;
    isLaunchingDevBuild = true;
    try {
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.removeAllListeners('closed');
        }
        await syncGtfsData();
        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.close();
            launcherWindow = null;
        }
        if (!controllerWindow || controllerWindow.isDestroyed()) {
            createController();
        }
    } finally {
        setTimeout(() => { isLaunchingDevBuild = false; }, 3000);
    }
});

function getHWIDForUpdater() {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            exec('wmic csproduct get uuid', (err, stdout) => {
                if (err) resolve("UNKNOWN-HWID-UPDATER-" + Math.random().toString(36).substr(2, 9));
                else {
                    let lines = stdout.split('\n');
                    if (lines.length > 1) resolve(lines[1].trim());
                    else resolve("UNKNOWN-HWID-UPDATER-" + Math.random().toString(36).substr(2, 9));
                }
            });
        } else resolve("NOT-WINDOWS-" + Math.random().toString(36).substr(2, 9));
    });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let sseClients = [];

const server = http.createServer((req, res) => {
    
    if (req.url.startsWith('/client-state/')) {
        const state = req.url.split('/')[2];
        if (controllerWindow) {
            controllerWindow.webContents.send('update-client-state', state);
            if (state === 'active') {
                controllerWindow.webContents.send('force-sync-dom');
            }
        }
        res.writeHead(200); res.end('OK');
        return;
    }

    if (req.url === '/') {
        let htmlPath = getUniversalPath('', 'ovladac.html') || path.join(__dirname, 'ovladac.html');
        let cssContent = "";
        if (fs.existsSync(htmlPath)) {
            let htmlContent = fs.readFileSync(htmlPath, 'utf8');
            let styleMatch = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            if (styleMatch) { cssContent += "\n" + styleMatch[1]; }
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.end(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <title>IDPK Mobilní Zrcadlo</title>
    <style>
        ${cssContent}
        
        #mobile-conn-dot { display: none !important; }
        
        body { 
            margin: 0; padding: 0; 
            background-color: var(--idpk-blue); 
            font-family: sans-serif; 
            height: 100dvh;
            width: 100vw;
            display: flex; flex-direction: column; 
            overflow: hidden;
            position: relative;
        }

        #m-status { 
            position: fixed; top: 0; left: 0; width: 100%; 
            color: white; text-align: center; font-size: 11px; font-weight: bold; 
            padding: 4px; z-index: 9999999; text-transform: uppercase; 
            display: flex; justify-content: center; align-items: center; gap: 8px;
            backdrop-filter: blur(4px); pointer-events: none;
            box-sizing: border-box;
        }
        .st-yellow { background: rgba(241, 196, 15, 0.8); color: black !important; }
        .st-green { background: rgba(46, 204, 113, 0.8); }
        .st-orange { background: rgba(230, 126, 34, 0.8); }
        
        .loader {
            display: inline-block; box-sizing: border-box;
            border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid white;
            border-radius: 50%; width: 12px; height: 12px; animation: spin 1s linear infinite;
        }
        .loader-dark { border-top: 2px solid black; border-color: rgba(0,0,0,0.3); }
        .static-dot {
            display: inline-block; box-sizing: border-box;
            width: 10px; height: 10px; border-radius: 50%; background-color: #27ae60; border: 1px solid white;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        #mirror-container {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            box-sizing: border-box;
            padding-top: 22px; 
        }
    </style>
    
    <script>
        let sse;
        
        function updateStatusUI(type) {
            let el = document.getElementById('m-status');
            if(!el) {
                el = document.createElement('div');
                el.id = 'm-status';
                document.body.appendChild(el);
            }
            if(type === 'conn') {
                el.className = 'st-yellow';
                el.innerHTML = '<div class="loader loader-dark"></div><span>PŘIPOJOVÁNÍ...</span>';
            } else if(type === 'ok') {
                el.className = 'st-green';
                el.innerHTML = '<div class="static-dot"></div><span>PŘIPOJENO K PC</span>';
            } else if(type === 're') {
                el.className = 'st-orange';
                el.innerHTML = '<div class="loader"></div><span>OBNOVA PŘIPOJENÍ...</span>';
            }
        }

        function connectSSE() {
            sse = new EventSource('/events');
            sse.onopen = () => { updateStatusUI('ok'); fetch('/client-state/active'); };
            sse.onerror = () => { updateStatusUI('re'); sse.close(); setTimeout(connectSSE, 2000); };
            
            sse.onmessage = function(event) {
                if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
                
                document.getElementById('mirror-container').innerHTML = JSON.parse(event.data);
                updateStatusUI(sse.readyState === EventSource.OPEN ? 'ok' : 're');
                
                document.querySelectorAll('[data-scroll]').forEach(el => {
                    el.scrollTop = el.getAttribute('data-scroll');
                });

                if(window.lastSliderVal !== undefined) { let s = document.getElementById('delay-slider'); if(s) s.value = window.lastSliderVal; }
                if(window.lastTimeVal !== undefined) { let t = document.getElementById('fictional-time-input'); if(t) t.value = window.lastTimeVal; }
            };
        }

        window.onload = () => {
            updateStatusUI('conn');
            connectSSE();
        };

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                fetch('/client-state/standby');
            } else {
                updateStatusUI('re');
                fetch('/client-state/active');
            }
        });

        document.addEventListener('input', function(e) {
            if(e.target.id === 'fictional-time-input') window.lastTimeVal = e.target.value;
            if(e.target.id === 'delay-slider') window.lastSliderVal = e.target.value;
        });

        const commands = ['pressKey','deleteChar','moveArrow','confirmSelection','handleEnterOrStop','smartButtonAction','handleLeftButton','handleTerminate','toggleSettings','backToLogin','manualResetStop','fullReset','toggleListMouse','switchToIdpkMode','backToManual','backToIdpkList','openFunkMenu','closeFunkMenu','toggleDelayMode','toggleRandomContinue','toggleTimeAuto','toggleDelayAuto','toggleAutoAnnounce','manualContinueTrip','autoStartRandomTrip','setFocus','selectListItem','selectStartStop','selectDestination','finalizeTripSelection','backToManualWithLoad','backToIdpkMode','reloadStartStops','closeErrorModal','forceEndRide', 'openStopWindow', 'softReset', 'submitPinNumber'];
        
        commands.forEach(cmd => {
            window[cmd] = function(...args) {
                let data = cmd;
                if (args.length > 0) data += ":::" + args.join(":::");
                fetch('/action/' + encodeURIComponent(data));
                if (navigator.vibrate) navigator.vibrate(30);
            }
        });

        window.updateDelayDisplay = function() {
            let val = document.getElementById('delay-slider').value;
            window.lastSliderVal = val;
            document.getElementById('delay-val').textContent = val + "s";
            fetch('/action/updateDelayDisplay:::' + val);
        }

        window.setFictionalTime = function() {
            let val = document.getElementById('fictional-time-input').value;
            window.lastTimeVal = val;
            fetch('/action/setFictionalTime:::' + val);
        }
    </script>
</head>
<body>
    <div id="m-status"></div>
    <div id="mirror-container">
        <div style="display: flex; justify-content: center; align-items: center; height: 100%; color: white;">
            NAČÍTÁNÍ ZRCADLA...
        </div>
    </div>
</body>
</html>`);
    } else if (req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        sseClients.push(res);
        
        if (controllerWindow) {
            controllerWindow.webContents.send('update-client-state', 'active'); 
            controllerWindow.webContents.send('force-sync-dom'); 
        }
        
        req.on('close', () => { 
            sseClients = sseClients.filter(c => c !== res); 
            if(sseClients.length === 0 && controllerWindow) {
                controllerWindow.webContents.send('update-client-state', 'disconnected'); 
            }
        });
    } else if (req.url.startsWith('/action/')) {
        const actionStr = decodeURIComponent(req.url.split('/')[2]);
        if (controllerWindow) controllerWindow.webContents.send('mobile-action', actionStr);
        res.writeHead(200); res.end('OK');
    } else {
        res.writeHead(404); res.end();
    }
});

if (process.argv.includes('--no-launcher')) {
    server.listen(5000, '0.0.0.0', () => { console.log("Mobilní server běží na portu 5000"); });
}

ipcMain.on('sync-dom', (event, html) => {
    sseClients.forEach(client => {
        try { client.write(`data: ${JSON.stringify(html)}\n\n`); } catch(e) { console.error(e); }
    });
});

ipcMain.handle('get-gtfs-version', async () => {
    try {
        // Prefer data/ folder (new system with hash+validity)
        let dataDir = path.join(PATH_USERDATA, 'data');
        const versionFileNew = path.join(dataDir, 'gtfs_version.json');
        if (fs.existsSync(versionFileNew)) {
            const d = JSON.parse(fs.readFileSync(versionFileNew, 'utf-8'));
            if (d.validity) {
                const stat = fs.statSync(versionFileNew);
                const dDate = new Date(stat.mtime);
                const dateStr = dDate.getDate().toString().padStart(2, '0') + "." + (dDate.getMonth() + 1).toString().padStart(2, '0') + "." + dDate.getFullYear() + " " + dDate.getHours().toString().padStart(2, '0') + ":" + dDate.getMinutes().toString().padStart(2, '0');
                return `Staženo ${dateStr} (Spoje: ${d.validity})`;
            }
        }
        // Fallback: old AppData system
        const versionFile = path.join(app.getPath('userData'), 'gtfs_version.json');
        if (fs.existsSync(versionFile)) {
            return JSON.parse(fs.readFileSync(versionFile, 'utf-8')).version || "Neznámá verze";
        }
    } catch(e) { console.error(e); }
    return "Neznámá verze";
});

ipcMain.handle('get-gtfs-validity', async () => {
    try {
        let dataDir = path.join(app.getPath('userData'), 'data');
        const versionFile = path.join(dataDir, 'gtfs_version.json');
        if (fs.existsSync(versionFile)) {
            const verData = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
            return verData.validity || "";
        }
    } catch(e) { console.error(e); }
    return "";
});
ipcMain.on('force-buse-window-fix', () => {
    if (buseWindow && !buseWindow.isDestroyed()) {
        buseWindow.setResizable(true);
        buseWindow.setSize(1400, 380);
        buseWindow.setTitle('BUSE_PANEL_FIX');
    }
});
