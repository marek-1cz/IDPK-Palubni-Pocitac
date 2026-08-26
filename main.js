const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const http = require('http'); 
const { exec } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { createClient } = require('@supabase/supabase-js');

// Nastavení logování pro updater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

const SUPABASE_URL = 'https://tdonrppusbwhoftdontz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkb25ycHB1c2J3aG9mdGRvbnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDI1NDIsImV4cCI6MjA4ODM3ODU0Mn0.4RLDe65aE5aW1HtWkfgS0QL6JY1MNzGrA7yfnehBFzo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

const cleanStr = (s) => s ? s.replace(/["'\r\n]+/g, '').trim() : "";

function getUniversalPath(folder, filename) {
    let p1 = path.join(PATH_EXE, folder, filename);
    if (fs.existsSync(p1)) return p1;
    let p2 = path.join(PATH_DEV, folder, filename);
    if (fs.existsSync(p2)) return p2;
    return null;
}

function getUnlockedCustomRoutes() {
    let customRoutes = new Set();
    let dirsToScan = [path.join(PATH_EXE, 'linky'), path.join(PATH_DEV, 'linky')];
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
                } catch(e) {}
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
    const jsonFile = getUniversalPath('data', '1651.json');
    if (!jsonFile) console.log("Info: Složka data se prohledává dynamicky.");
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
        width: 600, height: 400, title: "Diagnostický Log V1.5 RC", autoHideMenuBar: true,
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
        width: 380, height: 750, resizable: false, autoHideMenuBar: true, title: "Palubní počítač V1.5 RC",
        webPreferences: { nodeIntegration: true, contextIsolation: false, autoplayPolicy: 'no-user-gesture-required', webSecurity: false },
        icon: path.join(__dirname, 'icon.ico')
    });
    loadWindowFile(controllerWindow, 'ovladac.html');
    controllerWindow.on('closed', () => { app.quit(); });
}

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

function getDataFilePath(filename) { return getUniversalPath('data', filename) || path.join(__dirname, 'data', filename); }

ipcMain.handle('get-link-files', async () => {
    try {
        let files = new Set();
        let dir1 = path.join(PATH_EXE, 'linky');
        if (fs.existsSync(dir1)) { fs.readdirSync(dir1).filter(f => f.endsWith('.txt')).forEach(f => files.add(f.replace('.txt', ''))); }
        let dir2 = path.join(PATH_DEV, 'linky');
        if (fs.existsSync(dir2)) { fs.readdirSync(dir2).filter(f => f.endsWith('.txt')).forEach(f => files.add(f.replace('.txt', ''))); }
        return Array.from(files).sort();
    } catch (error) { return []; }
});

ipcMain.handle('read-route-file', async (event, filename) => {
    let cleanName = filename.toLowerCase().replace('.txt', '').replace(/[\r\n]+/g, '').trim();
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

function normalizeName(str) { return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function parseTextFileStopsToMap(lines) { let map = {}; for(let line of lines) { if(line.includes('=')) { let parts = line.split('='); map[normalizeName(parts[0].trim())] = parts[1].trim(); } } return map; }
function findBestMatch(normGtfs, stopMap) { if (stopMap[normGtfs]) return stopMap[normGtfs]; for (const txtKey in stopMap) { if (normGtfs.includes(txtKey) || txtKey.includes(normGtfs)) return stopMap[txtKey]; } return null; }
function loadJsonData(jsonId) { try { let p = getUniversalPath('data', `${jsonId}.json`); if (p) { const content = fs.readFileSync(p, 'utf-8'); return JSON.parse(content); } } catch(e) {} return []; }

function extractSpojNumber(tripId, routeId) {
    let cleanTrip = cleanStr(tripId);
    let routeNumeric = cleanStr(routeId).replace(/\D/g, '');
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

async function findRouteId(shortName, exactRouteId = null) {
    let jsonId = getJsonRouteId(shortName);
    if (jsonId) return jsonId;

    let customRoutes = getUnlockedCustomRoutes();

    const filePath = getDataFilePath('routes.txt'); if (!fs.existsSync(filePath)) return null;
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
        if (first) { first = false; continue; }
        const p = parseCSV(line);
        let routeShort = cleanStr(p[2]); 
        let routeExact = cleanStr(p[0]);
        
        if (exactRouteId && (routeShort === exactRouteId || routeExact === exactRouteId)) {
            return routeExact; 
        }

        let num = parseInt(routeShort);
        if (!isNaN(num)) {
            const inRange = (num >= 400621 && num <= 405611) || 
                            (num >= 430432 && num <= 440649) || 
                            (num >= 450411 && num <= 475211) || 
                            (num >= 490722 && num <= 496711) ||
                            customRoutes.has(routeShort) || customRoutes.has(routeExact); 
            if (inRange) { 
                if (routeShort === shortName || routeShort.endsWith(shortName) || routeExact === exactRouteId || routeExact === shortName) return routeExact; 
            }
        }
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
        
        if (exactRouteId.length >= 5 && !customRoutes.has(exactRouteId)) {
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

    const filePath = getDataFilePath('trips.txt'); if (!fs.existsSync(filePath)) return null;
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
        if (first) { first = false; continue; }
        const p = parseCSV(line); 
        if (cleanStr(p[0]) === cleanStr(routeId)) {
            let tid = cleanStr(p[2]);
            let actualSpoj = extractSpojNumber(tid, routeId);
            if (actualSpoj === cleanSpojNum) return tid;
        }
    }
    return null;
}

async function getHeadsign(tripId) {
    if (tripId.startsWith('json_')) {
        let lNum = tripId.split('_')[1]; const spojNum = parseInt(tripId.split('_')[2]);
        const data = loadJsonData(lNum); const trip = data.find(t => t.spoj === spojNum); return trip ? trip.smer : "";
    }
    const filePath = getDataFilePath('trips.txt'); const stream = fs.createReadStream(filePath); const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) { const p = parseCSV(line); if (cleanStr(p[2]) === cleanStr(tripId)) return cleanStr(p[3]); }
    return "";
}

async function getGtfsStopsForTrip(tripId) {
    if (tripId.startsWith('json_')) {
        let lNum = tripId.split('_')[1]; const spojNum = parseInt(tripId.split('_')[2]);
        const data = loadJsonData(lNum); const trip = data.find(t => t.spoj === spojNum);
        if(trip) { return trip.zastavky.map(z => ({ name: z.name, zone: z.zone || "", time: z.time || "", type: 'n', seq: 0 })); }
        return [];
    }

    const stopsInfo = new Map();
    const sContent = fs.readFileSync(getDataFilePath('stops.txt'), 'utf-8');
    const sLines = sContent.split('\n');
    sLines.forEach((line, idx) => {
        if (idx === 0 || !line.trim()) return;
        const p = parseCSV(line);
        let zone = p.length > 6 ? p[6] : (p.length > 5 ? p[5] : "");
        if (zone.includes('.')) zone = ""; 
        stopsInfo.set(cleanStr(p[0]), { name: cleanStr(p[2]), zone: cleanZones(zone) });
    });

    const result = [];
    const stream = fs.createReadStream(getDataFilePath('stop_times.txt'));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
        if (first) { first = false; continue; }
        const p = line.split(',').map(s => s.replace(/["'\r\n]+/g, '').trim());
        if (p[0] === tripId) {
            const stopId = p[3]; const info = stopsInfo.get(stopId) || { name: "Neznámá", zone: "" };
            let time = p[1]; if (time) time = time.substring(0, 5);
            let type = 'n'; if (p[5] && (p[5] === '2' || p[5] === '3')) type = 'z';
            result.push({ name: info.name, zone: info.zone, time: time, type: type, seq: parseInt(p[4]) });
        }
    }
    return result.sort((a,b) => a.seq - b.seq);
}

ipcMain.handle('gtfs-load-routes', async () => { 
    const routesPath = getDataFilePath('routes.txt'); 
    const results = []; 
    let customRoutes = getUnlockedCustomRoutes();

    try {
        let dirsToScan = [path.join(PATH_EXE, 'data'), path.join(PATH_DEV, 'data')];
        dirsToScan.forEach(dir => {
            if (fs.existsSync(dir)) {
                let files = fs.readdirSync(dir);
                files.filter(f => f.endsWith('.json')).forEach(f => {
                    let num = f.replace('.json', '');
                    results.push(`${num} | Lokální JSON Linka ${num} | ${num}`);
                });
            }
        });
    } catch(e) {}

    if (!fs.existsSync(routesPath)) return [...new Set(results)].sort(); 

    const fileStream = fs.createReadStream(routesPath); 
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity }); 
    let first = true; 
    for await (const line of rl) { 
        if (first) { first = false; continue; } 
        const p = parseCSV(line); 
        let routeShort = cleanStr(p[2]);
        let exactRouteId = cleanStr(p[0]);

        if (customRoutes.has(routeShort) || customRoutes.has(exactRouteId)) {
            results.push(`${routeShort} | ${cleanStr(p[3])} | ${exactRouteId}`);
            continue;
        }

        const num = parseInt(routeShort); 
        if (!isNaN(num)) { 
            if (num === 440424 || num === 424) continue; 
            const inRange = (num >= 400621 && num <= 405611) || 
                            (num >= 430432 && num <= 440649) || 
                            (num >= 450411 && num <= 475211) || 
                            (num >= 490722 && num <= 496711); 
            if (inRange) { results.push(`${routeShort} | ${cleanStr(p[3])} | ${exactRouteId}`); } 
        } 
    } 
    return [...new Set(results)].sort(); 
});

ipcMain.handle('gtfs-get-start-stops', async (event, routeId) => { 
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) { 
        const data = loadJsonData(jsonId); 
        const starts = new Set(); 
        data.forEach(t => { if(t.zastavky.length > 0) starts.add(t.zastavky[0].name); }); 
        return Array.from(starts).sort(); 
    } 

    const tripsPath = getDataFilePath('trips.txt'); const stopTimesPath = getDataFilePath('stop_times.txt'); const stopsPath = getDataFilePath('stops.txt'); 
    const tripIds = new Set(); const tripsStream = fs.createReadStream(tripsPath); const rlTrips = readline.createInterface({ input: tripsStream, crlfDelay: Infinity }); 
    let tFirst = true; 
    for await (const line of rlTrips) { 
        if (tFirst) { tFirst = false; continue; } 
        const p = parseCSV(line); if (cleanStr(p[0]) === cleanStr(routeId)) tripIds.add(cleanStr(p[2])); 
    } 
    if (tripIds.size === 0) return [];
    
    const stopsMap = new Map(); const sContent = fs.readFileSync(stopsPath, 'utf-8').split('\n'); sContent.forEach((line, idx) => { if (idx === 0 || !line.trim()) return; const p = parseCSV(line); stopsMap.set(cleanStr(p[0]), cleanStr(p[2])); }); 
    
    const tripMinStops = new Map(); const stStream = fs.createReadStream(stopTimesPath); const rlSt = readline.createInterface({ input: stStream, crlfDelay: Infinity }); 
    let stFirst = true; 
    for await (const line of rlSt) { 
        if (stFirst) { stFirst = false; continue; } 
        const p = line.split(',').map(s => s.replace(/["'\r\n]+/g, '').trim());
        const tid = p[0]; 
        if (tripIds.has(tid)) { const currentSeq = parseInt(p[4]); if (!tripMinStops.has(tid) || currentSeq < tripMinStops.get(tid).minSeq) { tripMinStops.set(tid, { minSeq: currentSeq, stopId: p[3] }); } } 
    } 
    const uniqueStartNames = new Set(); tripMinStops.forEach(val => { if (stopsMap.has(val.stopId)) { uniqueStartNames.add(stopsMap.get(val.stopId)); } }); return Array.from(uniqueStartNames).sort(); 
});

ipcMain.handle('gtfs-get-destinations-from-start', async (event, {routeId, startStopName}) => { 
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) { 
        const data = loadJsonData(jsonId); 
        const dests = new Set(); 
        data.forEach(t => { if(t.zastavky.length > 0 && t.zastavky[0].name === startStopName) { dests.add(t.smer); } }); 
        return Array.from(dests).sort(); 
    } 

    const tripsPath = getDataFilePath('trips.txt'); const stopTimesPath = getDataFilePath('stop_times.txt'); const stopsPath = getDataFilePath('stops.txt'); 
    const stopNameMap = new Map(); const sContent = fs.readFileSync(stopsPath, 'utf-8').split('\n'); sContent.forEach((line, idx) => { if (idx === 0 || !line.trim()) return; const p = parseCSV(line); const name = cleanStr(p[2]); if (!stopNameMap.has(name)) stopNameMap.set(name, []); stopNameMap.get(name).push(cleanStr(p[0])); }); const targetStopIds = stopNameMap.get(startStopName) || []; 
    const routeTrips = new Map(); const tripsStream = fs.createReadStream(tripsPath); const rlTrips = readline.createInterface({ input: tripsStream, crlfDelay: Infinity }); let tFirst = true; for await (const line of rlTrips) { if (tFirst) { tFirst = false; continue; } const p = parseCSV(line); if (cleanStr(p[0]) === cleanStr(routeId)) routeTrips.set(cleanStr(p[2]), cleanStr(p[3])); } 
    const tripMinStops = new Map(); const stStream = fs.createReadStream(stopTimesPath); const rlSt = readline.createInterface({ input: stStream, crlfDelay: Infinity }); let stFirst = true; 
    for await (const line of rlSt) { 
        if (stFirst) { stFirst = false; continue; } 
        const p = line.split(',').map(s => s.replace(/["'\r\n]+/g, '').trim()); 
        const tid = p[0]; 
        if (routeTrips.has(tid)) { const currentSeq = parseInt(p[4]); if (!tripMinStops.has(tid) || currentSeq < tripMinStops.get(tid).minSeq) { tripMinStops.set(tid, { minSeq: currentSeq, stopId: p[3] }); } } 
    } 
    const validHeadsigns = new Set(); tripMinStops.forEach((val, tid) => { if (targetStopIds.includes(val.stopId)) { validHeadsigns.add(routeTrips.get(tid)); } }); return Array.from(validHeadsigns).sort(); 
});

ipcMain.handle('gtfs-get-final-trips', async (event, {routeId, startStopName, headsign}) => { 
    let jsonId = getJsonRouteId(routeId);
    if (jsonId) { 
        const data = loadJsonData(jsonId); 
        const results = []; 
        data.forEach(t => { if (t.smer === headsign && t.zastavky.length > 0 && t.zastavky[0].name === startStopName) { results.push({ tripId: `json_${jsonId}_${t.spoj}`, time: t.odjezd, formattedName: `${jsonId}/${t.spoj}`, spojNum: t.spoj, headsign: t.smer, tripNumber: `json_${jsonId}_${t.spoj}` }); } }); 
        return results.sort((a, b) => a.time.localeCompare(b.time)); 
    } 

    const tripsPath = getDataFilePath('trips.txt'); const stopTimesPath = getDataFilePath('stop_times.txt'); const stopsPath = getDataFilePath('stops.txt'); const routesPath = getDataFilePath('routes.txt');
    
    let routeShortName = ""; const routesStream = fs.createReadStream(routesPath); const rlRoutes = readline.createInterface({ input: routesStream, crlfDelay: Infinity }); let rFirst = true; for await (const line of rlRoutes) { const p = parseCSV(line); if (rFirst) { rFirst = false; continue; } if (cleanStr(p[0]) === cleanStr(routeId)) { routeShortName = cleanStr(p[2]); break; } }
    let customRoutes = getUnlockedCustomRoutes();
    let lineNumber = routeShortName;
    if (!customRoutes.has(routeId) && !customRoutes.has(routeShortName)) {
        lineNumber = routeShortName.replace(/\D/g, '').slice(-3);
    }
    
    const stopNameMap = new Map(); const sContent = fs.readFileSync(stopsPath, 'utf-8').split('\n'); sContent.forEach((line, idx) => { if (idx === 0 || !line.trim()) return; const p = parseCSV(line); const name = cleanStr(p[2]); if (!stopNameMap.has(name)) stopNameMap.set(name, []); stopNameMap.get(name).push(cleanStr(p[0])); }); const targetStopIds = stopNameMap.get(startStopName) || []; 
    const validTrips = new Map(); const tripsStream = fs.createReadStream(tripsPath); const rlTrips = readline.createInterface({ input: tripsStream, crlfDelay: Infinity }); let tFirst = true; for await (const line of rlTrips) { const p = parseCSV(line); if (tFirst) { tFirst = false; continue; } if (cleanStr(p[0]) === cleanStr(routeId) && cleanStr(p[3]) === cleanStr(headsign)) { let tid = cleanStr(p[2]); let cleanSpoj = extractSpojNumber(tid, routeId); validTrips.set(tid, { cleanLine: lineNumber, cleanSpoj }); } } 
    const tripStartData = new Map(); const stStream = fs.createReadStream(stopTimesPath); const rlSt = readline.createInterface({ input: stStream, crlfDelay: Infinity }); let stFirst = true; 
    for await (const line of rlSt) { 
        if (stFirst) { stFirst = false; continue; } 
        const p = line.split(',').map(s => s.replace(/["'\r\n]+/g, '').trim()); 
        const tid = p[0]; 
        if (validTrips.has(tid)) { const currentSeq = parseInt(p[4]); if (!tripStartData.has(tid) || currentSeq < tripStartData.get(tid).seq) { tripStartData.set(tid, { seq: currentSeq, time: p[1], stopId: p[3] }); } } 
    } 
    const finalResults = []; const seenCombos = new Set(); tripStartData.forEach((val, tid) => { if (targetStopIds.includes(val.stopId)) { let time = val.time; if (time.length >= 5) time = time.substring(0, 5); let tripInfo = validTrips.get(tid); let spojNum = parseInt(tripInfo.cleanSpoj) || 0; let formattedName = `${tripInfo.cleanLine}/${tripInfo.cleanSpoj}`; let uniqueKey = tid; if (!seenCombos.has(uniqueKey)) { seenCombos.add(uniqueKey); finalResults.push({ tripId: tid, time: time, formattedName: formattedName, spojNum: spojNum, headsign: headsign, tripNumber: formattedName }); } } }); return finalResults.sort((a, b) => a.time.localeCompare(b.time)); 
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
    createController(); 
    setupAutoUpdater();
});

async function setupAutoUpdater() {
    try {
        // Získání HWID pro identifikaci uživatele
        const hwid = await getHWIDForUpdater();
        
        // Zjištění role ze Supabase
        let { data, error } = await supabase
            .from('app_users')
            .select('role')
            .eq('hwid', hwid)
            .single();
            
        let role = 'public';
        
        if (error || !data) {
            // Pokud uživatel neexistuje, vytvoříme ho s rolí public
            await supabase.from('app_users').insert([{ hwid: hwid, role: 'public' }]);
        } else {
            role = data.role;
        }
        
        log.info(`Uživatel HWID: ${hwid} má roli: ${role}`);
        
        // Nastavení kanálu podle role
        if (role === 'developer') {
            autoUpdater.channel = 'alpha'; // GitHub releases pre-release (alpha)
        } else if (role === 'beta_tester' || role === 'beta') {
            autoUpdater.channel = 'beta'; // GitHub releases pre-release (beta)
        } else {
            autoUpdater.channel = 'latest'; // Běžní uživatelé
        }
        
        // Spustit kontrolu
        autoUpdater.checkForUpdatesAndNotify();
        
    } catch (e) {
        log.error('Chyba při auto-updateru:', e);
    }
}

function getHWIDForUpdater() {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            exec('wmic csproduct get uuid', (err, stdout) => {
                if (err) resolve("UNKNOWN-HWID-UPDATER-" + Math.random().toString(36).substr(2, 9));
                else {
                    let lines = stdout.split('\\n');
                    let uuid = lines[1] ? lines[1].trim() : ("UNKNOWN-HWID-" + Math.random().toString(36).substr(2, 9));
                    resolve(uuid);
                }
            });
        } else {
            resolve("NON-WIN-HWID-" + Math.random().toString(36).substr(2, 9));
        }
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

server.listen(5000, '0.0.0.0', () => { console.log("Mobilní server běží na portu 5000"); });

ipcMain.on('sync-dom', (event, html) => {
    sseClients.forEach(client => {
        try { client.write(`data: ${JSON.stringify(html)}\n\n`); } catch(e) {}
    });
});