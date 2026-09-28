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
    if (!stopName) return stopName;
    stopName = stopName.replace(/autobusov[aá]\s+stanice/gi, "aut. st.");
    stopName = stopName.replace(/autobusov[eé]\s+n[aá]dra[zž][ií]/gi, "aut. nádr.");
    stopName = stopName.replace(/[zž]elezni[cč]n[ií]\s+stanice/gi, "žel. st.");
    stopName = stopName.replace(/\brestaurace\b/gi, "rest.");
    stopName = stopName.replace(/\brozcest[ií]\b/gi, "rozc.");
    stopName = stopName.replace(/\bpr[uů]myslov[aá]\s+z[oó]na\b/gi, "prům. zóna");
    stopName = stopName.replace(/\bn[aá]m[eě]st[ií]\b/gi, "nám.");
    stopName = stopName.replace(/\bnemocnice\b/gi, "nem.");
    stopName = stopName.replace(/\bz[aá]vod\b/gi, "záv.");
    return stopName;
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
    let numStr = cleanStr(shortName).replace(/\D/g, '').replace(/^0+/, '');
    if (numStr) {
        let p1 = getUniversalPath('data', `${numStr}.json`);
        if (p1 && fs.existsSync(p1)) return numStr;
    }
    let p2 = getUniversalPath('data', `${shortName}.json`);
    if (p2 && fs.existsSync(p2)) return shortName;
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
        width: 600, height: 400, title: "Diagnostický Log OIS IDPK V1.6.2", autoHideMenuBar: true,
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
        width: 380, height: 750, resizable: false, autoHideMenuBar: true, title: "OIS IDPK V1.6.2",
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
ipcMain.on('quit-app', () => { app.quit(); });
ipcMain.on('relaunch-app', () => { app.relaunch(); app.exit(); });
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
    const udPath = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'userdata');
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
                let stmt = idpkDb.prepare('SELECT route_short_name, route_long_name FROM routes');
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
        processDir(path.join(PATH_EXE, 'linky'));
        processDir(path.join(PATH_DEV, 'linky'));
        processDir(path.join(process.resourcesPath, 'linky'));
        return Array.from(files).sort();
    } catch (error) { return []; }
});

ipcMain.handle('read-route-file', async (event, filename) => {
    let cleanName = filename.split('|')[0].toLowerCase().replace('.txt', '').replace(/[\r\n]+/g, '').trim();
    let p = getUniversalPath('linky', `${cleanName}.txt`); if (p) return fs.readFileSync(p, 'utf-8');
    let pAuto = getUniversalPath('linky', `${cleanName}_auto.txt`); if (pAuto) return fs.readFileSync(pAuto, 'utf-8');
    let pOde = getUniversalPath('linky', `${cleanName}_ode.txt`); if (pOde) return fs.readFileSync(pOde, 'utf-8');
    let pBeta = getUniversalPath('linky', `${cleanName}_auto-beta.txt`); if (pBeta) return fs.readFileSync(pBeta, 'utf-8');
    return null;
});

function cleanZones(zoneStr) { if (!zoneStr) return ""; let parts = zoneStr.split(/[ ,;]+/).filter(x => x.trim().length > 0); return [...new Set(parts)].join('<br>'); }

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

function normalizeName(str) { 
    let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); 
    s = s.replace(/\bhaj\./g, "hajenka").replace(/\bhajovna\b/g, "hajenka").replace(/\bhaj\b/g, "hajenka"); 
    return s.replace(/[^a-z0-9]/g, ""); 
}
function parseTextFileStopsToMap(lines) { let map = {}; for(let line of lines) { if(line.includes('=')) { let parts = line.split('='); map[normalizeName(parts[0].trim())] = parts[1].trim(); } } return map; }
function findBestMatch(normGtfs, stopMap) { 
    if (stopMap[normGtfs]) return stopMap[normGtfs]; 
    let best = null; 
    let maxLen = 0; 
    for (const txtKey in stopMap) { 
        if (normGtfs.includes(txtKey) || txtKey.includes(normGtfs)) { 
            if (txtKey.length > maxLen) { 
                best = stopMap[txtKey]; 
                maxLen = txtKey.length; 
            } 
        } 
    } 
    return best; 
}

function loadJsonData(jsonId) { try { let p = getUniversalPath('data', `${jsonId}.json`); if (p) { const content = fs.readFileSync(p, 'utf-8'); return JSON.parse(content); } } catch(e) { console.error(e); } return []; }

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

function getRouteIdsForShortName(routeId, db) {
    if (!db) return [routeId];
    try {
        let stmt1 = db.prepare("SELECT route_short_name FROM routes WHERE route_id = ?");
        stmt1.bind([routeId]);
        let shortName = null;
        if (stmt1.step()) shortName = stmt1.getAsObject().route_short_name;
        stmt1.free();
        
        if (!shortName) return [routeId];
        
        let stmt2 = db.prepare("SELECT route_id FROM routes WHERE route_short_name = ?");
        stmt2.bind([shortName]);
        let rIds = [];
        while(stmt2.step()) {
            rIds.push(stmt2.getAsObject().route_id);
        }
        stmt2.free();
        return rIds.length > 0 ? rIds : [routeId];
    } catch(e) {
        return [routeId];
    }
}

async function findRouteId(shortName, exactRouteId = null) {
    let jsonId = getJsonRouteId(shortName);
    if (jsonId) return jsonId;

    let customRoutes = getUnlockedCustomRoutes();
    
    await ensureGtfsCache();
    let query = "SELECT route_id, route_short_name FROM routes";
    
    const checkRow = (rId, rShort) => {
        if (exactRouteId && (rShort === exactRouteId || rId === exactRouteId)) return rId;
        let num = parseInt(rShort);
        if (!isNaN(num)) {
            const inRange = (num >= 400621 && num <= 405611) || 
                            (num >= 430432 && num <= 440649) || 
                            (num >= 450411 && num <= 475211) || 
                            (num >= 490722 && num <= 496711) ||
                            customRoutes.has(rShort) || customRoutes.has(rId); 
            if (inRange) { 
                if (rShort === shortName || rShort.endsWith(shortName) || rId === exactRouteId || rId === shortName) return rId; 
            }
        }
        return null;
    };
    
    if (idpkDb) {
        try {
            let stmt = idpkDb.prepare(query);
            while(stmt.step()) {
                let row = stmt.getAsObject();
                let match = checkRow(row.route_id, row.route_short_name);
                if (match) { stmt.free(); return match; }
            }
            stmt.free();
        } catch(e) { console.error(e); }
    }
    
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
        if (!targetLinkospoj || targetLinkospoj.length < 3) return { error: "Chybný formát Linky" };

        let exactRouteId = targetLinkospoj.includes('/') ? targetLinkospoj.split('/')[0].trim().replace(/\D/g, '') : targetLinkospoj.replace(/\D/g, '');
        let spojNum = targetLinkospoj.includes('/') ? targetLinkospoj.split('/')[1].trim().replace(/\D/g, '') : "";
        
        let customRoutes = getUnlockedCustomRoutes();
        let linkaNum = exactRouteId;
        let forcedRouteId = null;
        
        if (exactRouteId.includes('|')) {
            let parts = exactRouteId.split('|');
            forcedRouteId = parts[2] ? parts[2].trim() : null;
            linkaNum = parts[0].trim();
        } else if (exactRouteId.length >= 5 && !customRoutes.has(exactRouteId)) {
            linkaNum = exactRouteId.slice(-3).replace(/^0+/, ''); 
        } else {
            linkaNum = exactRouteId.replace(/^0+/, ''); 
        }

        let isJsonMatch = false;
        let jsonId = getJsonRouteId(linkaNum);
        if (jsonId) {
            linkaNum = jsonId;
            isJsonMatch = true;
        }

        let routeId = null;
        if (isJsonMatch) {
            routeId = linkaNum;
        } else if (forcedRouteId) {
            routeId = forcedRouteId;
        } else {
            routeId = await findRouteId(linkaNum, exactRouteId);
            if (!routeId) return { error: `Linka ${exactRouteId} nenalezena v GTFS` };
        }

        if (!spojNum) return { isTemplate: true, lineNum: linkaNum, routeId: routeId, stopMap: parseTextFileStopsToMap(textFileStops) };

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
        let gtfsStops = await getGtfsStopsForTrip(tripId); let finalStops = []; const stopMap = stopMapObj;
        for (let gStop of gtfsStops) {
            let normGtfsName = normalizeName(gStop.name); let txtLineData = findBestMatch(normGtfsName, stopMap); 
            let finalName = gStop.name; let finalZone = gStop.zone; let finalTime = gStop.time; let finalType = gStop.type; let finalAudio = "";
            if (txtLineData) {
                let parts = txtLineData.split('|'); let rawAudio = parts[0].trim().replace(/"/g, ''); 
                if (rawAudio) finalAudio = rawAudio.endsWith('.wav') ? rawAudio : rawAudio + ".wav";
                const checkAndGet = (key) => { let part = parts.find(p => p.trim().startsWith(key)); if (!part) return null; let colonIdx = part.indexOf(':'); if (colonIdx === -1) return null; let val = part.substring(colonIdx + 1).trim(); if (val === "") return null; return val.replace(/"/g, ''); };
                let tName = checkAndGet('Display'); if (tName) finalName = tName;
                let tZone = checkAndGet('Tarifní zona'); if (tZone) finalZone = tZone;
                let tTime = checkAndGet('Čas'); if (tTime) finalTime = tTime;
                let tOthers = checkAndGet('Další znaky'); if (tOthers && (tOthers.includes('ZZ') || tOthers.includes('KZ'))) finalType = 'z';
            }
            finalZone = cleanZones(finalZone); finalStops.push({ audio: finalAudio, name: finalName, zone: finalZone, time: finalTime, type: finalType });
        }
        return { stops: finalStops, destination: await getHeadsign(tripId) };
    } catch(e) { return { error: e.message }; }
});

function mergeStops(gtfsStops, textFileLines) {
    let finalStops = [];
    for (let i = 0; i < gtfsStops.length; i++) {
        let gStop = gtfsStops[i]; let txtLine = (i < textFileLines.length) ? textFileLines[i] : "";
        let finalName = gStop.name; let finalZone = gStop.zone; let finalTime = gStop.time; let finalType = gStop.type; let finalAudio = "";
        if (txtLine) {
            let lineData = txtLine; if(txtLine.includes('=')) lineData = txtLine.split('=')[1].trim();
            let parts = lineData.split('|'); let rawAudio = parts[0].trim().replace(/"/g, ''); 
            if (rawAudio) finalAudio = rawAudio.endsWith('.wav') ? rawAudio : rawAudio + ".wav";
            const checkAndGet = (key) => { let part = parts.find(p => p.trim().startsWith(key)); if (!part) return null; let colonIdx = part.indexOf(':'); if (colonIdx === -1) return null; let val = part.substring(colonIdx + 1).trim(); if (val === "") return null; return val.replace(/"/g, ''); };
            let tName = checkAndGet('Display'); if (tName) finalName = tName; let tZone = checkAndGet('Tarifní zona'); if (tZone) finalZone = tZone; let tTime = checkAndGet('Čas'); if (tTime) finalTime = tTime; let tOthers = checkAndGet('Další znaky'); if (tOthers && (tOthers.includes('ZZ') || tOthers.includes('KZ'))) finalType = 'z';
        }
        finalZone = cleanZones(finalZone); finalStops.push({ audio: finalAudio, name: finalName, zone: finalZone, time: finalTime, type: finalType });
    }
    return finalStops;
}

async function findTripId(routeId, cleanSpojNum) {
    if (getJsonRouteId(routeId)) return `json_${routeId}_${cleanSpojNum}`;

    await ensureGtfsCache();
    let query = "SELECT trip_id FROM trips WHERE route_id = $r";
    let tidList = [];
    
    if (idpkDb) {
        try {
            let stmt = idpkDb.prepare(query);
            stmt.bind({$r: routeId.trim()});
            while(stmt.step()) tidList.push(stmt.getAsObject().trip_id);
            stmt.free();
        } catch(e) { log.error(e); }
    }
    
    for (let tid of tidList) {
        if (extractSpojNumber(tid, routeId) === cleanSpojNum) return tid;
    }

    return null;
}

async function getHeadsign(tripId) {
    if (tripId.startsWith('json_')) {
        let lNum = tripId.split('_')[1]; const spojNum = parseInt(tripId.split('_')[2]);
        const data = loadJsonData(lNum); const trip = data.find(t => t.spoj === spojNum); return trip ? trip.smer : "";
    }
    
    await ensureGtfsCache();
    let query = "SELECT CASE WHEN trip_headsign = '' OR trip_headsign IS NULL THEN (SELECT s2.name FROM stop_times st2 JOIN stops s2 ON st2.stop_id = s2.stop_id WHERE st2.trip_id = trips.trip_id ORDER BY st2.stop_sequence DESC LIMIT 1) ELSE trip_headsign END as headsign FROM trips WHERE trip_id = $t";
    
    if (idpkDb) {
        try {
            let stmt = idpkDb.prepare(query);
            stmt.bind({$t: tripId.trim()});
            if (stmt.step()) { let res = stmt.getAsObject().headsign; stmt.free(); return res; }
            stmt.free();
        } catch(e) { console.error(e); }
    }
    
    return "";
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
    log.info('[GTFS Cache] DB invalidována.');
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
    if (tripId.startsWith('json_')) {
        let lNum = tripId.split('_')[1]; const spojNum = parseInt(tripId.split('_')[2]);
        const data = loadJsonData(lNum); const trip = data.find(t => t.spoj === spojNum);
        if(trip) { return trip.zastavky.map(z => ({ name: z.name, zone: z.zone || "", time: z.time || "", type: 'n', seq: 0 })); }
        return [];
    }

    await ensureGtfsCache();
    let query = "SELECT st.arrival_time as time, st.pickup_type, s.name, st.stop_sequence as seq, s.zone_id, s.cisjr_id FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $tripId ORDER BY st.stop_sequence";
    let fallbackQuery = "SELECT st.arrival_time as time, st.pickup_type, s.name, st.stop_sequence as seq, '' as zone_id, '' as cisjr_id FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $tripId ORDER BY st.stop_sequence";
    let results = [];
    
    let zonesOverride = {};
    try {
        const overridePath = path.join(app.getPath('userData'), 'data', 'zones_override.json');
        if (fs.existsSync(overridePath)) {
            zonesOverride = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
        }
    } catch (e) { log.error("Failed to load zones_override.json: " + e); }
    
    const processRow = (row) => {
        let type = (row.pickup_type === '2' || row.pickup_type === '3') ? 'z' : 'n';
        let timeStr = row.time ? row.time.substring(0, 5) : "";
        
        let stopName = row.name;
        stopName = stopName.replace(/autobusov[aá]\s+stanice/gi, "aut. st.");
        stopName = stopName.replace(/autobusov[eé]\s+n[aá]dra[zž][ií]/gi, "aut. nádr.");
        stopName = stopName.replace(/[zž]elezni[cč]n[ií]\s+stanice/gi, "žel. st.");
        stopName = stopName.replace(/restaurace/gi, "rest.");
        
        let rawZone = row.zone_id || "";
        if (row.cisjr_id && zonesOverride[row.cisjr_id]) {
            rawZone = zonesOverride[row.cisjr_id];
        }
        
        let zonesList = rawZone.split(",").map(z => z.trim().replace(/^P/i, "")).filter(z => z !== "");
        let finalZone = zonesList.join("<br>");
        let isPhoneDemand = (row.pickup_type == 2 || row.pickup_type == 3);
        results.push({ name: stopName, zone: finalZone, time: timeStr, type: type, seq: row.seq, isPhoneDemand: isPhoneDemand });
    };

    if (idpkDb) {
        try {
            let stmt = idpkDb.prepare(query);
            stmt.bind({$tripId: tripId.trim()});
            while(stmt.step()) processRow(stmt.getAsObject());
            stmt.free();
        } catch(e) { 
            try {
                let stmt = idpkDb.prepare(fallbackQuery);
                stmt.bind({$tripId: tripId.trim()});
                while(stmt.step()) processRow(stmt.getAsObject());
                stmt.free();
            } catch(e2) {
                console.error("Fallback query also failed:", e2);
            }
        }
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
        let stmt = idpkDb.prepare("SELECT st.arrival_time as time, st.pickup_type, s.name, s.zone_id FROM stop_times st JOIN stops s ON st.stop_id = s.stop_id WHERE st.trip_id = $tripId ORDER BY st.stop_sequence");
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

    // JSON linky ze složky data
    try {
        let dirsToScan = [path.join(PATH_USERDATA, 'data'), path.join(PATH_EXE, 'data'), path.join(PATH_DEV, 'data')];
        dirsToScan.forEach(dir => {
            if (fs.existsSync(dir)) {
                fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
                    let num = f.replace('.json', '');
                    results.push(`${num} | Lokální JSON Linka ${num} | ${num}`);
                });
            }
        });
    } catch(e) { console.error(e); }

    await ensureGtfsCache();
    if (idpkDb) {
        try {
            let res = idpkDb.exec("SELECT route_id, route_short_name, route_long_name FROM routes");
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
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) {
        const data = loadJsonData(jsonId);
        const starts = new Set();
        data.forEach(t => { if (t.zastavky.length > 0) starts.add(t.zastavky[0].name); });
        return Array.from(starts).sort();
    }

    await ensureGtfsCache();
    let rIds = getRouteIdsForShortName(routeId.trim(), idpkDb);
    let placeholders = rIds.map(() => '?').join(',');
    let activeServices = []; // getActiveServiceIds(idpkDb); // disabled to show all weekend/weekday trips
    let serviceFilter = "";
    let bindValues = [...rIds];
    
    if (activeServices.length > 0) {
        let sPlaceholders = activeServices.map(() => '?').join(',');
        serviceFilter = `AND t.service_id IN (${sPlaceholders})`;
        bindValues = bindValues.concat(activeServices);
    }

    let query = `
        SELECT s.name 
        FROM trips t
        JOIN stop_times st ON t.trip_id = st.trip_id
        JOIN stops s ON st.stop_id = s.stop_id
        WHERE t.route_id IN (${placeholders}) ${serviceFilter}
        AND st.stop_sequence = (
            SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id
        )
    `;
    let starts = new Set();
    
    const runQuery = (db) => {
        console.log('[DEBUG] gtfs-get-start-stops routeId:', routeId, 'rIds:', rIds, 'bindValues:', bindValues);
        try {
            let stmt = db.prepare(query);
            stmt.bind(bindValues);
            while(stmt.step()) starts.add(shortenStopName(stmt.getAsObject().name));
            stmt.free();
        } catch(e) { console.error(e); }
    };

    if (idpkDb) runQuery(idpkDb);
    
    return Array.from(starts).sort();
});

ipcMain.handle('gtfs-get-destinations-from-start', async (event, {routeId, startStopName}) => {
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) {
        const data = loadJsonData(jsonId);
        const dests = new Set();
        data.forEach(t => { if (t.zastavky.length > 0 && t.zastavky[0].name === startStopName) dests.add(t.smer); });
        return Array.from(dests).sort();
    }

    await ensureGtfsCache();
    let rIds = getRouteIdsForShortName(routeId.trim(), idpkDb);
    let placeholders = rIds.map(() => '?').join(',');
    let activeServices = []; // getActiveServiceIds(idpkDb); // disabled to show all weekend/weekday trips
    let serviceFilter = "";
    let bindValues = [...rIds];
    
    if (activeServices.length > 0) {
        let sPlaceholders = activeServices.map(() => '?').join(',');
        serviceFilter = `AND t.service_id IN (${sPlaceholders})`;
        bindValues = bindValues.concat(activeServices);
    }
    bindValues.push(startStopName);

    let query = `
        SELECT DISTINCT CASE WHEN t.trip_headsign = '' OR t.trip_headsign IS NULL THEN 
            (SELECT s2.name FROM stop_times st2 JOIN stops s2 ON st2.stop_id = s2.stop_id WHERE st2.trip_id = t.trip_id ORDER BY st2.stop_sequence DESC LIMIT 1)
        ELSE t.trip_headsign END as trip_headsign
        FROM trips t
        JOIN stop_times st ON t.trip_id = st.trip_id
        JOIN stops s ON st.stop_id = s.stop_id
        WHERE t.route_id IN (${placeholders}) ${serviceFilter}
        AND s.name = ?
        AND st.stop_sequence = (
            SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id
        )
    `;
    let dests = new Set();
    
    const runQuery = (db) => {
        try {
            let stmt = db.prepare(query);
            stmt.bind(bindValues);
            while(stmt.step()) dests.add(shortenStopName(stmt.getAsObject().trip_headsign));
            stmt.free();
        } catch(e) { console.error(e); }
    };

    if (idpkDb) runQuery(idpkDb);
    
    return Array.from(dests).sort();
});

ipcMain.handle('gtfs-get-final-trips', async (event, {routeId, startStopName, headsign}) => {
    console.log('gtfs-get-final-trips called with:', routeId, startStopName, headsign);
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) {
        const data = loadJsonData(jsonId);
        const results = [];
        data.forEach(t => {
            if (t.smer === headsign && t.zastavky.length > 0 && t.zastavky[0].name === startStopName) {
                results.push({ tripId: `json_${jsonId}_${t.spoj}`, time: t.odjezd, formattedName: `${jsonId}/${t.spoj}`, spojNum: t.spoj, headsign: t.smer, tripNumber: `json_${jsonId}_${t.spoj}` });
            }
        });
        return results.sort((a, b) => a.time.localeCompare(b.time));
    }

    await ensureGtfsCache();
    let customRoutes = getUnlockedCustomRoutes();
    let rIdStr = routeId.trim();

    let routeShortName = rIdStr;
    let queryR = "SELECT route_short_name FROM routes WHERE route_id = $r";
    if (idpkDb) {
        try {
            let stmt = idpkDb.prepare(queryR);
            stmt.bind({$r: rIdStr});
            if (stmt.step()) routeShortName = stmt.getAsObject().route_short_name;
            stmt.free();
        } catch(e) { console.error(e); }
    }

    let lineNumber = routeShortName;
    if (!customRoutes.has(rIdStr) && !customRoutes.has(routeShortName)) {
        lineNumber = routeShortName.replace(/\D/g, '').slice(-3);
    }

    let rIds = getRouteIdsForShortName(routeId.trim(), idpkDb);
    let placeholders = rIds.map(() => '?').join(',');
    let activeServices = []; // getActiveServiceIds(idpkDb); // disabled to show all weekend/weekday trips
    let serviceFilter = "";
    let bindValues = [...rIds];
    
    if (activeServices.length > 0) {
        let sPlaceholders = activeServices.map(() => '?').join(',');
        serviceFilter = `AND t.service_id IN (${sPlaceholders})`;
        bindValues = bindValues.concat(activeServices);
    }
    bindValues.push(startStopName);

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

    function processTrips(dbObj, bVals) {
        if (!dbObj) return;
        try {
            let query = `
                SELECT * FROM (
                    SELECT t.trip_id, t.spoj_cislo, t.service_id, st.arrival_time as time,
                    cal.start_date, cal.end_date,
                    cal.monday, cal.tuesday, cal.wednesday, cal.thursday, cal.friday, cal.saturday, cal.sunday,
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
                        (SELECT s2.name FROM stop_times st2 JOIN stops s2 ON st2.stop_id = s2.stop_id WHERE st2.trip_id = t.trip_id ORDER BY st2.stop_sequence DESC LIMIT 1)
                    ELSE t.trip_headsign END as headsign
                    FROM trips t
                    JOIN stop_times st ON t.trip_id = st.trip_id
                    JOIN stops s ON st.stop_id = s.stop_id
                    LEFT JOIN calendar cal ON t.service_id = cal.service_id
                    WHERE t.route_id IN (${placeholders}) ${serviceFilter}
                    AND s.name = ?
                    AND st.stop_sequence = (
                        SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id
                    )
                ) WHERE headsign = ?
            `;
            let fullBVals = [todayStr, todayStr, todayStr, todayStr, ...bVals, headsign];
            let stmt = dbObj.prepare(query);
            stmt.bind(fullBVals);
            while(stmt.step()) {
                let obj = stmt.getAsObject();
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
                
                // Determine if this trip is active in the current calendar period (season)
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
    };

    if (idpkDb) processTrips(idpkDb, bindValues);
    
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
        width: 800, height: 600, resizable: false, frame: false, title: "Lancher OIS IDPK",
        webPreferences: { nodeIntegration: true, contextIsolation: false },
        icon: path.join(__dirname, 'icon.ico'),
        backgroundColor: '#0f172a'
    });
    loadWindowFile(launcherWindow, 'launcher.html');

    launcherWindow.on('closed', () => { app.quit(); });
}

ipcMain.on('launch-dev-build', async () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.removeAllListeners('closed');
    }
    await syncGtfsData();
    if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.close();
    }
    createController();
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
