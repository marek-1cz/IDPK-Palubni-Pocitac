window.onerror = function(message, source, lineno, colno, error) {
    let errBox = document.getElementById('fatal-error-box');
    if (!errBox) {
        errBox = document.createElement('div');
        errBox.id = 'fatal-error-box';
        errBox.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:#c0392b; color:white; z-index:9999999; padding:20px; font-weight:bold; overflow-y:auto; box-sizing:border-box;";
        document.body.appendChild(errBox);
    }
    
    let isCrit = errBox.innerHTML.includes('Kritická chyba');
    
    errBox.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid white; padding-bottom:10px; margin-bottom:10px;">
        <span style="font-size:20px;">Kritická chyba systému</span>
        <button onclick="document.getElementById('fatal-error-box').style.display='none'" style="background:black; color:white; border:1px solid white; padding:5px 15px; cursor:pointer; font-weight:bold;">ZAVŘÍT</button>
    </div>
    <p>${message}<br>Řádek: ${lineno}</p>
    ` + (isCrit ? errBox.innerHTML.split('</div>')[1] : '');
    
    errBox.style.display = 'block';
    console.error(`[IGNOROVANÝ ERROR] ${message} (Line ${lineno})`);

    // --- ODESLÁNÍ FATÁLNÍ CHYBY NA DISCORD ---
    let dId = localStorage.getItem('discordId') || "Neznámý";
    let nick = localStorage.getItem('discordNick') || "Neznámý";
    fetchBlesk(`${API_BASE}/api/report_error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_id: dId, nick: nick, type: "SYSTÉMOVÝ ERROR", message: `${message} na řádku ${lineno}` })
    }, 3000).catch(()=>{});

    return true; 
};

process.on('unhandledRejection', (reason) => { 
    window.onerror("Unhandled Promise: " + reason, "", 0, 0, null); 
});

console.log("== PALUBNÍ SYSTÉM V1.6 RC-EDITION - INICIALIZACE ==");

const { ipcRenderer } = require('electron');
const path = require('path');
const processCore = require('process');

const API_BASE = 'https://datacorebot.koyeb.app';

// ZDE NASTAV PŘESNÝ NÁZEV VERZE, KTERÝ MÁŠ ZADANÝ NA WEBU V DASHBOARDU!
const APP_VERSION = "V1.6 RC-EDITION"; 

// Bezpečná detekce VSC (aby to nevadilo kompilátoru při buildu)
let isDevMode = false;
try {
    isDevMode = !__dirname.includes('app.asar');
} catch (e) {
    isDevMode = false;
}

// OPRAVA ZVUKŮ: Nasmerujeme cestu o slozku vys (pokud jsme ve slozce js), aby se spravne nasla slozka "zvuky"
function getBasePath() { 
    return path.join(__dirname, '..');
}

function debugLog(msg) {
    console.log(msg);
    let dt = document.getElementById('debug-text');
    if (dt) { 
        dt.innerHTML += `<span style="color:#0f0;">[${new Date().toLocaleTimeString()}]</span> ${msg}\n`; 
        dt.scrollTop = dt.scrollHeight; 
    }
}

window.playClick = function() { 
    try {
        let clickEl = document.getElementById('sound-click');
        if (!clickEl) {
            clickEl = document.createElement('audio');
            clickEl.id = 'sound-click';
            clickEl.src = "file:///" + path.join(getBasePath(), 'zvuky', 'Click.wav').replace(/\\/g, '/');
            document.body.appendChild(clickEl);
        }
        clickEl.currentTime = 0; 
        let p = clickEl.play(); 
        if (p !== undefined) p.catch(e => {});
    } catch(e) {}
};

let appState = 'BOOT'; 
let linkospojFocus = 'input'; 
let isListOpen = false;

let inputValues = { discordId: "", pinSetup: "", pinEnter: "", linkospoj: "", idpk: "" };
let machineHWID = localStorage.getItem('device_hwid'); 
if (!machineHWID) {
    machineHWID = "UNKNOWN-HWID";
}

let storedDiscordId = ""; 
let storedAppId = ""; 
let currentSessionId = localStorage.getItem('currentSessionId') || "";
let discordPollInterval = null; 
let pingInterval = null;

let availableFiles = []; 
let filteredFiles = []; 
let databaseFiles = []; 
let selectedListIndex = -1; 
let selectedIdpkRouteId = ""; 
let selectedStartStop = ""; 
let selectedDestination = "";

let currentHybridTemplate = null; 
let routeData = { 
    line: "", routeId: "", destination: "", stops: [], 
    realStopIndex: 0, previewStopIndex: 0, linkospojCode: "", nextTurnus: null, isMuted: false 
};
let drivePhase = 0; 
let stopSelectionBuffer = ""; 
let isAnnouncementPlaying = false; 
let isSystemLoading = true;

let stopPressed = false; 
let audioQueue = []; 
let isPlayingQueue = false; 
let pendingStopSound = false; 
let isStopCooldown = false;
let lastPlayedSequence = [];
window.currentAnnouncingStopName = ""; // Globální proměnná pro logování názvu zastávky

let isDelayMode = false; 
let isTimeBasedAuto = false; 
let isClassicAuto = false; 
let isDelayAuto = false; 
let isRandomContinue = false;
let classicAutoDelay = 5; 
let useFictionalTime = false; 
let fictionalTimeOffset = 0; 
let classicAutoTimer = null; 
let currentGlobalDelay = 0; 

let lockedAutoDelayMins = null; 
let lockedAutoStartTimeMins = null; 
let autoAnnounceCooldown = false; 
let routeStartupWait = false; 
let randomHistory = [];

let logoutConfirmStep = false; 

let currentAnnouncementId = null;
let currentAnnouncementIndex = 0;

const audioPlayer = new Audio();

// --- STATISTICKÉ PROMĚNNÉ ---
let statsStartTime = 0;
let statsAnnouncedStops = [];
let statsUniqueStopsCount = 0;
let isStatsActive = false;

// ==========================================
// SYSTÉM PRO STATISTIKY LINEK A ZASTÁVEK
// ==========================================
window.initStatsTracking = function() {
    statsStartTime = Date.now();
    statsAnnouncedStops = [];
    statsUniqueStopsCount = 0;
    isStatsActive = true;
    debugLog("Statistiky: Záznam linky zahájen.");
};

window.trackStopAnnouncement = function(stopName) {
    if (!isStatsActive || !stopName) return;
    statsAnnouncedStops.push(stopName);
    let uniqueStops = [...new Set(statsAnnouncedStops)];
    statsUniqueStopsCount = uniqueStops.length;
};

window.submitStats = function() {
    if (!isStatsActive || !routeData.line) return;
    
    let timePlayed = Date.now() - statsStartTime;
    // Odeslat jen když hráč hrál aspoň 30 vteřin NEBO vyhlásil aspoň 2 unikátní zastávky
    if (timePlayed > 30000 || statsUniqueStopsCount >= 2) {
        let dId = localStorage.getItem('discordId') || storedDiscordId || "";
        debugLog(`Statistiky: Odesílám data pro linku ${routeData.line} | Hráč ID: ${dId} | Zastávek: ${statsAnnouncedStops.length}`);
        fetchBlesk(`${API_BASE}/api/submit_stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line: routeData.line, stops: statsAnnouncedStops, discord_id: dId }),
            keepalive: true
        }, 3000).catch(e => {});
    } else {
        debugLog("Statistiky: Linka byla ukončena příliš brzy, záznam se neodesílá.");
    }
    
    isStatsActive = false; // Prevence proti dvojímu odeslání
};

// ==========================================
// 100% BEZPEČNÝ PŘÍSTUP K INTERNETU (PROTI ZAMRZNUTÍ)
// ==========================================
async function fetchBlesk(url, options, msTimeout = 4000) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout sítě")), msTimeout));
    return Promise.race([fetch(url, options), timeout]);
}

async function zanalyzujPripojeni() {
    if (!navigator.onLine) {
        return { 
            status: "WIFI_OFF", 
            zprava: "Nemáte zapnutou Wi-Fi nebo jste odpojeni od sítě.<br><br>Hrajete v <b>OFFLINE režimu</b>. Upozorňujeme, že v tomto režimu <b>nebudou fungovat</b> statistiky nahraných hodin, stahování nových verzí a automatické aktualizace zpráv." 
        };
    }

    try {
        let response = await fetchBlesk(`${API_BASE}/api/keepalive`, { method: 'GET' }, 4000);
        if (response.ok) {
            return { status: "OK", zprava: "OK" };
        } else {
            return { 
                status: "KOYEB_ERROR", 
                zprava: "Databáze aktuálně neodpovídá (Pravděpodobně probíhá údržba serveru).<br><br>Byli jste přepnuti do <b>OFFLINE režimu</b>." 
            };
        }
    } catch (error) {
        try {
            await fetchBlesk("https://1.1.1.1", { mode: 'no-cors' }, 3000);
            return { 
                status: "BLOCKED_BY_FIREWALL", 
                zprava: "Váš internet funguje, ale spojení aplikace bylo <b>ZABLOKOVÁNO!</b><br><br>Pravděpodobně vaši hru blokuje <b>Antivirus (např. Avast)</b> nebo <b>Windows Firewall</b>. <br><br><i>Tip: Pro plnou funkčnost přidejte hru do výjimek antiviru, nebo ji zkuste spustit jako Administrátor. Nyní pokračujete v omezeném offline režimu.</i>" 
            };
        } catch (cloudflareError) {
            return { 
                status: "NO_INTERNET", 
                zprava: "Jste sice připojeni k Wi-Fi síti, ale váš počítač <b>nemá přístup k internetu</b>.<br><br>Hrajete v <b>OFFLINE režimu</b>. Statistiky a updaty jsou dočasně nedostupné." 
            };
        }
    }
}

window.showErrorModal = function(title, msg, isVersionBlock = false, type = 'error') {
    try {
        window.playClick();
        debugLog(`[MODAL: ${type}] ${title} - ${msg}`);
        
        let msgEl = document.getElementById('error-msg-text');
        let modalEl = document.getElementById('error-modal');
        let hwidBtn = document.getElementById('error-hwid-btn');
        
        let isGlobalShutdown = msg.includes('VYPNUT') || msg.includes('vypnut');

        let color = "#e74c3c"; 
        let icon = '<i class="fas fa-times-circle"></i>';
        
        if (type === 'info') {
            color = "#38bdf8"; 
            icon = '<i class="fas fa-info-circle"></i>';
        } else if (type === 'warning') {
            color = "#f59e0b"; 
            icon = '<i class="fas fa-shield-alt"></i>';
        }

        if (msgEl) {
            msgEl.innerHTML = `<span style="color:${color}; font-size:18px; font-weight:bold; text-transform:uppercase;">${icon} ${title}</span><br><br><span style="color:var(--text-main); font-size:14px; line-height:1.5;">${msg}</span>`;
        }
        
        if (modalEl) {
            let allBtns = modalEl.querySelectorAll('button');
            allBtns.forEach(b => {
                if (!b.hasAttribute('data-custom-btn') && b.id !== 'error-hwid-btn') {
                    b.style.display = (isVersionBlock || isGlobalShutdown) ? 'none' : 'block';
                }
            });
        }
        
        if (hwidBtn) {
            if (!isVersionBlock && !isGlobalShutdown && type === 'error' && (msg.includes('HWID') || msg.includes('IP adresa'))) {
                hwidBtn.style.display = 'block';
            } else {
                hwidBtn.style.display = 'none';
            }
        }
        
        if (isGlobalShutdown) {
            if (msgEl && !msgEl.innerHTML.includes('UKONČIT')) {
                msgEl.innerHTML += `
                <br><br>
                <div style="display:flex; gap:15px; justify-content:center; margin-top:20px; padding-top:15px; border-top:1px solid rgba(255,255,255,0.1);">
                    <button data-custom-btn="true" onclick="window.closeApp()" style="background:#c0392b; color:white; border:none; padding:12px 15px; cursor:pointer; font-weight:bold; border-radius:5px; flex:1; box-shadow:0 4px 6px rgba(0,0,0,0.3);"><i class="fas fa-power-off"></i> UKONČIT APLIKACI</button>
                </div>
                `;
            }
        } 
        else if (isVersionBlock) {
            if (msgEl && !msgEl.innerHTML.includes('ADMIN BYPASS')) {
                msgEl.innerHTML += `
                <br><br>
                <div style="display:flex; gap:15px; justify-content:center; margin-top:20px; padding-top:15px; border-top:1px solid rgba(255,255,255,0.1);">
                    <button data-custom-btn="true" onclick="window.closeApp()" style="background:#c0392b; color:white; border:none; padding:12px 15px; cursor:pointer; font-weight:bold; border-radius:5px; flex:1; box-shadow:0 4px 6px rgba(0,0,0,0.3);"><i class="fas fa-power-off"></i> UKONČIT</button>
                    <button data-custom-btn="true" onclick="window.requestAdminBypass()" style="background:#f59e0b; color:black; border:none; padding:12px 15px; cursor:pointer; font-weight:bold; border-radius:5px; flex:1; box-shadow:0 4px 6px rgba(0,0,0,0.3);"><i class="fas fa-unlock"></i> ADMIN BYPASS</button>
                </div>
                `;
            }
        }
        
        if (modalEl) modalEl.style.display = 'flex';
        let loadEl = document.getElementById('loadingScreen');
        if (loadEl) loadEl.style.display = 'none';
        window.syncDom();
    } catch(err) {}
};

window.closeErrorModal = function() {
    window.playClick(); 
    let modalEl = document.getElementById('error-modal');
    if (modalEl) modalEl.style.display = 'none'; 
    if (appState === 'LOGIN_WAITING') {
        window.resetLoginFlow();
    } else if (appState === 'LOGIN_DISCORD') {
        let inputEl = document.getElementById('login-identifier-input');
        if (inputEl) inputEl.focus();
    }
    window.syncDom();
};

window.padTime = function(t) { 
    if(!t) return t; 
    let str = t.toString();
    if(!str.includes(':')) return str; 
    let p = str.split(':'); 
    let res = (p[0].length === 1 ? '0'+p[0] : p[0]) + ':' + (p[1].length === 1 ? '0'+p[1] : p[1]); 
    if (p[2]) res += ':' + (p[2].length === 1 ? '0'+p[2] : p[2]); 
    return res; 
};

window.timeToMins = function(t) { 
    if(!t) return 0; 
    let str = t.toString();
    if(!str.includes(':')) return 0; 
    let p = str.split(':'); 
    return parseInt(p[0]) * 60 + parseInt(p[1]); 
};

window.minsToTime = function(m) { 
    let h = Math.floor(m / 60) % 24; 
    let mn = m % 60; 
    if (h < 0) h += 24; 
    if (mn < 0) mn += 60; 
    return (h < 10 ? '0'+h : h) + ':' + (mn < 10 ? '0'+mn : mn); 
};

window.isModalOpen = function() { 
    return document.getElementById('funk-modal').style.display === 'flex' || 
           document.getElementById('settings-modal').style.display === 'flex' || 
           document.getElementById('error-modal').style.display === 'flex' || 
           document.getElementById('supporters-modal').style.display === 'flex' ||
           document.getElementById('feedback-modal').style.display === 'flex' ||
           document.getElementById('debug-overlay').style.display === 'flex' ||
           document.getElementById('announcement-modal').style.display === 'flex'; 
};

window.setDelayMode = function(state) { 
    if (isDelayMode !== state) { 
        isDelayMode = state; 
        window.updateBtnState('btn-delay-mode', isDelayMode); 
    } 
};

function safeGetHWID() {
    return Promise.race([
        ipcRenderer.invoke('get-hwid'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout HWID')), 3000))
    ]);
}

window.addEventListener('beforeunload', () => {
    window.submitStats(); // Záznam statistik při vypnutí
    if (!appState.startsWith('LOGIN') && appState !== 'LOCKED' && storedDiscordId) {
        fetchBlesk(`${API_BASE}/api/app_ping`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ discord_id: storedDiscordId, action: 'stop', session_id: currentSessionId }),
            keepalive: true
        }, 3000).catch(e=>{});
    }
});

// --- AGRESIVNÍ SYSTÉM OZNÁMENÍ ---
window.checkAnnouncementsFromWeb = async function(discordId, appId) {
    try {
        if (!discordId) return;
        
        let loadEl = document.getElementById('loadingScreen');
        let msgEl = document.getElementById('loading-msg');
        if(loadEl && msgEl) {
            msgEl.textContent = "KONTROLA OZNÁMENÍ...";
            loadEl.style.zIndex = "999999"; 
            loadEl.style.display = 'flex';
            window.syncDom();
        }

        const response = await fetchBlesk(`${API_BASE}/api/get_messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: discordId, app_id: appId })
        }, 5000);
        
        if(loadEl && msgEl) {
            loadEl.style.display = 'none';
            msgEl.textContent = "NAČÍTÁM DATA...";
            loadEl.style.zIndex = "50000";
            window.syncDom();
        }

        const resData = await response.json();
        
        if (resData.messages && resData.messages.length > 0) {
            window.announcementList = resData.messages;
            window.showAnnouncement(0);
        }
    } catch (e) {
        debugLog("Nepodařilo se zkontrolovat oznámení z webu.");
        let loadEl = document.getElementById('loadingScreen');
        if(loadEl) {
            loadEl.style.display = 'none';
            loadEl.style.zIndex = "50000";
        }
        window.syncDom();
    }
};

window.showAnnouncement = function(index) {
    if (!window.announcementList || index >= window.announcementList.length) return;
    const msg = window.announcementList[index];
    
    currentAnnouncementId = msg.id;
    currentAnnouncementIndex = index;
    
    let titleEl = document.getElementById('announcement-title');
    let textEl = document.getElementById('announcement-text');
    let btnEl = document.getElementById('announcement-link-btn');
    
    if (titleEl) titleEl.innerText = msg.title;
    if (textEl) textEl.innerHTML = msg.content;
    
    if (btnEl) {
        if (msg.link_url && msg.link_url.trim() !== '') {
            btnEl.style.display = 'block';
            btnEl.setAttribute('data-url', msg.link_url);
        } else {
            btnEl.style.display = 'none';
        }
    }
    
    document.getElementById('announcement-modal').style.display = 'flex';
    window.syncDom();
};

window.openAnnouncementLink = function() {
    window.playClick();
    let btnEl = document.getElementById('announcement-link-btn');
    if (btnEl && btnEl.getAttribute('data-url')) {
        require('electron').shell.openExternal(btnEl.getAttribute('data-url'));
    }
};

window.closeAnnouncement = function() {
    window.playClick();
    document.getElementById('announcement-modal').style.display = 'none';
    
    if (currentAnnouncementId && storedDiscordId) {
        fetchBlesk(`${API_BASE}/api/mark_message_read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: storedDiscordId, message_id: currentAnnouncementId })
        }, 4000).catch(() => {});
    }
    
    window.syncDom();
    window.showAnnouncement(currentAnnouncementIndex + 1);
};

window.openFeedback = function(type) {
    window.playClick();
    
    let errMod = document.getElementById('error-modal');
    if (errMod && errMod.style.display === 'flex') { errMod.style.display = 'none'; }
    
    let setMod = document.getElementById('settings-modal');
    if (setMod && setMod.style.display === 'flex') { setMod.style.display = 'none'; }

    let mod = document.getElementById('feedback-modal');
    if (mod) mod.style.display = 'flex';
    
    document.getElementById('fb-type').value = type;
    document.getElementById('fb-text').value = ''; 
    
    let dId = localStorage.getItem('discordId') || storedDiscordId || 'Není zadáno';
    let nick = localStorage.getItem('discordNick') || 'Neznámý Uživatel';
    
    let inEl = document.getElementById('login-identifier-input');
    if (dId === 'Není zadáno' && inEl && inEl.value) { dId = inEl.value; nick = inEl.value; }
    
    document.getElementById('fb-nick').textContent = nick;
    document.getElementById('fb-id').textContent = dId;
    
    if (type === 'HWID') {
        document.getElementById('fb-text').placeholder = "Žádám o reset HWID k tomuto účtu z důvodu: \n(Napište důvod - např. nový počítač, reinstalace Windows...)";
    } else {
        document.getElementById('fb-text').placeholder = "Napište svou zprávu, návrh na zlepšení nebo žádost zde...";
    }
    window.syncDom();
};

window.submitFeedback = async function() {
    window.playClick();
    let text = document.getElementById('fb-text').value.trim();
    let type = document.getElementById('fb-type').value;
    
    let dId = localStorage.getItem('discordId') || storedDiscordId;
    let nick = localStorage.getItem('discordNick') || 'Neznámý Uživatel';
    
    let inEl = document.getElementById('login-identifier-input');
    if (!dId && inEl && inEl.value) { dId = inEl.value; nick = inEl.value; }
    
    if (!dId || dId.toLowerCase() === "není zadáno" || dId.toLowerCase() === "none" || dId.trim() === "") {
        return window.showErrorModal("CHYBÍ ÚDAJE", "Systém ztratil vaše identifikační údaje (např. z důvodu nepodporovaných znaků v nicku).\n\nAbychom váš účet našli, musíte ZAVŘÍT toto okno, vrátit se k žádosti a NAPSAT SVÉ ČÍSELNÉ DISCORD ID přímo do textu zprávy!", false, 'warning');
    }

    if (!text) return window.showErrorModal("CHYBA", "Zpráva nemůže být prázdná.");

    let loadEl = document.getElementById('loadingScreen');
    if (loadEl) loadEl.style.display = 'flex';
    window.syncDom();

    try {
        let res = await fetchBlesk(`${API_BASE}/api/submit_feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: dId, nick: nick, type: type, message: text })
        }, 6000);
        
        if (loadEl) loadEl.style.display = 'none';
        let data = await res.json();
        
        if (data.status === 'success') {
            document.getElementById('feedback-modal').style.display = 'none';
            window.syncDom();
            if (type === 'HWID') {
                let hwidScr = document.getElementById('hwid-success-screen');
                if (hwidScr) hwidScr.style.display = 'flex';
            } else {
                setTimeout(() => { 
                    alert("Úspěšně odesláno! Děkujeme za zpětnou vazbu."); 
                }, 100);
            }
        } else {
            window.showErrorModal("CHYBA", "Odeslání selhalo: " + data.message);
        }
    } catch(e) {
        if (loadEl) loadEl.style.display = 'none';
        window.showErrorModal("CHYBA SPOJENÍ", "Nelze se spojit se serverem. Zkontrolujte připojení.");
    }
};

window.closeApp = function() {
    window.playClick();
    window.submitStats(); // Záznam statistik při vypnutí
    try {
        ipcRenderer.send('quit-app');
    } catch(e) {}
    window.close();
};

window.requestAdminBypass = async function() {
    window.playClick();
    let dId = localStorage.getItem('discordId') || storedDiscordId;
    let nick = localStorage.getItem('discordNick') || 'Neznámý Uživatel';
    
    let inEl = document.getElementById('login-identifier-input');
    if (!dId && inEl && inEl.value) { 
        dId = inEl.value; 
        nick = inEl.value; 
    }
    
    if (!dId || dId.toLowerCase() === "není zadáno" || dId.toLowerCase() === "none") {
        alert("Nejprve prosím zadejte své číslo ID nebo jednoduchý Nick (bez emoji) do políčka, abychom věděli, pro koho žádost poslat.");
        window.closeErrorModal();
        return;
    }

    let loadEl = document.getElementById('loadingScreen');
    if (loadEl) { 
        loadEl.style.display = 'flex'; 
        window.syncDom(); 
    }

    try {
        let res = await fetchBlesk(`${API_BASE}/api/submit_feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: dId, nick: nick, type: 'ADMIN_BYPASS', message: 'Žádost o jednorázový Admin Bypass pro starou verzi.' })
        }, 6000);
        if (loadEl) loadEl.style.display = 'none';
        let data = await res.json();
        
        if (data.status === 'success') {
            alert("Žádost úspěšně odeslána! Jakmile ji administrátor na webu schválí, zkuste se přihlásit znovu. Bude vám povolen jednorázový vstup.");
            window.closeApp();
        } else {
            alert("Chyba při odesílání: " + data.message);
        }
    } catch(e) {
        if (loadEl) loadEl.style.display = 'none';
        alert("Nelze se spojit se serverem. Zkontrolujte připojení k internetu.");
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    debugLog("DOM Načten, startuji IPC komunikaci a otevírám bootovací obrazovku.");
    
    // --- VIZUÁLNÍ INJEKCE PRO IDPK (BEZ ZVUKU) ---
    setTimeout(() => {
        let allEls = document.querySelectorAll('*');
        allEls.forEach(el => {
            if(el.getAttribute('onclick') && el.getAttribute('onclick').includes('switchToIdpkMode')) {
                if(!el.innerHTML.includes('bez zvuku')) {
                    el.innerHTML += " <span style='font-size:10px; color:#f59e0b;'>(bez zvuku)</span>";
                }
            }
        });
        
        // --- INJEKCE TLAČÍTKA NA KOPÍROVÁNÍ LOGU ---
        let debugWrap = document.getElementById('debug-overlay');
        if (debugWrap && !document.getElementById('copy-log-btn')) {
            let btn = document.createElement('button');
            btn.id = 'copy-log-btn';
            btn.innerHTML = '<i class="fas fa-copy"></i> Zkopírovat log';
            btn.style.cssText = "margin-top:10px; width:100%; padding:10px; background:#38bdf8; border:none; color:black; font-weight:bold; border-radius:5px; cursor:pointer;";
            btn.onclick = function() {
                let dt = document.getElementById('debug-text');
                if (dt) {
                    let text = dt.innerText;
                    navigator.clipboard.writeText(text);
                    btn.innerHTML = '<i class="fas fa-check"></i> Zkopírováno!';
                    setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i> Zkopírovat log', 2000);
                }
            };
            
            // Přidáme to dovnitř debug okna, pod samotný text logu
            let dt = document.getElementById('debug-text');
            if (dt && dt.parentNode) {
                dt.parentNode.insertBefore(btn, dt.nextSibling);
            }
        }
    }, 500);

    if (isDevMode) {
        debugLog("⚠️ DETEKOVÁN VSC (VÝVOJÁŘSKÝ REŽIM) - BLOKACE IGNOROVÁNY!");
    }

    ipcRenderer.invoke('get-link-files').then(files => { 
        availableFiles = files; 
        filteredFiles = files; 
    }).catch(()=>{});
    
    ipcRenderer.invoke('gtfs-load-routes').then(db => { 
        databaseFiles = db; 
    }).catch(()=>{});

    ipcRenderer.on('trigger-key-action', (event, payload) => {
        let k = typeof payload === 'string' ? payload : payload.key;
        let c = typeof payload === 'object' ? payload.code : '';
        window.handleKeyInput(k, c);
    });

    ipcRenderer.on('update-client-state', (event, state) => {
        let dot = document.getElementById('mobile-conn-dot');
        if (state === 'disconnected' && dot) { 
            dot.style.display = 'none'; 
        } else if (dot) {
            dot.style.display = 'block';
            dot.style.backgroundColor = state === 'active' ? '#2ecc71' : '#f1c40f'; 
        }
        window.syncDom();
    });

    ipcRenderer.on('force-sync-dom', () => { 
        window.syncDom(); 
    });

    document.addEventListener('click', (e) => {
        if (appState === 'LOGIN_DISCORD' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
            let i = document.getElementById('login-identifier-input');
            if (i && !i.disabled && !window.isModalOpen()) {
                i.focus();
            }
        }
    });

    if (machineHWID === "UNKNOWN-HWID" || machineHWID === "PENDING" || !machineHWID.startsWith("PC-")) {
        try {
            let hw = await safeGetHWID();
            if (hw && hw !== "" && !hw.includes("UNKNOWN") && hw.startsWith("PC-")) {
                machineHWID = hw;
            } else {
                machineHWID = "PC-" + Math.random().toString(36).substring(2, 12).toUpperCase();
            }
        } catch(e) {
            machineHWID = "PC-" + Math.random().toString(36).substring(2, 12).toUpperCase();
        }
        localStorage.setItem('device_hwid', machineHWID);
    }
    
    debugLog("Unikátní HWID tohoto PC je: " + machineHWID);

    let startEl = document.getElementById('startupScreen');
    if (startEl) startEl.style.display = 'flex';
    ipcRenderer.send('panel-boot');

    let pripojeni = await zanalyzujPripojeni();
    let isServerOnline = (pripojeni.status === "OK");
    let ksStatus = 'enabled';

    if (isServerOnline) {
        try {
            const res = await fetchBlesk(`${API_BASE}/api/status`, { method: 'GET' }, 4000);
            const data = await res.json();
            ksStatus = data.status;
            localStorage.setItem('lastKillSwitchState', ksStatus);
            let userFriendlyStatus = (ksStatus === 'enabled') ? 'V pořádku (Aplikace povolena)' : 'UZAMČENO (Aplikace blokována)';
            debugLog("Server je online. Kill-Switch stav: " + userFriendlyStatus);
        } catch (e) {
            isServerOnline = false;
        }
    }

    if (!isServerOnline) {
        ksStatus = localStorage.getItem('lastKillSwitchState') || 'enabled';
        debugLog("Server nedostupný (offline). Poslední známý stav KS: " + ksStatus);
        
        if (pripojeni.status === "BLOCKED_BY_FIREWALL") {
            window.showErrorModal("ZABLOKOVÁNO ANTIVIREM", pripojeni.zprava, false, 'warning');
        } else {
            window.showErrorModal("INFORMAČNÍ SYSTÉM", pripojeni.zprava, false, 'info');
        }
    }

    if (ksStatus === 'disabled') {
        if (isDevMode) {
            debugLog("⚠️ VSC REŽIM: Ignoruji Globální Kill-Switch!");
        } else {
            if (startEl) startEl.style.display = 'none';
            appState = 'LOCKED';
            sessionStorage.removeItem('softResetState'); 
            
            if (!isServerOnline) {
                window.showErrorModal("SYSTÉM UZAMČEN", "Při posledním připojení byl software GLOBÁLNĚ VYPNUT. Pro odemčení se musíte připojit k internetu.", true, 'error');
            } else {
                window.showErrorModal("SYSTÉM UZAMČEN", "SOFTWARE JE NYNÍ GLOBÁLNĚ VYPNUT (ÚDRŽBA).", true, 'error');
            }
            return; 
        }
    }

    const savedStateStr = sessionStorage.getItem('softResetState');
    if (savedStateStr) {
        sessionStorage.removeItem('softResetState'); 
        const state = JSON.parse(savedStateStr);
        
        appState = state.appState; 
        inputValues = state.inputValues;
        linkospojFocus = state.linkospojFocus; 
        isListOpen = state.isListOpen; 
        selectedIdpkRouteId = state.selectedIdpkRouteId;
        selectedStartStop = state.selectedStartStop; 
        selectedDestination = state.selectedDestination;
        currentHybridTemplate = state.currentHybridTemplate; 
        routeData = state.routeData;
        drivePhase = state.drivePhase; 
        stopSelectionBuffer = state.stopSelectionBuffer; 
        stopPressed = state.stopPressed;
        isDelayMode = state.isDelayMode; 
        isTimeBasedAuto = state.isTimeBasedAuto; 
        isClassicAuto = state.isClassicAuto;
        isDelayAuto = state.isDelayAuto; 
        isRandomContinue = state.isRandomContinue; 
        classicAutoDelay = state.classicAutoDelay;
        useFictionalTime = state.useFictionalTime; 
        fictionalTimeOffset = state.fictionalTimeOffset;
        currentGlobalDelay = state.currentGlobalDelay; 
        lockedAutoDelayMins = state.lockedAutoDelayMins;
        lockedAutoStartTimeMins = state.lockedAutoStartTimeMins;
        storedDiscordId = localStorage.getItem('discordId') || "";
        storedAppId = localStorage.getItem('appId') || "";

        if (startEl) {
            startEl.style.display = 'none';
        }
        
        document.querySelectorAll('.login-view').forEach(v => { 
            v.style.display = 'none'; 
        });

        ipcRenderer.send('open-panel-window');

        if (appState === 'DRIVE') {
            window.switchToDriveScreen();
            setTimeout(() => window.sendDataToPanel(drivePhase === 1), 1000);
        } else if (appState === 'LINKOSPOJ') {
            window.switchToLinkospojScreen();
            ipcRenderer.send('panel-idle');
        } else {
            window.switchToIdpkMode();
            ipcRenderer.send('panel-idle');
        }
        window.startPingLoop();
        
        if (storedDiscordId && isServerOnline) {
            let loadEl = document.getElementById('loadingScreen');
            let msgEl = document.getElementById('loading-msg');
            if(loadEl && msgEl) {
                msgEl.textContent = "OBNOVA SYSTÉMU...";
                loadEl.style.zIndex = "999999"; 
                loadEl.style.display = 'flex';
            }
            setTimeout(() => {
                window.checkAnnouncementsFromWeb(storedDiscordId, storedAppId);
            }, 4000);
        }
    } else {
        window.initAppFlow(isServerOnline);
    }

    setInterval(window.timeLoop, 1000);
});

window.toggleSettings = function() { 
    window.playClick(); 
    let el = document.getElementById('settings-modal');
    let authOnly = document.getElementById('auth-only-settings');

    if (el) { 
        if (el.style.display === 'flex') {
            el.style.display = 'none';
        } else {
            if (authOnly) {
                if (appState.startsWith('LOGIN') || appState === 'BOOT' || appState === 'LOCKED') {
                    authOnly.style.display = 'none';
                } else {
                    authOnly.style.display = 'flex';
                }
            }
            el.style.display = 'flex';
        }
    }
    window.syncDom(); 
};

window.fullReset = function() { 
    window.playClick(); 
    location.reload(); 
};

window.softReset = function() {
    if (appState === 'LOCKED') return; 
    window.playClick();
    window.submitStats(); // Záznam statistik při restartu
    
    const stateToSave = {
        appState, inputValues, linkospojFocus, isListOpen, selectedIdpkRouteId,
        selectedStartStop, selectedDestination, currentHybridTemplate, routeData,
        drivePhase, stopSelectionBuffer, stopPressed, isDelayMode, isTimeBasedAuto, isClassicAuto,
        isDelayAuto, isRandomContinue, classicAutoDelay, useFictionalTime, fictionalTimeOffset,
        currentGlobalDelay, lockedAutoDelayMins, lockedAutoStartTimeMins
    };
    sessionStorage.setItem('softResetState', JSON.stringify(stateToSave));
    localStorage.setItem('currentSessionId', currentSessionId);
    location.reload(); 
};

window.refreshPanel = function() { 
    window.playClick(); 
    ipcRenderer.send('reload-panel-window'); 
    setTimeout(() => { 
        if(appState === 'DRIVE') {
            window.sendDataToPanel(drivePhase === 1); 
        } else {
            ipcRenderer.send('reset-panel'); 
        }
    }, 2000); 
};

// --- PŮVODNÍ OKNO ZASTÁVEK STOP ---
window.openStopWindow = function() { 
    window.playClick(); 
    ipcRenderer.send('open-stop-window'); 
    window.toggleSettings(); 
};

// ==========================================
// BUSE PANEL LOGIKA (PŘIDÁNO PRO V1.6 RC-EDITION)
// ==========================================

// Nová funkce pro otevření okna s BUSE panelem (z menu ozubeného kolečka)
window.openBusePanel = function() {
    window.playClick();
    window.open('buse.html', 'BUSE_PANEL', 'width=1200,height=300,menubar=no,toolbar=no,location=no,status=no');
    window.toggleSettings(); // Zavře menu po kliknutí
};

// ==========================================
// POKRAČOVÁNÍ PŮVODNÍHO KÓDU...
// ==========================================

window.openSupporters = async function() {
    window.playClick();
    let mod = document.getElementById('supporters-modal');
    if(mod) mod.style.display = 'flex';
    
    let list = document.getElementById('supporters-list');
    if(list) list.innerHTML = '<div style="color:#aaa; text-align:center; padding-top:20px;">Stahuji data z databáze...<div class="spinner" style="margin:20px auto; width:20px; height:20px; border-width:3px;"></div></div>';
    
    window.syncDom();

    try {
        let res = await fetchBlesk(`${API_BASE}/api/supporters`, { method: 'GET' }, 8000);
        if (!res.ok) throw new Error("Chyba spojení");
        
        let data = await res.json();
        let sups = data.supporters || data.data || data; 
        
        if (Array.isArray(sups) && sups.length > 0) {
            let htmlStr = "";
            sups.forEach(sup => {
                let name = sup.name || "Anonymní podpora";
                let tier = sup.tier || 1;
                let cardBaseStyle = "box-sizing: border-box; max-width: 100%; word-wrap: break-word; overflow-wrap: break-word; width: 100%; ";
                let cardStyle, nameStyle, titleBadge, amtStyle;

                if (tier === 3) {
                    cardStyle = cardBaseStyle + "border: 2px solid #ff3333; box-shadow: 0 0 30px rgba(255, 51, 51, 0.8); background: linear-gradient(135deg, #330000, #660000); animation: pulseExtreme 1.5s infinite alternate; padding: 20px;";
                    nameStyle = "color: #fff; text-shadow: 0 0 15px #ff3333, 0 0 30px #ff3333; font-size: 22px; font-weight: 900; text-transform: uppercase;";
                    titleBadge = "<div style='color:#ff3333; font-size:10px; font-weight:bold; letter-spacing:2px; margin-bottom:5px; text-shadow:0 0 5px #ff3333;'>MEGA PODPOROVATEL</div>";
                    amtStyle = "background:#ff3333; color:#fff; padding:6px 12px; border-radius:15px; font-weight:bold; font-size:15px; box-shadow:0 0 15px #ff3333; border: 1px solid #fff;";
                } else if (tier === 2) {
                    cardStyle = cardBaseStyle + "border: 1px solid #f59e0b; box-shadow: 0 0 15px rgba(245, 158, 11, 0.5); background: linear-gradient(135deg, #0f172a, #332200); padding: 15px; animation: pulseMedium 2s infinite alternate;";
                    nameStyle = "color: #fcd34d; font-size: 18px; font-weight: bold; text-shadow: 0 0 8px rgba(245, 158, 11, 0.8);";
                    titleBadge = "<div style='color:#f59e0b; font-size:9px; font-weight:bold; letter-spacing:1px; margin-bottom:5px;'>VELKÝ PODPOROVATEL</div>";
                    amtStyle = "background:rgba(245, 158, 11, 0.2); color:#fcd34d; padding:4px 10px; border-radius:12px; font-weight:bold; font-size:14px; border:1px solid #f59e0b; box-shadow:0 0 10px rgba(245, 158, 11, 0.4);";
                } else {
                    cardStyle = cardBaseStyle + "border: 1px solid #38bdf8; background: rgba(15, 23, 42, 0.8); border-left: 4px solid #38bdf8; padding: 12px;";
                    nameStyle = "color: #e0f2fe; font-size: 15px; font-weight: bold; text-shadow: 0 0 5px rgba(56, 189, 248, 0.5);";
                    titleBadge = "<div style='color:#38bdf8; font-size:8px; font-weight:bold; margin-bottom:3px;'>PODPOROVATEL</div>";
                    amtStyle = "background:rgba(56, 189, 248, 0.1); color:#38bdf8; padding:3px 8px; border-radius:10px; font-weight:bold; font-size:12px; border:1px solid #38bdf8;";
                }

                htmlStr += `
                <div style="margin-bottom:20px; border-radius:10px; transition:0.3s; display:flex; flex-direction:column; align-items:center; text-align:center; ${cardStyle}">
                    ${titleBadge}
                    <div style="${nameStyle}; margin-bottom:10px;">${name}</div>
                    <div style="${amtStyle}">${sup.amount}</div>
                    ${sup.message ? `<div style="color:white; font-size:13px; font-style:italic; line-height:1.5; background:rgba(0,0,0,0.3); padding:10px; margin-top:10px; border-radius:6px; border-left:2px solid rgba(255,255,255,0.2); width:100%; box-sizing:border-box; word-wrap:break-word;">"${sup.message}"</div>` : ''}
                    <div style="color:#aaa; font-size:10px; text-align:center; margin-top:10px; padding-top:5px; border-top:1px solid rgba(255,255,255,0.05); width:100%;">${sup.created_at || ''}</div>
                </div>`;
            });
            list.innerHTML = htmlStr;
        } else {
            list.innerHTML = '<div style="color:#aaa; text-align:center; padding-top:20px;">Zatím žádní podporovatelé. Buďte první!</div>';
        }
    } catch(e) {
        if(list) {
            list.innerHTML = `<div style="color:#e74c3c; text-align:center; padding-top:20px; font-weight:bold;">Chyba načítání dat.<br><br><span style="font-size:10px; color:#aaa;">Data ze serveru se zatím nepodařilo získat.</span></div>`;
        }
    }
    window.syncDom();
};

window.closeSupporters = function() {
    window.playClick();
    let mod = document.getElementById('supporters-modal');
    if(mod) mod.style.display = 'none';
    window.syncDom();
};

window.switchLoginView = function(viewId) {
    try {
        document.querySelectorAll('.login-view').forEach(v => { 
            v.style.display = 'none'; 
        });
        
        let viewEl = document.getElementById(viewId);
        if (viewEl) viewEl.style.display = 'flex';
        
        let keypad = document.getElementById('main-keypad');
        
        if (viewId === 'login-pin-view') {
            if (keypad) keypad.style.display = 'grid';
            let delKey = document.getElementById('key-del');
            if (delKey) delKey.style.display = 'flex';
            let funkKey = document.getElementById('key-funk');
            if (funkKey) funkKey.style.display = 'none';
            
            let hwidPin = document.getElementById('hwid-display-pin');
            if (hwidPin) hwidPin.textContent = "HWID: " + machineHWID;

        } else if (viewId === 'login-discord-view') {
            if (keypad) keypad.style.display = 'none';
            setTimeout(() => {
                let inputEl = document.getElementById('login-identifier-input');
                if (inputEl) {
                    inputEl.disabled = false;
                    inputEl.focus();
                }
            }, 100);
        } else if (viewId === 'login-auto-view') {
            if (keypad) keypad.style.display = 'none';
            let hwidAuto = document.getElementById('hwid-display-auto');
            if (hwidAuto) hwidAuto.textContent = "HWID: " + machineHWID;
        } else {
            if (keypad) keypad.style.display = 'none';
        }
        window.syncDom();
    } catch(err) {
        window.onerror("Chyba přepínání pohledů: " + err.message, "", 0, 0, err);
    }
}

window.initAppFlow = async function(isServerOnline = true) {
    let startEl = document.getElementById('startupScreen');
    if (startEl) startEl.style.display = 'none';

    // Přečíst config.json z AppData (kam ho uložil Launcher)
    const fs = require('fs');
    const os = require('os');
    const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
    const configPath = path.join(userDataPath, 'config.json');

    let config = {};
    if (fs.existsSync(configPath)) {
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e){}
    }
    
    storedDiscordId = config.discord_id || "";
    let storedNick = config.discord_nick || "Řidič";
    
    if (isDevMode && !storedDiscordId) {
        storedDiscordId = "VSC-DEV";
        storedNick = "VÝVOJÁŘ";
    }

    if (!storedDiscordId) {
        alert("CHYBA: Přihlášení vypršelo nebo chybí data.\n\nSpouštím IDPK Launcher pro nové přihlášení...");
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('fallback-to-launcher');
        return;
    }

    // Můžeme si do configu v budoucnu uložit i appId nebo hwid

    debugLog("Nahrávání grafiky na druhý monitor...");
    let loadEl = document.getElementById('loadingScreen');
    let msgEl = document.getElementById('loading-msg');
    if(loadEl && msgEl) {
        if (isDevMode) {
            msgEl.innerHTML = "<span style='color:#f1c40f; font-weight:bold;'>VSC MODE AKTIVNÍ</span><br><br>Přeskakuji ověření a administrátorské zámky...";
        } else {
            msgEl.textContent = "NAHRÁVÁNÍ GRAFIKY NA DRUHÝ MONITOR...";
        }
        loadEl.style.zIndex = "999999"; 
        loadEl.style.display = 'flex';
    }
    window.syncDom();

    ipcRenderer.send('reload-panel-window');
    
    let bootDelay = isDevMode ? 2000 : 0;
    
    setTimeout(() => {
        ipcRenderer.send('open-panel-window');
        ipcRenderer.send('panel-idle');
        
        setTimeout(() => {
            if(loadEl) loadEl.style.display = 'none';
            window.switchToLinkospojScreen();
            
            // Ping na server s action: start
            if (storedDiscordId && isServerOnline) {
                if (!isDevMode || (isDevMode && storedDiscordId !== "VSC-DEV")) {
                    debugLog("✅ Přihlašovací data z Launcheru byla úspěšně nalezena a použita.");
                }
                
                fetch(`${API_BASE}/api/app_ping`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ discord_id: storedDiscordId, action: 'start', app_version: APP_VERSION }) 
                }).then(r => r.json()).then(data => {
                    if (data.status === 'error' && !isDevMode) {
                        alert("CHYBA: Přihlášení vypršelo nebo server účet nerozpoznal.\n\nSpouštím IDPK Launcher pro nové přihlášení...");
                        
                        // Smazat data, aby Launcher zobrazil přihlašovací obrazovku
                        const fs = require('fs');
                        const os = require('os');
                        const path = require('path');
                        const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
                        const configPath = path.join(userDataPath, 'config.json');
                        let config = {};
                        if (fs.existsSync(configPath)) {
                            try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e){}
                        }
                        config.discord_id = "";
                        config.discord_nick = "";
                        config.email = "";
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

                        const { ipcRenderer } = require('electron');
                        ipcRenderer.send('fallback-to-launcher');
                        return;
                    }
                    if(data.session_id) {
                        currentSessionId = data.session_id;
                        localStorage.setItem('currentSessionId', currentSessionId);
                        window.startPingLoop(); 
                    } else {
                        window.startPingLoop(); 
                    }
                }).catch(e => {
                    debugLog("Chyba při startu session ping: " + e);
                    window.startPingLoop(); 
                });
            } else {
                window.startPingLoop(); 
            }
            
            setTimeout(() => {
                if (storedDiscordId && isServerOnline) {
                    window.checkAnnouncementsFromWeb(storedDiscordId, storedAppId);
                }
            }, 3000);
            
        }, 100);
    }, bootDelay);
}
    } catch(err) {}
}

window.resetLoginFlow = function() {
    window.playClick();
    if(discordPollInterval) clearInterval(discordPollInterval);
    appState = 'LOGIN_DISCORD';
    inputValues.discordId = "";
    let el = document.getElementById('login-identifier-input');
    if(el) { 
        el.value = ""; 
        el.disabled = false; 
    }
    window.switchLoginView('login-discord-view');
}

window.startDiscordAuth = async function() {
    try {
        debugLog("Odesílám ověření pro HWID: " + machineHWID);
        const inputEl = document.getElementById('login-identifier-input');
        if (!inputEl) return;
        
        const val = inputEl.value.trim();
        if (!val || val === "") {
            window.showErrorModal("CHYBÍ ÚDAJE", "Zadejte prosím své ID nebo Nick.", false, 'warning');
            return;
        }

        let pripojeni = await zanalyzujPripojeni();
        if (pripojeni.status !== "OK") {
            if (pripojeni.status === "BLOCKED_BY_FIREWALL") {
                window.showErrorModal("ZABLOKOVÁNO ANTIVIREM", "Pro první přihlášení přes Discord je vyžadováno spojení se serverem, ale to je <b>blokováno vaším Antivirem nebo Firewallem!</b><br><br>Prosím, přidejte aplikaci do výjimek a zkuste to znovu.", false, 'warning');
            } else {
                window.showErrorModal("CHYBÍ PŘIPOJENÍ", "Pro první přihlášení (spárování účtu) je <b>vyžadován funkční internet</b>.<br><br>" + pripojeni.zprava, false, 'info');
            }
            window.resetLoginFlow();
            return;
        }
        
        appState = 'LOGIN_WAITING';
        window.switchLoginView('login-waiting-view');

        const res = await fetchBlesk(`${API_BASE}/api/app_login`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: val, hwid: machineHWID, app_version: APP_VERSION })
        }, 6000);
        
        const textData = await res.text();
        let data;
        try {
            const fixedText = textData.replace(/"discord_id":\s*(\d+)/g, '"discord_id": "$1"');
            data = JSON.parse(fixedText);
        } catch(parseErr) {
            window.showErrorModal("CHYBA SERVERU", "Aplikace nemůže přečíst API. Zkuste zadat přímo číslo ID.", false, 'error');
            return;
        }

        if (isDevMode && data.status === 'error') {
            debugLog("⚠️ VSC REŽIM: Ignoruji blokaci při přihlášení (" + data.message + ")");
            data.status = 'success';
            data.discord_id = val; 
            data.discord_nick = "VSC-DEV";
        }
        
        if (data.status === 'success') {
            storedDiscordId = data.discord_id;
            storedNick = data.discord_nick || data.discord_id;
            localStorage.setItem('discordId', storedDiscordId);
            localStorage.setItem('discordNick', storedNick);
            window.playClick();
            appState = 'LOGIN_SETUP_CHOICE';
            window.switchLoginView('login-setup-view');
        } else if (data.status === 'waiting') {
            storedDiscordId = data.discord_id;
            discordPollInterval = setInterval(() => window.pollDiscordAuth(), 2000);
        } else if (data.status === 'error') {
            let isVerError = data.message && (data.message.toLowerCase().includes('verz') || data.message.toLowerCase().includes('podporována') || data.message.includes('VYPNUT'));
            window.showErrorModal("PŘÍSTUP ODEPŘEN", data.message, isVerError, 'error');
            window.resetLoginFlow();
        } else {
            window.showErrorModal("PŘÍSTUP ODEPŘEN", data.message || "Chybné jméno nebo HWID.", false, 'error');
            window.resetLoginFlow();
        }
    } catch(e) {
        window.showErrorModal("CHYBA SPOJENÍ", "Při pokusu o přihlášení došlo k výpadku sítě.", false, 'error');
        window.resetLoginFlow();
    }
}

window.pollDiscordAuth = async function() {
    try {
        const res = await fetchBlesk(`${API_BASE}/api/app_check`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: storedDiscordId, hwid: machineHWID })
        }, 4000);
        const data = await res.json();
        
        if (data.status === 'success' || isDevMode) {
            if (isDevMode && data.status !== 'success') {
                debugLog("⚠️ VSC REŽIM: Ignoruji chybu Discord Pollingu.");
            }
            clearInterval(discordPollInterval);
            localStorage.setItem('discordId', storedDiscordId);
            localStorage.setItem('discordNick', data.display_name || "VSC_DEV");
            if (data.app_id) {
                storedAppId = data.app_id;
                localStorage.setItem('appId', storedAppId);
            }
            appState = 'LOGIN_SETUP_CHOICE';
            window.switchLoginView('login-setup-view');
        } else if (data.status === 'error') {
            clearInterval(discordPollInterval);
            window.showErrorModal("OVĚŘENÍ SELHALO", data.message || "Zamítnuto v aplikaci Discord.", false, 'error');
        }
    } catch(e) {}
}

window.selectLoginMethod = function(mode) {
    window.playClick();
    if (mode === 'AUTO') {
        localStorage.setItem('loginMode', 'AUTO');
        window.finalizeLogin();
    } else {
        appState = 'LOGIN_PIN_SETUP';
        inputValues.pinSetup = "";
        window.updatePinVisuals('pinSetup');
        let txt = document.getElementById('pin-header-text');
        if(txt) txt.textContent = "VYTVOŘTE NOVÝ PIN";
        let cancelBtn = document.getElementById('pin-cancel-btn');
        if(cancelBtn) cancelBtn.style.display = 'none'; 
        window.switchLoginView('login-pin-view');
    }
}

window.updatePinVisuals = function(target) {
    const val = inputValues[target];
    for(let i=1; i<=4; i++) {
        let dot = document.getElementById('pin-'+i);
        if (!dot) continue;
        if (i <= val.length) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    }
}

window.submitPinNumber = function(numStr) {
    if (appState === 'LOGIN_PIN_SETUP') {
        if (inputValues.pinSetup.length < 4) { 
            inputValues.pinSetup += numStr; 
        }
        window.updatePinVisuals('pinSetup');
        
        if (inputValues.pinSetup.length === 4) {
            localStorage.setItem('loginMode', 'PIN');
            localStorage.setItem('savedPin', inputValues.pinSetup);
            window.finalizeLogin();
        }
    } else if (appState === 'LOGIN_PIN_ENTER') {
        if (inputValues.pinEnter.length < 4) { 
            inputValues.pinEnter += numStr; 
        }
        window.updatePinVisuals('pinEnter');
        
        if (inputValues.pinEnter.length === 4) {
            if (inputValues.pinEnter === localStorage.getItem('savedPin')) {
                window.finalizeLogin();
            } else {
                inputValues.pinEnter = "";
                let hdr = document.getElementById('pin-header-text');
                if(hdr) { 
                    hdr.textContent = "NESPRÁVNÝ PIN!"; 
                    hdr.style.color = "#e74c3c"; 
                }
                window.updatePinVisuals('pinEnter');
                setTimeout(() => {
                    if(hdr) { 
                        hdr.textContent = "ZADEJTE PIN"; 
                        hdr.style.color = "white"; 
                    }
                }, 1500);
            }
        }
    }
}

window.finalizeLogin = function() {
    window.playClick();
    debugLog("Přihlášení úspěšné. Otevírám druhý monitor.");
    
    let loadEl = document.getElementById('loadingScreen');
    let msgEl = document.getElementById('loading-msg');
    if(loadEl && msgEl) {
        msgEl.textContent = "NAHRÁVÁNÍ GRAFIKY NA DRUHÝ MONITOR...";
        loadEl.style.zIndex = "999999"; 
        loadEl.style.display = 'flex';
    }
    window.syncDom();

    ipcRenderer.send('reload-panel-window');
    
    setTimeout(() => {
        ipcRenderer.send('open-panel-window');
        ipcRenderer.send('panel-idle');
        
        setTimeout(() => {
            document.querySelectorAll('.login-view').forEach(v => { 
                v.style.display = 'none'; 
            });
            
            window.switchToLinkospojScreen();
            
            fetch(`${API_BASE}/api/app_ping`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ discord_id: storedDiscordId, action: 'start', app_version: APP_VERSION }) 
            }).then(r => r.json()).then(data => {
                if(data.session_id) {
                    currentSessionId = data.session_id;
                    localStorage.setItem('currentSessionId', currentSessionId);
                    window.startPingLoop(); 
                }
            }).catch(e=>{});

            if (storedDiscordId) {
                window.checkAnnouncementsFromWeb(storedDiscordId, storedAppId);
            } else {
                if(loadEl) loadEl.style.display = 'none';
                window.syncDom();
            }
        }, 2000);
    }, 1000);
}

window.backToLauncher = function() {
    window.playClick();
    
    window.submitStats(); // Záznam statistik
    
    fetch(`${API_BASE}/api/app_ping`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ discord_id: storedDiscordId, action: 'stop', session_id: currentSessionId, app_version: APP_VERSION }) 
    }).catch(e=>{});
    
    const fs = require('fs');
    const os = require('os');
    const { spawn } = require('child_process');
    const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : os.homedir();
    const configPath = path.join(userDataPath, 'config.json');
    
    let config = {};
    if (fs.existsSync(configPath)) {
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e){}
    }
    
    config.auto_launch = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    if (config.launcher_path && fs.existsSync(config.launcher_path)) {
        const proc = spawn(config.launcher_path, [], {
            detached: true,
            stdio: 'ignore'
        });
        proc.unref();
    }
    
    setTimeout(() => {
        ipcRenderer.send('quit-app');
    }, 500);
}

window.startPingLoop = function() {
    if(pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
        if (!appState.startsWith('LOGIN') && appState !== 'LOCKED' && storedDiscordId) {
            fetch(`${API_BASE}/api/app_ping`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ discord_id: storedDiscordId, action: 'ping', session_id: currentSessionId, app_version: APP_VERSION }) 
            }).catch(e=>{});
        }
    }, 60000);
}

window.updateAHIndicator = function() {
    const ind = document.getElementById('ah-indicator');
    if (ind) {
        if (isClassicAuto || isTimeBasedAuto || isDelayAuto) {
            ind.style.display = 'block';
        } else {
            ind.style.display = 'none';
        }
    }
    window.syncDom();
};

window.syncTimeWithCurrentStop = function() {
    if (!isClassicAuto || !routeData.stops || routeData.stops.length === 0) return;
    let currentStop = routeData.stops[routeData.realStopIndex];
    if (currentStop && currentStop.time) {
        let targetMins = window.timeToMins(currentStop.time);
        let now = new Date();
        let targetDate = new Date();
        targetDate.setHours(Math.floor(targetMins / 60) % 24, targetMins % 60, 0, 0);
        fictionalTimeOffset = targetDate.getTime() - now.getTime();
        useFictionalTime = true;
        window.timeLoop();
    }
};

window.timeLoop = function() {
    let now = new Date();
    if (useFictionalTime) { 
        now = new Date(now.getTime() + fictionalTimeOffset); 
    }
    
    let timeStr = window.padTime(now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }));
    let timeStrSec = window.padTime(now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    
    let liveClockEl = document.getElementById('live-clock-display');
    if(liveClockEl) {
        liveClockEl.textContent = timeStrSec;
    }

    if (appState !== 'DRIVE') {
        ipcRenderer.send('update-time-delay', { timeOnly: true, timeStr: " " });
        return;
    } else {
        ipcRenderer.send('update-time-delay', { timeOnly: true, timeStr: timeStr });
    }

    let s1 = routeData.stops[routeData.realStopIndex];
    currentGlobalDelay = 0;
    
    if (s1 && s1.time && s1.time.includes(':')) {
        let currentMins = now.getHours() * 60 + now.getMinutes();
        let s1Mins = window.timeToMins(s1.time);
        currentGlobalDelay = currentMins - s1Mins;
        if (currentGlobalDelay < -720) currentGlobalDelay += 1440; 
        if (currentGlobalDelay > 720) currentGlobalDelay -= 1440;
    }

    window.sendDataToPanel(drivePhase === 1); 
    
    if (!routeStartupWait) {
        window.checkAutoAnnounce(now, s1);
    }
};

window.sendDataToPanel = function(showBig = false) {
    const idx = routeData.realStopIndex; 
    let s1 = routeData.stops[idx] ? { ...routeData.stops[idx] } : null; 
    let s2 = routeData.stops[idx+1] ? { ...routeData.stops[idx+1] } : null; 
    let s3 = routeData.stops[idx+2] ? { ...routeData.stops[idx+2] } : null; 
    
    if (s1 && s1.time) s1.time = window.padTime(s1.time);
    if (s2 && s2.time) s2.time = window.padTime(s2.time);
    if (s3 && s3.time) s3.time = window.padTime(s3.time);

    let est1 = null, est2 = null, est3 = null;
    let visualDelay = currentGlobalDelay;
    
    if (isDelayAuto && lockedAutoDelayMins !== null) {
        visualDelay = lockedAutoDelayMins;
    }

    if (isDelayMode && visualDelay >= 3 && s1 && s1.time) {
        if (isDelayAuto) {
            est1 = window.padTime(window.minsToTime(window.timeToMins(s1.time) + visualDelay));
        } else {
            let now = new Date();
            if (useFictionalTime) now = new Date(now.getTime() + fictionalTimeOffset);
            est1 = window.padTime(now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }));
        }
        if (s2 && s2.time) est2 = window.padTime(window.minsToTime(window.timeToMins(s2.time) + visualDelay));
        if (s3 && s3.time) est3 = window.padTime(window.minsToTime(window.timeToMins(s3.time) + visualDelay));
    }

    ipcRenderer.send('update-panel-data', { 
        line: routeData.line, 
        destination: routeData.destination, 
        stop1: s1, 
        stop2: s2, 
        stop3: s3, 
        est1: est1, 
        est2: est2, 
        est3: est3,
        showBigStop: showBig, 
        isMuted: routeData.isMuted, 
        stopPressed: stopPressed 
    });

    // --- Zápis do lokálního úložiště pro BUSE Panel ---
    try {
        localStorage.setItem('buse_data', JSON.stringify({
            line: routeData.line, 
            dest: routeData.destination
        }));
    } catch(e) {}
};

window.checkAutoAnnounce = function(now, s1) {
    if (appState !== 'DRIVE' || isAnnouncementPlaying || pendingStopSound || autoAnnounceCooldown || window.isAtEndOfRoute() || !s1 || !s1.time) return;

    let schedMins = window.timeToMins(s1.time);
    let currentMins = now.getHours() * 60 + now.getMinutes();
    let currentSecs = now.getSeconds();

    if (isTimeBasedAuto) {
        let isLate = false;
        if (drivePhase === 0 && (currentMins > schedMins || (currentMins === schedMins && currentSecs >= 0))) isLate = true;
        if (drivePhase === 1 && (currentMins > schedMins || (currentMins === schedMins && currentSecs >= 30))) isLate = true;
        if (isLate) window.triggerAutoRapid();
    } 
    else if (isDelayAuto && lockedAutoDelayMins !== null && lockedAutoStartTimeMins !== null) {
        let isLate = false;
        if (currentMins >= lockedAutoStartTimeMins) {
            if (drivePhase === 0 && (currentMins > schedMins + lockedAutoDelayMins || (currentMins === schedMins + lockedAutoDelayMins && currentSecs >= 0))) isLate = true;
            if (drivePhase === 1 && (currentMins > schedMins + lockedAutoDelayMins || (currentMins === schedMins + lockedAutoDelayMins && currentSecs >= 30))) isLate = true;
        }
        if (isLate) window.triggerAutoRapid();
    }
};

window.triggerAutoRapid = function() {
    window.smartButtonAction();
    autoAnnounceCooldown = true;
    setTimeout(() => { autoAnnounceCooldown = false; }, 5000); 
};

window.openFunkMenu = function() { 
    window.playClick(); 
    let el = document.getElementById('funk-modal'); 
    if(el) el.style.display = 'flex'; 
    window.syncDom(); 
};

window.closeFunkMenu = function() { 
    window.playClick(); 
    let el = document.getElementById('funk-modal'); 
    if(el) el.style.display = 'none'; 
    window.syncDom(); 
};

window.toggleDelayMode = function() { 
    window.playClick(); 
    setDelayMode(!isDelayMode); 
    window.timeLoop(); 
    window.syncDom(); 
};

window.toggleRandomContinue = function() { 
    window.playClick(); 
    isRandomContinue = !isRandomContinue; 
    window.updateBtnState('btn-random-continue', isRandomContinue); 
    window.syncDom(); 
};

window.toggleTimeAuto = function() { 
    window.playClick();
    isTimeBasedAuto = !isTimeBasedAuto; 
    window.updateBtnState('btn-auto-time', isTimeBasedAuto); 
    if(isTimeBasedAuto) { 
        isClassicAuto = false; 
        window.updateBtnState('btn-auto-announce', false); 
        clearTimeout(classicAutoTimer); 
        isDelayAuto = false; 
        window.updateBtnState('btn-delay-auto', false);
        
        if (appState === 'DRIVE' && !routeStartupWait) {
            setTimeout(() => {
                let now = new Date();
                if (useFictionalTime) now = new Date(now.getTime() + fictionalTimeOffset);
                let currentStop = routeData.stops[routeData.realStopIndex];
                if(currentStop) window.checkAutoAnnounce(now, currentStop);
            }, 3000);
        }
    }
    window.updateAHIndicator();
};

window.toggleDelayAuto = function() { 
    window.playClick();
    if (!isDelayMode) {
        debugLog("<span style='color:red;'>Nejprve zapněte funkci ZPOŽDĚNÍ!</span>");
        window.syncDom();
        return;
    }
    isDelayAuto = !isDelayAuto; 
    window.updateBtnState('btn-delay-auto', isDelayAuto); 
    
    if(isDelayAuto) { 
        isClassicAuto = false; 
        window.updateBtnState('btn-auto-announce', false); 
        clearTimeout(classicAutoTimer); 
        isTimeBasedAuto = false; 
        window.updateBtnState('btn-auto-time', false);
        
        let now = new Date();
        if (useFictionalTime) { 
            now = new Date(now.getTime() + fictionalTimeOffset); 
        }
        
        let currentMins = now.getHours() * 60 + now.getMinutes();
        let startStop = routeData.stops[routeData.realStopIndex];
        
        if (startStop && startStop.time) {
            let sMins = window.timeToMins(startStop.time);
            lockedAutoDelayMins = (currentMins - sMins);
            if (now.getSeconds() > 30 && lockedAutoDelayMins >= 0) {
                lockedAutoDelayMins += 1;
            }
            if (lockedAutoDelayMins < -720) lockedAutoDelayMins += 1440;
            if (lockedAutoDelayMins > 720) lockedAutoDelayMins -= 1440;
            lockedAutoStartTimeMins = sMins + lockedAutoDelayMins;
        } else {
            lockedAutoDelayMins = 0; 
            lockedAutoStartTimeMins = currentMins;
        }

        if (appState === 'DRIVE' && !routeStartupWait) {
            setTimeout(() => {
                let checkNow = new Date();
                if (useFictionalTime) checkNow = new Date(checkNow.getTime() + fictionalTimeOffset);
                let currentStopCheck = routeData.stops[routeData.realStopIndex];
                if(currentStopCheck) window.checkAutoAnnounce(checkNow, currentStopCheck);
            }, 3000);
        }
    } else {
        lockedAutoDelayMins = null; 
        lockedAutoStartTimeMins = null;
    }
    window.updateAHIndicator();
    window.timeLoop();
};

window.toggleAutoAnnounce = function() {
    window.playClick();
    isClassicAuto = !isClassicAuto; 
    window.updateBtnState('btn-auto-announce', isClassicAuto);
    
    if(isClassicAuto) { 
        setDelayMode(false); 
        isTimeBasedAuto = false; 
        window.updateBtnState('btn-auto-time', false); 
        isDelayAuto = false; 
        window.updateBtnState('btn-delay-auto', false); 
        clearTimeout(classicAutoTimer); 
        
        if (appState === 'DRIVE' && !routeStartupWait) {
            setTimeout(() => {
                window.syncTimeWithCurrentStop();
                window.scheduleClassicAuto(); 
            }, 3000);
        }
    } else { 
        clearTimeout(classicAutoTimer); 
    }
    window.updateAHIndicator();
};

window.updateDelayDisplay = function() { 
    let slider = document.getElementById('delay-slider');
    if (slider) {
        classicAutoDelay = parseInt(slider.value); 
        slider.setAttribute('value', classicAutoDelay); 
        let dVal = document.getElementById('delay-val');
        if (dVal) {
            dVal.textContent = classicAutoDelay + "s"; 
        }
        window.syncDom();
    }
};

window.updateBtnState = function(id, state) { 
    const btn = document.getElementById(id); 
    if(btn) { 
        if(state) { 
            btn.textContent = "ZAPNUTO"; 
            btn.classList.add('on'); 
        } else { 
            btn.textContent = "VYPNUTO"; 
            btn.classList.remove('on'); 
        } 
    } 
};

window.setFictionalTime = function() {
    window.playClick();
    const inputEl = document.getElementById('fictional-time-input');
    if(!inputEl) return;
    const input = inputEl.value;
    inputEl.setAttribute('value', input); 
    if (!input) { 
        useFictionalTime = false; 
        window.timeLoop(); 
        window.syncDom(); 
        return; 
    }
    
    useFictionalTime = true;
    let parts = input.split(':'); 
    let now = new Date(); 
    let target = new Date();
    target.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);
    fictionalTimeOffset = target.getTime() - now.getTime();
    
    autoAnnounceCooldown = true;
    setTimeout(() => { 
        autoAnnounceCooldown = false; 
    }, 3000);

    window.timeLoop(); 
    window.closeFunkMenu();
};

window.scheduleClassicAuto = function() {
    if (!isClassicAuto || appState !== 'DRIVE' || routeStartupWait) return;
    clearTimeout(classicAutoTimer);
    classicAutoTimer = setTimeout(() => {
        if (!isClassicAuto || appState !== 'DRIVE' || routeStartupWait) return;
        if (!isAnnouncementPlaying && !window.isAtEndOfRoute()) { 
            window.smartButtonAction(); 
        } else { 
            window.scheduleClassicAuto(); 
        }
    }, classicAutoDelay * 1000);
};

window.manualContinueTrip = function() {
    window.playClick();
    window.submitStats(); // Záznam statistik
    
    if(window.autoContinueTimeout) { 
        clearTimeout(window.autoContinueTimeout); 
        window.autoContinueTimeout = null; 
    }
    
    selectedStartStop = routeData.stops[routeData.stops.length - 1].name; 
    selectedIdpkRouteId = routeData.routeId || selectedIdpkRouteId; 
    inputValues.idpk = routeData.line; 
    
    let d1 = document.getElementById('drive-ui-wrapper'); 
    if(d1) d1.style.display = 'none';
    let d2 = document.getElementById('drive-controls-area'); 
    if(d2) d2.style.display = 'none';
    
    appState = 'IDPK_START'; 
    let d3 = document.getElementById('idpk-direction-wrapper'); 
    if(d3) d3.style.display = 'flex';
    let d4 = document.getElementById('idpk-selected-line'); 
    if(d4) d4.textContent = "Linka: " + inputValues.idpk;
    
    let mk = document.getElementById('main-keypad'); 
    if(mk) mk.style.display = 'grid'; 
    let kd = document.getElementById('key-del'); 
    if(kd) kd.style.display = 'flex';
    let kf = document.getElementById('key-funk'); 
    if(kf) kf.style.display = 'none';
    
    window.updateSelectionHeader(`VÝCHOZÍ: ${selectedStartStop}`, "window.backToManualWithLoad()");
    window.loadDestinationsForStart();
};

window.backToManualWithLoad = function() {
    window.playClick();
    let loadScreen = document.getElementById('loadingScreen');
    if (loadScreen) loadScreen.style.display = 'flex';
    window.syncDom();
    
    ipcRenderer.invoke('gtfs-get-start-stops', selectedIdpkRouteId).then(starts => {
        if(loadScreen) loadScreen.style.display = 'none';
        window.showStartStopSelection(starts);
    }).catch(e => { 
        if(loadScreen) loadScreen.style.display = 'none'; 
    });
};

window.autoStartRandomTrip = async function() {
    window.playClick();
    window.submitStats(); // Záznam statistik
    
    if (availableFiles.length === 0) return;
    
    let choices = availableFiles.filter(f => !randomHistory.includes(f));
    if (choices.length === 0) { 
        choices = availableFiles; 
        randomHistory = []; 
    }
    let pick = choices[Math.floor(Math.random() * choices.length)];
    
    randomHistory.push(pick);
    if (randomHistory.length > 5) randomHistory.shift();

    appState = 'LINKOSPOJ';
    inputValues.linkospoj = pick.replace('_auto', '').replace('-beta', '');
    window.updateLinkospojDisplay();
    
    let fileToLoad = inputValues.linkospoj;
    let resolved = window.getResolvedFile(fileToLoad);
    if (resolved) {
        fileToLoad = resolved;
    }
    
    let loadScreen = document.getElementById('loadingScreen');
    if (loadScreen) loadScreen.style.display = 'flex';
    window.syncDom();
    
    try {
        let content = await ipcRenderer.invoke('read-route-file', fileToLoad);
        if (!content) throw new Error("Nelze přečíst " + fileToLoad);
        
        let responseObj;
        if (content.toUpperCase().includes("GTFS-DATA") || content.toUpperCase().includes("GTSF-DATA")) {
            let response = await ipcRenderer.invoke('process-hybrid-file', content);
            if (response.error) throw new Error(response.error);
            
            if (response.isTemplate) {
                let routeId = response.routeId; 
                currentHybridTemplate = response; 
                inputValues.idpk = response.lineNum;
                
                let starts = await ipcRenderer.invoke('gtfs-get-start-stops', routeId);
                let randomStart = starts[Math.floor(Math.random() * starts.length)];
                
                let dests = await ipcRenderer.invoke('gtfs-get-destinations-from-start', { routeId, startStopName: randomStart });
                let randomDest = dests[Math.floor(Math.random() * dests.length)];
                
                let trips = await ipcRenderer.invoke('gtfs-get-final-trips', { routeId, startStopName: randomStart, headsign: randomDest });
                let randomTrip = trips[Math.floor(Math.random() * trips.length)];
                
                let tripData = await ipcRenderer.invoke('hybrid-get-trip-data', { tripId: randomTrip.tripId, stopMapObj: currentHybridTemplate.stopMap });
                if (tripData.error) throw new Error(tripData.error);
                
                responseObj = { 
                    lineNum: currentHybridTemplate.lineNum, 
                    routeId: routeId, 
                    linkospojCode: randomTrip.tripNumber, 
                    destination: tripData.destination, 
                    stops: tripData.stops 
                };
            } else {
                responseObj = { 
                    lineNum: response.line, 
                    routeId: response.routeId, 
                    linkospojCode: response.linkospoj, 
                    destination: response.destination, 
                    stops: response.stops 
                };
            }
        } else {
            currentHybridTemplate = null; 
            window.parseRouteData(content);
            responseObj = { 
                lineNum: routeData.line, 
                routeId: routeData.routeId, 
                linkospojCode: routeData.linkospojCode, 
                destination: routeData.destination, 
                stops: routeData.stops 
            };
        }

        let s1 = responseObj.stops[0];
        if (s1 && s1.time) {
            let targetMins = window.timeToMins(s1.time);
            let generatedDelay = 0;

            if (isClassicAuto) {
                if (isDelayMode) setDelayMode(false);
                let r = Math.random() * 100;
                if (r < 70) generatedDelay = 0;
                else if (r < 90) generatedDelay = 3 + Math.floor(Math.random() * 28);
                else generatedDelay = 31 + Math.floor(Math.random() * 30);
            } 
            else if (isTimeBasedAuto) {
                let r = Math.random() * 100;
                if (r < 38) generatedDelay = 0; 
                else if (r < 78) generatedDelay = 5 + Math.floor(Math.random() * 6); 
                else if (r < 93) generatedDelay = 11 + Math.floor(Math.random() * 15); 
                else generatedDelay = 26 + Math.floor(Math.random() * 35); 
                
                if (generatedDelay >= 3 && !isDelayMode) setDelayMode(true);
                else if (generatedDelay < 3 && isDelayMode) setDelayMode(false);
            } 
            else if (isDelayAuto) {
                let r = Math.random() * 100;
                if (r < 70) generatedDelay = 5 + Math.floor(Math.random() * 11); 
                else if (r < 90) generatedDelay = 16 + Math.floor(Math.random() * 10); 
                else if (r < 98) generatedDelay = 26 + Math.floor(Math.random() * 25); 
                else generatedDelay = 51 + Math.floor(Math.random() * 10); 
                
                if (!isDelayMode) setDelayMode(true);
                lockedAutoDelayMins = generatedDelay;
                lockedAutoStartTimeMins = targetMins + generatedDelay;
            }

            targetMins += generatedDelay;
            let now = new Date(); 
            let targetDate = new Date();
            targetDate.setHours(Math.floor(targetMins / 60) % 24, targetMins % 60, 0, 0);
            fictionalTimeOffset = targetDate.getTime() - now.getTime();
            useFictionalTime = true;
        }

        if (loadScreen) {
            loadScreen.style.display = 'none';
        }
        
        routeData.isMuted = false; 
        routeData.line = responseObj.lineNum; 
        routeData.routeId = responseObj.routeId; 
        routeData.linkospojCode = responseObj.linkospojCode;
        routeData.destination = responseObj.destination; 
        routeData.stops = responseObj.stops;
        routeData.realStopIndex = 0; 
        routeData.previewStopIndex = 0; 
        drivePhase = 0;
        
        window.initStatsTracking(); // START ZÁZNAMU
        window.switchToDriveScreen(); 
        
        routeStartupWait = true;
        setTimeout(() => { 
            routeStartupWait = false;
            if (isClassicAuto) {
                window.syncTimeWithCurrentStop();
                window.scheduleClassicAuto(); 
            }
            else if (isTimeBasedAuto || isDelayAuto) {
                window.checkAutoAnnounce(new Date(), routeData.stops[0]);
            }
        }, 10000);

    } catch (e) {
        if (loadScreen) loadScreen.style.display = 'none';
        appState = 'LINKOSPOJ'; 
        inputValues.linkospoj = ""; 
        window.updateLinkospojDisplay(); 
        window.switchToLinkospojScreen();
    }
};

window.submitAction = function() {
    try {
        debugLog("Odesílám akci ve stavu: " + appState);
        window.playClick(); 
        
        if (appState === 'LOGIN_DISCORD') { 
            window.startDiscordAuth(); 
        }
        else if (appState === 'LOGIN_AUTO') { 
            window.finalizeLogin(); 
        }
        else if (appState === 'LINKOSPOJ') {
            if (linkospojFocus === 'list') { 
                window.confirmSelection(); 
                return; 
            }
            
            let fileToLoad = inputValues.linkospoj; 
            let resolved = window.getResolvedFile(fileToLoad); 
            if (resolved) { 
                fileToLoad = resolved; 
                inputValues.linkospoj = resolved; 
                window.updateLinkospojDisplay(); 
            }
            
            let loadScreen = document.getElementById('loadingScreen');
            if (loadScreen) loadScreen.style.display = 'flex';
            isSystemLoading = true; 
            window.syncDom();
            
            ipcRenderer.invoke('read-route-file', fileToLoad).then(content => {
                if (content) {
                    if (content.toUpperCase().includes("GTFS-DATA") || content.toUpperCase().includes("GTSF-DATA")) {
                        ipcRenderer.invoke('process-hybrid-file', content).then(response => {
                            isSystemLoading = false; 
                            if(loadScreen) loadScreen.style.display = 'none';
                            
                            if (response.error) { 
                                window.showErrorModal("CHYBA DATABÁZE", response.error);
                            } 
                            else if (response.isTemplate) {
                                currentHybridTemplate = response; 
                                selectedIdpkRouteId = response.routeId; 
                                inputValues.idpk = response.lineNum; 
                                isSystemLoading = true; 
                                if(loadScreen) loadScreen.style.display = 'flex'; 
                                window.syncDom();
                                
                                ipcRenderer.invoke('gtfs-get-start-stops', selectedIdpkRouteId).then(starts => { 
                                    isSystemLoading = false; 
                                    if(loadScreen) loadScreen.style.display = 'none'; 
                                    window.showStartStopSelection(starts); 
                                });
                            } else {
                                routeData.isMuted = false; 
                                routeData.line = response.line; 
                                routeData.routeId = response.routeId; 
                                routeData.linkospojCode = response.linkospoj; 
                                routeData.destination = response.destination; 
                                routeData.stops = response.stops; 
                                routeData.nextTurnus = response.nextTurnus; 
                                routeData.realStopIndex = 0; 
                                routeData.previewStopIndex = 0; 
                                drivePhase = 0; 
                                window.initStatsTracking(); // START ZÁZNAMU
                                window.switchToDriveScreen(); 
                                window.sendDataToPanel();
                            }
                        }).catch(e => { 
                            isSystemLoading = false; 
                            if(loadScreen) loadScreen.style.display = 'none'; 
                            debugLog("GTFS proces chyba: "+e); 
                            window.syncDom(); 
                        });
                    } else { 
                        isSystemLoading = false; 
                        if(loadScreen) loadScreen.style.display = 'none'; 
                        currentHybridTemplate = null; 
                        routeData.isMuted = false; 
                        window.parseRouteData(content); 
                        window.initStatsTracking(); // START ZÁZNAMU
                        window.switchToDriveScreen(); 
                        window.sendDataToPanel(); 
                    }
                } else { 
                    isSystemLoading = false; 
                    if(loadScreen) loadScreen.style.display = 'none'; 
                    window.showErrorModal("CHYBA", "SOUBOR NENALEZEN: " + fileToLoad); 
                    window.syncDom(); 
                }
            }).catch(e => { 
                isSystemLoading = false; 
                if(loadScreen) loadScreen.style.display = 'none'; 
            });
        }
        else if (appState === 'IDPK_LINE') {
            if (linkospojFocus === 'list') { 
                window.confirmSelection(); 
                return; 
            }
            
            if (!selectedIdpkRouteId) {
                const found = databaseFiles.find(line => { 
                    const num = line.split('|')[0].trim(); 
                    return num === inputValues.idpk || num.endsWith(inputValues.idpk); 
                });
                if(found) {
                    selectedIdpkRouteId = found.split('|')[2] ? found.split('|')[2].trim() : ""; 
                } else { 
                    window.showErrorModal("CHYBA", "LINKA NENALEZENA V DB"); 
                    window.syncDom(); 
                    return; 
                }
            }
            currentHybridTemplate = null; 
            isSystemLoading = true; 
            
            let loadScreen = document.getElementById('loadingScreen');
            if(loadScreen) loadScreen.style.display = 'flex'; 
            window.syncDom();
            
            ipcRenderer.invoke('gtfs-get-start-stops', selectedIdpkRouteId).then(starts => { 
                isSystemLoading = false; 
                if(loadScreen) loadScreen.style.display = 'none'; 
                
                if (starts.length === 0 || (starts.length === 1 && starts[0].includes("CHYBA"))) {
                    window.showErrorModal("CHYBA", starts.length > 0 ? starts[0] : "ŽÁDNÉ SPOJE K LINCE"); 
                    window.syncDom();
                } else { 
                    window.showStartStopSelection(starts); 
                }
            }).catch(e => { 
                isSystemLoading = false; 
                if(loadScreen) loadScreen.style.display = 'none'; 
            });
        }
    } catch(err) {
        window.onerror("Chyba při Submit: " + err.message, "", 0, 0, err);
    }
};

window.updateLinkospojDisplay = function() { 
    let rawInput = inputValues.linkospoj || ''; 
    let displayEl = document.getElementById('display-linkospoj');
    if (!displayEl) return;
    
    if (!rawInput) { 
        displayEl.textContent = '-----'; 
        return; 
    }
    
    let resolvedFile = window.getResolvedFile(rawInput); 
    let isBeta = false; 
    let cleanText = rawInput.toString();
    
    if (resolvedFile) { 
        isBeta = resolvedFile.toUpperCase().includes('BETA'); 
        cleanText = resolvedFile.replace(/_auto-BETA/i, '').replace(/_auto/i, '').replace(/-BETA/i, '').replace(/_BETA/i, ''); 
    } else { 
        isBeta = rawInput.toString().toUpperCase().includes('BETA'); 
        cleanText = rawInput.toString().replace(/_auto-BETA/i, '').replace(/_auto/i, '').replace(/-BETA/i, '').replace(/_BETA/i, ''); 
    }
    
    if (isBeta) { 
        displayEl.innerHTML = `<span class="beta-badge">BETA</span><span class="beta-text">${cleanText}</span>`; 
    } else { 
        displayEl.innerHTML = `<span>${cleanText}</span>`; 
    }
};

window.updateLinkospojUI = function() { 
    const listEl = document.getElementById('link-list'); 
    let wrapper = null;
    
    if (appState === 'IDPK_LINE') { 
        wrapper = document.getElementById('idpk-db-wrapper'); 
    } else { 
        wrapper = document.getElementById('linkospoj-wrapper'); 
    }
    if (listEl && wrapper) wrapper.appendChild(listEl);

    const check = document.getElementById(appState === 'IDPK_LINE' ? 'idpk-checkbox' : 'checkbox-icon'); 
    const toggle = document.getElementById(appState === 'IDPK_LINE' ? 'idpk-list-toggle' : 'list-toggle'); 
    
    if (linkospojFocus === 'list' || isListOpen) { 
        if(toggle) toggle.classList.add('selected'); 
    } else { 
        if(toggle) toggle.classList.remove('selected'); 
    }
    
    if(check) check.textContent = isListOpen ? "[x]" : "[ ]"; 
    
    if(listEl) listEl.style.display = isListOpen ? 'block' : 'none'; 
    if (isListOpen) window.renderLinkList(); 
    
    window.syncDom();
};

window.selectListItem = function(index) {
    if(appState === 'IDPK_LINE') {
        let parts = filteredFiles[index].split('|'); 
        inputValues.idpk = parts[0].trim(); 
        selectedIdpkRouteId = parts[2] ? parts[2].trim() : "";
        
        let disp = document.getElementById('display-idpk'); 
        if (disp) disp.textContent = inputValues.idpk;
        
        selectedListIndex = index; 
        linkospojFocus = 'input'; 
        isListOpen = false; 
        
        window.updateLinkospojUI(); 
        window.playClick(); 
        window.submitAction();
    } else {
        inputValues.linkospoj = filteredFiles[index]; 
        selectedListIndex = index; 
        linkospojFocus = 'input'; 
        isListOpen = false; 
        
        window.updateLinkospojDisplay(); 
        window.updateLinkospojUI(); 
        window.playClick(); 
        window.submitAction(); 
    }
};

window.renderLinkList = function() { 
    const listEl = document.getElementById('link-list'); 
    if(!listEl) return;
    
    listEl.innerHTML = ""; 
    filteredFiles.forEach((file, index) => { 
        const div = document.createElement('div'); 
        div.className = 'link-item'; 
        
        if (index === selectedListIndex) {
            div.classList.add('selected'); 
        }
        
        if (appState === 'IDPK_LINE') {
            let parts = file.split('|');
            div.textContent = parts[0].trim() + " | " + (parts[1] ? parts[1].trim() : "");
        } else {
            let isBeta = file.toUpperCase().includes('BETA'); 
            let cleanName = file.replace(/_auto-BETA/i, '').replace(/_auto/i, '').replace(/-BETA/i, ''); 
            
            if (isBeta) { 
                div.classList.add('beta-item'); 
                div.innerHTML = `<span class="beta-badge">BETA</span><span class="beta-text">${cleanName}</span>`; 
            } else { 
                div.textContent = cleanName; 
            } 
        }
        div.setAttribute('onclick', `window.selectListItem(${index})`);
        listEl.appendChild(div); 
    }); 
    window.syncDom();
};

window.getResolvedFile = function(inputStr) { 
    if (!inputStr) return null; 
    let str = inputStr.toString().toLowerCase();
    
    let exact = availableFiles.find(f => f.toLowerCase() === str); 
    if (exact) return exact; 
    
    let searchNum = str.replace(/\D/g, ''); 
    if (!searchNum) return null; 
    
    let betaMatch = availableFiles.find(f => { 
        let fNums = f.replace(/\D/g, ''); 
        return fNums.startsWith(searchNum) && f.toUpperCase().includes('BETA'); 
    }); 
    if (betaMatch) return betaMatch; 
    
    let fuzzy = availableFiles.find(f => { 
        let fNums = f.replace(/\D/g, ''); 
        return fNums.startsWith(searchNum); 
    }); 
    return fuzzy || null; 
};

window.toggleListMouse = function() { 
    window.playClick(); 
    if(appState !== 'LINKOSPOJ' && appState !== 'IDPK_LINE') return; 
    
    if(isListOpen) { 
        isListOpen = false; 
        linkospojFocus = 'input'; 
    } else { 
        isListOpen = true; 
        linkospojFocus = 'list'; 
        selectedListIndex = 0; 
        window.updateFilter(); 
    } 
    window.updateLinkospojUI(); 
};

window.updateFilter = function() { 
    if (appState === 'LINKOSPOJ') { 
        const val = (inputValues.linkospoj || "").toString().toLowerCase(); 
        filteredFiles = val ? availableFiles.filter(f => { 
            let fClean = f.toLowerCase().replace(/[^a-z0-9]/g, ''); 
            let vClean = val.replace(/[^a-z0-9]/g, ''); 
            return fClean.includes(vClean) || f.toLowerCase().includes(val); 
        }) : availableFiles; 
    } else { 
        const val = (inputValues.idpk || "").toString(); 
        filteredFiles = val ? databaseFiles.filter(f => { 
            const lineNum = f.split('|')[0].trim(); 
            return lineNum.includes(val) || lineNum.endsWith(val); 
        }) : databaseFiles; 
    } 
};

window.updateSelectionHeader = function(title, backActionStr) { 
    const header = document.getElementById('selection-header'); 
    if(!header) return;
    
    header.innerHTML = ""; 
    header.style.position = "relative"; 
    
    if (backActionStr) { 
        const arrow = document.createElement('div'); 
        arrow.innerHTML = "&#10094;"; 
        arrow.style.cssText = "position:absolute; left:20px; top:50%; transform:translateY(-50%); font-size:30px; cursor:pointer; color:var(--idpk-yellow);"; 
        arrow.setAttribute('onclick', `event.stopPropagation(); window.playClick(); ${backActionStr}`); 
        header.appendChild(arrow); 
    } 
    const text = document.createElement('span'); 
    text.textContent = title; 
    header.appendChild(text); 
    header.onclick = null; 
    
    window.syncDom();
};

window.switchToIdpkMode = function() { 
    appState = 'IDPK_LINE'; 
    inputValues.idpk = ""; 
    selectedIdpkRouteId = ""; 
    currentHybridTemplate = null; 

    ipcRenderer.invoke('gtfs-load-routes').then(db => { 
        databaseFiles = db; 
        if (appState === 'IDPK_LINE') {
            filteredFiles = databaseFiles; 
            window.updateLinkospojUI(); 
        }
    }).catch(()=>{});
    
    let lWrap = document.getElementById('linkospoj-wrapper'); 
    if(lWrap) lWrap.style.display = 'none'; 
    
    let idpkWrap = document.getElementById('idpk-db-wrapper'); 
    if(idpkWrap) {
        idpkWrap.style.display = 'flex'; 
        
        let warn = document.getElementById('idpk-no-sound-warn');
        if(!warn) {
            warn = document.createElement('div');
            warn.id = 'idpk-no-sound-warn';
            warn.innerHTML = "⚠️ <b style='text-transform:uppercase;'>Tyto linky jsou bez zvuku</b>";
            warn.style.cssText = "color: #f59e0b; font-size: 14px; text-align: center; margin-bottom: 10px; width: 100%; border: 1px solid #f59e0b; padding: 5px; border-radius: 5px; background: rgba(245, 158, 11, 0.1);";
            idpkWrap.insertBefore(warn, idpkWrap.firstChild);
        }
    }
    
    let keypad = document.getElementById('main-keypad'); 
    if(keypad) keypad.style.display = 'grid'; 
    
    let delK = document.getElementById('key-del'); 
    if(delK) delK.style.display = 'flex';
    
    let funK = document.getElementById('key-funk'); 
    if(funK) funK.style.display = 'none';
    
    linkospojFocus = 'input'; 
    isListOpen = false; 
    filteredFiles = databaseFiles; 
    
    window.updateLinkospojUI(); 
    
    let disp = document.getElementById('display-idpk'); 
    if(disp) disp.textContent = "-----"; 
    
    window.syncDom();
};

window.backToManual = function() { 
    appState = 'LINKOSPOJ'; 
    inputValues.linkospoj = ""; 
    
    let d1 = document.getElementById('idpk-db-wrapper'); 
    if (d1) d1.style.display = 'none'; 
    
    let d2 = document.getElementById('idpk-direction-wrapper'); 
    if (d2) d2.style.display = 'none'; 
    
    let d3 = document.getElementById('linkospoj-wrapper'); 
    if (d3) d3.style.display = 'flex'; 
    
    let k = document.getElementById('main-keypad'); 
    if(k) k.style.display = 'grid';
    
    let del = document.getElementById('key-del'); 
    if(del) del.style.display = 'flex';
    
    let fnk = document.getElementById('key-funk'); 
    if(fnk) fnk.style.display = 'none';
    
    linkospojFocus = 'input'; 
    isListOpen = false; 

    ipcRenderer.invoke('get-link-files').then(files => { 
        availableFiles = files; 
        filteredFiles = files; 
        if (appState === 'LINKOSPOJ') {
            window.updateLinkospojUI(); 
        }
    }).catch(()=>{});
    
    window.updateLinkospojUI(); 
    window.syncDom();
};

window.backToIdpkList = function() { 
    appState = 'IDPK_LINE'; 
    let d1 = document.getElementById('idpk-direction-wrapper'); 
    if(d1) d1.style.display = 'none'; 
    
    let d2 = document.getElementById('idpk-db-wrapper'); 
    if(d2) d2.style.display = 'flex'; 
    
    let del = document.getElementById('key-del'); 
    if(del) del.style.display = 'flex';
    
    let fnk = document.getElementById('key-funk'); 
    if(fnk) fnk.style.display = 'none';
    
    window.syncDom();
};

window.backToIdpkMode = function() {
    appState = 'IDPK_LINE'; 
    let d1 = document.getElementById('idpk-direction-wrapper'); 
    if(d1) d1.style.display = 'none'; 
    
    let d2 = document.getElementById('idpk-db-wrapper'); 
    if(d2) d2.style.display = 'flex'; 
    
    let del = document.getElementById('key-del'); 
    if(del) del.style.display = 'flex';
    
    let fnk = document.getElementById('key-funk'); 
    if(fnk) fnk.style.display = 'none';
    
    window.syncDom();
};

window.selectStartStop = function(s) { 
    window.playClick(); 
    selectedStartStop = s; 
    window.loadDestinationsForStart(); 
};

window.showStartStopSelection = function(starts) { 
    appState = 'IDPK_START'; 
    let w1 = document.getElementById('idpk-db-wrapper'); 
    if(w1) w1.style.display = 'none'; 
    
    let w2 = document.getElementById('linkospoj-wrapper'); 
    if(w2) w2.style.display = 'none'; 
    
    let w3 = document.getElementById('idpk-direction-wrapper'); 
    if(w3) w3.style.display = 'flex'; 
    
    let sl = document.getElementById('idpk-selected-line'); 
    if(sl) sl.textContent = "Linka: " + inputValues.idpk; 
    
    window.updateSelectionHeader("VÝCHOZÍ ZASTÁVKA", "window.backToIdpkMode()"); 
    
    const container = document.getElementById('direction-list'); 
    if(!container) return;
    
    container.innerHTML = ""; 
    if (starts.length === 0) { 
        window.showErrorModal("CHYBA", "Žádná data zastávek"); 
        return;
    } 
    
    starts.forEach(s => { 
        const div = document.createElement('div'); 
        div.style.padding = "15px"; 
        div.style.borderBottom = "1px solid #555"; 
        div.style.cursor = "pointer"; 
        div.style.color = "white"; 
        div.style.fontWeight = "bold"; 
        div.textContent = s; 
        div.setAttribute('onclick', `window.selectStartStop('${s}')`); 
        container.appendChild(div); 
    }); 
    window.syncDom();
};

window.reloadStartStops = function() {
    isSystemLoading = true; 
    let l = document.getElementById('loadingScreen'); 
    if(l) l.style.display = 'flex'; 
    window.syncDom();
    
    ipcRenderer.invoke('gtfs-get-start-stops', selectedIdpkRouteId).then(starts => { 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
        window.showStartStopSelection(starts); 
    }).catch(e => { 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
    });
};

window.selectDestination = function(d) { 
    window.playClick(); 
    selectedDestination = d; 
    window.loadTimesForTrip(); 
};

window.loadDestinationsForStart = function() { 
    isSystemLoading = true; 
    let l = document.getElementById('loadingScreen'); 
    if(l) l.style.display = 'flex'; 
    window.syncDom(); 
    
    ipcRenderer.invoke('gtfs-get-destinations-from-start', { routeId: selectedIdpkRouteId, startStopName: selectedStartStop }).then(dests => { 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
        
        window.updateSelectionHeader("CÍLOVÁ STANICE", "window.reloadStartStops()"); 
        const container = document.getElementById('direction-list'); 
        if(!container) return; 
        container.innerHTML = ""; 
        
        dests.forEach(d => { 
            const div = document.createElement('div'); 
            div.style.padding = "15px"; 
            div.style.borderBottom = "1px solid #555"; 
            div.style.cursor = "pointer"; 
            div.style.color = "white"; 
            div.style.display = "flex"; 
            div.style.alignItems = "center"; 
            div.innerHTML = `<span style="color:var(--idpk-yellow); font-size:20px; margin-right:10px;">➔</span><span style="font-weight:bold; font-size:14px;">${d}</span>`; 
            div.setAttribute('onclick', `window.selectDestination('${d}')`); 
            container.appendChild(div); 
        }); 
        window.syncDom(); 
    }).catch(e=>{ 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
    }); 
};

window.loadTimesForTrip = function() { 
    isSystemLoading = true; 
    let l = document.getElementById('loadingScreen'); 
    if(l) l.style.display = 'flex'; 
    window.syncDom(); 
    
    ipcRenderer.invoke('gtfs-get-final-trips', { routeId: selectedIdpkRouteId, startStopName: selectedStartStop, headsign: selectedDestination }).then(trips => { 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
        
        window.updateSelectionHeader("VÝBĚR ČASU", "window.loadDestinationsForStart()"); 
        const container = document.getElementById('direction-list'); 
        if(!container) return; 
        
        container.innerHTML = `<div style="padding:10px; color:#aaa; font-size:12px;">Z: ${selectedStartStop}<br>DO: ${selectedDestination}</div>`; 
        
        if (trips.length === 0) { 
            window.showErrorModal("CHYBA", "Žádné spoje nenalezeny"); 
            return; 
        } 
        
        trips.forEach(trip => { 
            let displayName = trip.formattedName; 
            let badgeClass = "badge-yellow"; 
            if (trip.spojNum >= 100) badgeClass = "badge-green"; 
            
            const div = document.createElement('div'); 
            div.style.padding = "15px"; 
            div.style.borderBottom = "1px solid #555"; 
            div.style.cursor = "pointer"; 
            div.style.color = "white"; 
            div.style.display = "flex"; 
            div.style.alignItems = "center"; 
            div.style.justifyContent = "space-between"; 
            div.style.width = "90%"; 
            div.innerHTML = `<span style="color:white; font-weight:bold; font-size:20px;">${window.padTime(trip.time)}</span><span class="trip-badge ${badgeClass}">${displayName}</span>`; 
            div.setAttribute('onclick', `window.finalizeTripSelection('${trip.tripId}', '${trip.headsign}', '${trip.tripNumber}')`); 
            container.appendChild(div); 
        }); 
        window.syncDom(); 
    }).catch(e=>{ 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
    }); 
};

window.finalizeTripSelection = function(tripId, destination, tripNumber) { 
    if (currentHybridTemplate) { 
        isSystemLoading = true; 
        let l = document.getElementById('loadingScreen'); 
        if(l) l.style.display = 'flex'; 
        window.syncDom(); 
        
        ipcRenderer.invoke('hybrid-get-trip-data', { tripId: tripId, stopMapObj: currentHybridTemplate.stopMap }).then(response => { 
            isSystemLoading = false; 
            if(l) l.style.display = 'none'; 
            
            if (response.error) { 
                window.showErrorModal("CHYBA", response.error); 
                return; 
            } 
            
            routeData.isMuted = false; 
            routeData.line = currentHybridTemplate.lineNum; 
            routeData.routeId = selectedIdpkRouteId; 
            routeData.linkospojCode = tripNumber; 
            routeData.destination = response.destination; 
            routeData.stops = response.stops; 
            routeData.realStopIndex = 0; 
            routeData.previewStopIndex = 0; 
            drivePhase = 0; 
            
            let w = document.getElementById('idpk-direction-wrapper'); 
            if(w) w.style.display = 'none'; 
            
            window.initStatsTracking(); 
            window.switchToDriveScreen(); 
            window.sendDataToPanel(); 
        }).catch(e=>{ 
            isSystemLoading = false; 
            if(l) l.style.display = 'none'; 
        }); 
    } else { 
        window.startIdpkRide(tripId, destination, tripNumber); 
    } 
};

window.startIdpkRide = function(tripId, destination, tripNumber) { 
    isSystemLoading = true; 
    let l = document.getElementById('loadingScreen'); 
    if(l) l.style.display = 'flex'; 
    window.syncDom(); 
    
    ipcRenderer.invoke('gtfs-get-stops', tripId).then(stops => { 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
        
        if (stops.error) { 
            window.showErrorModal("CHYBA", stops.error); 
            return; 
        } 
        if (stops.length === 0) { 
            window.showErrorModal("CHYBA", "Spoj nemá zastávky"); 
            return; 
        } 
        
        routeData.isMuted = true; 
        routeData.line = inputValues.idpk; 
        routeData.routeId = selectedIdpkRouteId; 
        routeData.linkospojCode = tripNumber || (inputValues.idpk + " (GTFS)"); 
        routeData.destination = destination; 
        routeData.stops = stops; 
        routeData.realStopIndex = 0; 
        routeData.previewStopIndex = 0; 
        drivePhase = 0; 
        
        let w = document.getElementById('idpk-direction-wrapper'); 
        if(w) w.style.display = 'none'; 
        
        window.initStatsTracking(); // START ZÁZNAMU
        window.switchToDriveScreen(); 
        window.sendDataToPanel(); 
    }).catch(e=>{ 
        isSystemLoading = false; 
        if(l) l.style.display = 'none'; 
    }); 
};

window.switchToLinkospojScreen = function() { 
    appState = 'LINKOSPOJ'; 
    inputValues.linkospoj = ""; 
    
    stopPressed = false;
    ipcRenderer.send('broadcast-stop-state', false);
    window.updateStopVisuals();
    
    document.querySelectorAll('.login-view').forEach(v => { 
        v.style.display = 'none'; 
    }); 
    
    let d1 = document.getElementById('drive-ui-wrapper'); 
    if(d1) d1.style.display = 'none'; 
    
    let d2 = document.getElementById('drive-controls-area'); 
    if(d2) d2.style.display = 'none'; 
    
    let d3 = document.getElementById('linkospoj-wrapper'); 
    if(d3) d3.style.display = 'flex'; 
    
    let d4 = document.getElementById('idpk-db-wrapper'); 
    if(d4) d4.style.display = 'none'; 
    
    let d5 = document.getElementById('idpk-direction-wrapper'); 
    if(d5) d5.style.display = 'none'; 
    
    let k = document.getElementById('main-keypad'); 
    if(k) k.style.display = 'grid'; 
    
    let key1 = document.getElementById('key-del'); 
    if(key1) key1.style.display = 'flex'; 
    
    let key2 = document.getElementById('key-funk'); 
    if(key2) key2.style.display = 'none'; 
    
    window.updateLinkospojDisplay(); 
    window.syncDom(); 
};

window.switchToDriveScreen = function() { 
    appState = 'DRIVE'; 
    stopSelectionBuffer = ""; 
    
    let d1 = document.getElementById('linkospoj-wrapper'); 
    if(d1) d1.style.display = 'none'; 
    
    let d2 = document.getElementById('idpk-db-wrapper'); 
    if(d2) d2.style.display = 'none'; 
    
    let d3 = document.getElementById('link-list'); 
    if(d3) d3.style.display = 'none'; 
    
    let d4 = document.getElementById('drive-ui-wrapper'); 
    if(d4) d4.style.display = 'flex'; 
    
    let d5 = document.getElementById('drive-controls-area'); 
    if(d5) d5.style.display = 'block'; 
    
    let k = document.getElementById('main-keypad'); 
    if(k) k.style.display = 'grid';
    
    let key1 = document.getElementById('key-del'); 
    if(key1) key1.style.display = 'none';
    
    let key2 = document.getElementById('key-funk'); 
    if(key2) key2.style.display = 'flex';
    
    window.updateStopVisuals(); 
    window.updateDriveUI(); 

    routeStartupWait = true;
    setTimeout(() => {
        routeStartupWait = false;
        if (appState === 'DRIVE') {
            if (isClassicAuto) {
                window.scheduleClassicAuto();
            }
        }
    }, 10000);
    window.syncDom();
};

window.smartButtonAction = function() { 
    window.playClick();
    if (isAnnouncementPlaying || window.isAtEndOfRoute()) return; 
    
    if (drivePhase === 0) { 
        // ZÁZNAM ZASTÁVKY DO STATISTIK
        if (routeData.stops[routeData.realStopIndex]) {
            window.trackStopAnnouncement(routeData.stops[routeData.realStopIndex].name);
        }

        if (!routeData.isMuted) {
            window.announceStop(routeData.realStopIndex); 
        }
        if (routeData.realStopIndex + 1 >= routeData.stops.length) { 
            drivePhase = 1; 
            window.sendDataToPanel(true); 
            routeData.realStopIndex++; 
            window.updateDriveUI(); 
        } else { 
            drivePhase = 1; 
            window.sendDataToPanel(true); 
        } 
    } else { 
        if (!routeData.isMuted) {
            window.announceNextStop(routeData.realStopIndex + 1); 
        }
        routeData.realStopIndex++; 
        routeData.previewStopIndex = routeData.realStopIndex; 
        drivePhase = 0; 
        if (stopPressed) { 
            stopPressed = false; 
            ipcRenderer.send('broadcast-stop-state', false); 
            window.updateStopVisuals(); 
        } 
        window.sendDataToPanel(false); 
    } 
    window.updateDriveUI(); 
    
    if (isClassicAuto) { 
        window.syncTimeWithCurrentStop(); 
    } 
};

// --- SYSTÉM ZVUKŮ A HLÁŠENÍ CHYB ---
window.announceStop = function(idx) { 
    const stop = routeData.stops[idx]; 
    if(!stop) return; 
    
    window.currentAnnouncingStopName = stop.name || "Neznámá zastávka";

    let sequence = ['zvuky/hlaseni/GONG.wav']; 
    if (stop.audio && stop.audio !== '.wav' && stop.audio.length > 4) { 
        sequence.push(`zvuky/zastavky/${stop.audio}`); 
    } else { 
        let dId = localStorage.getItem('discordId') || storedDiscordId || "Neznámý";
        let nick = localStorage.getItem('discordNick') || "Neznámý";
        let errMsg = `U zastávky [${window.currentAnnouncingStopName}] chybí zápis zvuku v .txt souboru (nebo nebyl detekován)!`;
        debugLog("<span style='color:#e74c3c;'>[CHYBA LINKY " + routeData.line + "] " + errMsg + "</span>");
        
        fetchBlesk(`${API_BASE}/api/report_error`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: dId, nick: nick, type: `CHYBA - LINKA ${routeData.line}`, message: errMsg })
        }, 3000).catch(()=>{});
    } 
    
    if (stop.type === 'z') {
        sequence.push('zvuky/hlaseni/ZZ.wav'); 
    }
    if (idx === routeData.stops.length - 1) {
        sequence.push('zvuky/hlaseni/KZ.wav'); 
    }
    window.playAudioSequence(sequence); 
};

window.announceNextStop = function(idx) { 
    const stop = routeData.stops[idx]; 
    if(!stop) return; 
    
    window.currentAnnouncingStopName = stop.name || "Neznámá zastávka";

    let sequence = ['zvuky/hlaseni/GONG.wav', 'zvuky/hlaseni/PZ.wav']; 
    if (stop.audio && stop.audio !== '.wav' && stop.audio.length > 4) { 
        sequence.push(`zvuky/zastavky/${stop.audio}`); 
    } else {
        let dId = localStorage.getItem('discordId') || storedDiscordId || "Neznámý";
        let nick = localStorage.getItem('discordNick') || "Neznámý";
        let errMsg = `U zastávky [${window.currentAnnouncingStopName}] chybí zápis zvuku v .txt souboru (nebo nebyl detekován)!`;
        debugLog("<span style='color:#e74c3c;'>[CHYBA LINKY " + routeData.line + "] " + errMsg + "</span>");
        
        fetchBlesk(`${API_BASE}/api/report_error`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: dId, nick: nick, type: `CHYBA - LINKA ${routeData.line}`, message: errMsg })
        }, 3000).catch(()=>{});
    }
    if (stop.type === 'z') {
        sequence.push('zvuky/hlaseni/ZZ.wav'); 
    }
    window.playAudioSequence(sequence); 
};

window.handleLeftButton = function() { 
    window.playClick();
    if (window.isAtEndOfRoute()) { 
        window.manualContinueTrip(); 
    } else if (!isAnnouncementPlaying && !routeData.isMuted) { 
        if (drivePhase === 0) {
            window.announceStop(routeData.realStopIndex); 
        } else {
            window.announceNextStop(routeData.realStopIndex + 1); 
        }
    } 
};

window.handleTerminate = function() { 
    window.playClick();
    if (window.isAtEndOfRoute()) { 
        const next = routeData.nextTurnus; 
        if (!routeData.isMuted && next && next.includes("DALŠÍ LINKOSPOJ") && !next.includes("NEBYL")) { 
            window.endRide(); 
        } else { 
            window.endRide(); 
        } 
    } else { 
        window.endRide(); 
    } 
};

window.isAtEndOfRoute = function() { 
    return routeData.realStopIndex >= routeData.stops.length; 
};

window.parseRouteData = function(text) { 
    const lines = text.split('\n'); 
    routeData.stops = []; 
    routeData.nextTurnus = null; 
    let reading = false; 
    
    for(let l of lines) { 
        l = l.trim(); 
        if(!l) continue; 
        
        if(l.startsWith('Linka:')) {
            routeData.line = l.replace('Linka:', '').trim(); 
        }
        else if(l.startsWith('Směr:')) {
            routeData.destination = l.replace('Směr:', '').trim(); 
        }
        else if(l.startsWith('Následující linkospoj')) { 
            routeData.nextTurnus = l.replace('Následující linkospoj', '').trim().replace(/"/g, ''); 
            continue; 
        } 
        else if(l.startsWith('Zastávky:')) {
            reading = true; 
        }
        else if(reading) { 
            if(l.includes('|')) { 
                const parts = l.split('|'); 
                if(parts.length>0) { 
                    let name = "", zone = "", type = "n", time = ""; 
                    parts.forEach(p => { 
                        if(p.trim().startsWith('Display:')) name = p.replace('Display:', '').trim(); 
                        if(p.trim().startsWith('Tarifní zona:')) zone = p.replace('Tarifní zona:', '').trim(); 
                        if(p.trim().startsWith('Čas:')) time = p.replace('Čas:', '').trim(); 
                        if(p.includes('ZZ') || p.includes('Další znaky: ZZ')) type = 'z'; 
                        if(p.includes('KZ') || p.includes('Další znaky: KZ')) type = 'z'; 
                    }); 
                    if(name) {
                        routeData.stops.push({audio: parts[0].trim(), name, zone, type, time}); 
                    }
                } 
            } else { 
                let raw = l.trim(); 
                let prettyName = raw.replace(/_/g, ' '); 
                routeData.stops.push({audio: raw, name: prettyName, zone: "", type: "n", time: ""}); 
            } 
        } 
    } 
    routeData.realStopIndex = 0; 
    routeData.previewStopIndex = 0; 
    routeData.linkospojCode = inputValues.linkospoj; 
    drivePhase = 0; 
};

window.endRide = function() { 
    window.submitStats(); // Záznam statistik
    stopPressed = false;
    ipcRenderer.send('broadcast-stop-state', false);
    window.updateStopVisuals();
    ipcRenderer.send('reset-panel'); 
    window.switchToLinkospojScreen(); 
};

window.updateDriveUI = function() { 
    const stops = routeData.stops; 
    const realIdx = routeData.realStopIndex; 
    const previewIdx = routeData.previewStopIndex; 
    
    let rawCode = routeData.linkospojCode || "";
    let lkCode = rawCode.toString().replace(/_auto-BETA/i, '').replace(/_auto/i, '').replace(/-BETA/i, '').replace(/_BETA/i, '');
    
    let headerCode = document.getElementById('drive-header-code'); 
    if(headerCode) headerCode.textContent = lkCode; 
    
    let headerDest = document.getElementById('drive-header-dest'); 
    if(headerDest) headerDest.textContent = "➔ " + routeData.destination; 
    
    const btnMain = document.getElementById('btn-announce'); 
    const btnSub = document.getElementById('smart-btn-sub'); 
    const btnMainTxt = document.getElementById('smart-btn-main'); 
    const btnLeft = document.getElementById('btn-repeat'); 
    const btnRight = document.getElementById('btn-terminate'); 
    const btnManualContinue = document.getElementById('btn-manual-continue'); 
    const btnRandomContinue = document.getElementById('btn-random-continue-trigger');
    
    if (window.isAtEndOfRoute()) { 
        if(btnMain) btnMain.style.display = 'none'; 
        if(btnLeft) btnLeft.style.display = 'none';
        if(btnManualContinue) btnManualContinue.style.display = 'flex'; 
        if(btnRandomContinue) btnRandomContinue.style.display = 'flex';
        
        if(btnRight) { 
            btnRight.textContent = "UKONČIT"; 
            btnRight.style.backgroundColor = "#c0392b"; 
        }
        
        let rStop = document.getElementById('drive-real-stop'); 
        if(rStop) rStop.textContent = "JÍZDA UKONČENA"; 
        
        let nStop = document.getElementById('drive-next-stop'); 
        if(nStop) nStop.textContent = ""; 
        
        let pvBox = document.getElementById('drive-preview-box'); 
        if(pvBox) pvBox.style.display = 'none'; 
        
        if (isRandomContinue && (isClassicAuto || isTimeBasedAuto || isDelayAuto) && !window.autoContinueTimeout) {
            if(btnRandomContinue) btnRandomContinue.innerHTML = "NÁHODNÁ LINKA (Za 5s...)";
            window.autoContinueTimeout = setTimeout(() => { 
                window.autoContinueTimeout = null; 
                window.autoStartRandomTrip(); 
            }, 5000);
        } else { 
            if(btnRandomContinue) btnRandomContinue.innerHTML = "NÁHODNÁ LINKA (Z PC)"; 
        }
        window.syncDom(); 
        return; 
    } 
    
    if(btnMain) btnMain.style.display = 'flex'; 
    if(btnManualContinue) btnManualContinue.style.display = 'none'; 
    if(btnRandomContinue) btnRandomContinue.style.display = 'none';
    
    if(btnLeft) { 
        btnLeft.style.display = 'block'; 
        btnLeft.textContent = "VYHLÁSIT ZNOVU"; 
        btnLeft.style.backgroundColor = "#dbe4eb"; 
        btnLeft.style.color = "#333"; 
    }
    
    if (drivePhase === 0) { 
        if(btnMainTxt) btnMainTxt.textContent = "VYHLÁSIT ZASTÁVKU"; 
        if(btnSub) btnSub.textContent = stops[realIdx] ? "Aktuální: " + stops[realIdx].name : "KONEC"; 
        if(btnMain) btnMain.style.backgroundColor = "var(--idpk-yellow)"; 
    } else { 
        if(btnMainTxt) btnMainTxt.textContent = "VYHLÁSIT PŘÍŠTÍ"; 
        if(btnSub) btnSub.textContent = stops[realIdx+1] ? "Příští: " + stops[realIdx+1].name : "KONEC TRASY"; 
        if(btnMain) btnMain.style.backgroundColor = "#eebb00"; 
    } 
    
    let rStop = document.getElementById('drive-real-stop'); 
    if(rStop) rStop.textContent = stops[realIdx] ? (realIdx+1)+". "+stops[realIdx].name : "NAČÍTÁNÍ..."; 
    
    let nStop = document.getElementById('drive-next-stop'); 
    if(nStop) nStop.textContent = stops[realIdx+1] ? "Příští: "+stops[realIdx+1].name : "Načítání..."; 
    
    const box = document.getElementById('drive-preview-box'); 
    const boxText = document.getElementById('drive-preview-text'); 
    const isEditing = (stopSelectionBuffer.length > 0) || (previewIdx !== realIdx); 
    
    if (isEditing) { 
        if(box) box.style.display = 'block'; 
        let typed = stopSelectionBuffer.length > 0 ? stopSelectionBuffer : (previewIdx + 1); 
        let stopName = stops[previewIdx] ? stops[previewIdx].name : "NEPLATNÉ ČÍSLO"; 
        
        if(boxText) {
            boxText.innerHTML = `<span style="font-size:14px; color:var(--idpk-yellow); text-transform:uppercase;">VYBRÁNA ZASTÁVKA: ${typed}</span><br><span style="font-size:18px; color:white; font-weight:bold;">${stopName}</span><br><span style="font-size:11px; color:#aaa; margin-top:5px; display:block;">Potvrdit černou tečkou [●]</span>`; 
        }
    } else { 
        if(box) box.style.display = 'none'; 
    } 
    window.syncDom();
};

window.handleKeyInput = function(key, code) {
    if (window.isModalOpen()) { 
        if (key === 'Escape') { 
            window.closeFunkMenu(); 
            window.closeSupporters(); 
            window.closeErrorModal(); 
            window.closeAnnouncement();
            let s = document.getElementById('settings-modal'); 
            if(s) s.style.display='none'; 
            let d = document.getElementById('debug-overlay'); 
            if(d) d.style.display='none'; 
            let f = document.getElementById('feedback-modal');
            if(f) f.style.display='none';
            window.syncDom(); 
        } 
        return; 
    }
    
    if (appState === 'LOGIN_DISCORD') { 
        if (key === 'Enter' || code === 'NumpadEnter') { 
            window.startDiscordAuth(); 
        } else if (key.length === 1 && !key.ctrlKey && !key.altKey) { 
            let inputEl = document.getElementById('login-identifier-input'); 
            if (inputEl && document.activeElement !== inputEl && !inputEl.disabled) { 
                inputEl.focus(); 
            } 
        } 
        return; 
    }

    if (appState === 'LOGIN_AUTO') { 
        if (key === 'Enter' || code === 'NumpadEnter') { 
            window.finalizeLogin(); 
        } 
        return; 
    }

    if (key === 'F5') {
        debugLog("Vynucený restart grafiky druhého monitoru (F5).");
        ipcRenderer.send('reload-panel-window');
        setTimeout(() => {
            ipcRenderer.send('open-panel-window');
            ipcRenderer.send('panel-idle');
        }, 500);
        return;
    }
    
    if (key.toLowerCase() === 's' && appState === 'DRIVE') { 
        window.triggerStopAction(); 
        return; 
    }
    
    if (['0','1','2','3','4','5','6','7','8','9'].includes(key) || (code && code.startsWith('Numpad') && code.length === 7)) { 
        let num = key; 
        if (code && code.startsWith('Numpad')) {
            num = code.slice(-1); 
        }
        window.pressKey(num); 
    }
    else if (key === 'Enter' || code === 'NumpadEnter') { window.handleEnterOrStop(); }
    else if (key === 'Backspace' || key === 'Delete') { window.deleteChar(); }
    else if (key === 'ArrowUp') { window.moveArrow('up'); }
    else if (key === 'ArrowDown') { window.moveArrow('down'); }
    else if (key === '*' || code === 'NumpadMultiply') { window.confirmSelection(); }
    else if (key === ' ') { if (appState === 'DRIVE') window.smartButtonAction(); }
    else if (key.toLowerCase() === 'r') { if (appState === 'DRIVE') window.handleLeftButton(); }
    else if (key === 'Escape') { 
        if (appState === 'DRIVE') { 
            if(confirm("Ukončit jízdu?")) window.handleTerminate(); 
        } else if (appState !== 'LOCKED' && !appState.startsWith('LOGIN')) { 
            window.softReset(); 
        } 
    }
}

document.addEventListener('keydown', (e) => { 
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') {
            window.handleKeyInput(e.key, e.code);
        }
        return; 
    }

    if (e.key === ' ' && !window.isModalOpen()) {
        e.preventDefault(); 
    }
    if (e.key === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault(); 
    }
    window.handleKeyInput(e.key, e.code); 
});

window.pressKey = function(key) { 
    window.playClick(); 
    if(appState === 'LOGIN_PIN_SETUP' || appState === 'LOGIN_PIN_ENTER') { 
        window.submitPinNumber(key); 
    } else if(appState === 'LINKOSPOJ') { 
        inputValues.linkospoj += key; 
        window.updateLinkospojDisplay(); 
        window.updateFilter(); 
        window.updateLinkospojUI(); 
    } else if(appState === 'IDPK_LINE') { 
        if (linkospojFocus === 'list') { 
            linkospojFocus = 'input'; 
            isListOpen = false; 
            window.updateLinkospojUI(); 
        } 
        inputValues.idpk += key; 
        selectedIdpkRouteId = ""; 
        let disp = document.getElementById('display-idpk'); 
        if(disp) disp.textContent = inputValues.idpk; 
        window.updateFilter(); 
        window.updateLinkospojUI(); 
    } else if(appState === 'DRIVE') { 
        stopSelectionBuffer += key; 
        const num = parseInt(stopSelectionBuffer); 
        if (!isNaN(num) && num > 0 && num <= routeData.stops.length) {
            routeData.previewStopIndex = num - 1; 
        }
        window.updateDriveUI(); 
    } 
};

window.deleteChar = function() { 
    window.playClick(); 
    if(appState === 'LOGIN_PIN_SETUP') { 
        inputValues.pinSetup = inputValues.pinSetup.slice(0, -1); 
        window.updatePinVisuals('pinSetup'); 
    } else if(appState === 'LOGIN_PIN_ENTER') { 
        inputValues.pinEnter = inputValues.pinEnter.slice(0, -1); 
        window.updatePinVisuals('pinEnter'); 
    } else if (appState === 'LINKOSPOJ') { 
        inputValues.linkospoj = inputValues.linkospoj.slice(0, -1); 
        window.updateLinkospojDisplay(); 
        window.updateFilter(); 
        window.updateLinkospojUI(); 
    } else if (appState === 'IDPK_LINE') { 
        inputValues.idpk = inputValues.idpk.slice(0, -1); 
        selectedIdpkRouteId = ""; 
        let disp = document.getElementById('display-idpk'); 
        if(disp) disp.textContent = inputValues.idpk || '-----'; 
        window.updateFilter(); 
        window.updateLinkospojUI(); 
    } else if (appState === 'DRIVE') { 
        stopSelectionBuffer = stopSelectionBuffer.slice(0, -1); 
        if (stopSelectionBuffer.length === 0) {
            routeData.previewStopIndex = routeData.realStopIndex; 
        } else { 
            const num = parseInt(stopSelectionBuffer); 
            if (!isNaN(num) && num > 0 && num <= routeData.stops.length) {
                routeData.previewStopIndex = num - 1; 
            }
        } 
        window.updateDriveUI(); 
    } 
};

window.moveArrow = function(dir) { 
    window.playClick(); 
    if (appState === 'LINKOSPOJ' || appState === 'IDPK_LINE') { 
        if (dir === 'down') { 
            if (linkospojFocus === 'input') { 
                linkospojFocus = 'list'; 
                window.updateLinkospojUI(); 
            } else if (isListOpen) { 
                selectedListIndex++; 
                window.renderLinkList(); 
            } 
        } else { 
            if (linkospojFocus === 'list' && selectedListIndex > 0) { 
                selectedListIndex--; 
                window.renderLinkList(); 
            } else { 
                linkospojFocus = 'input'; 
                window.updateLinkospojUI(); 
            } 
        } 
    } else if (appState === 'DRIVE') { 
        stopSelectionBuffer = ""; 
        if (dir === 'down') { 
            if (routeData.previewStopIndex < routeData.stops.length - 1) {
                routeData.previewStopIndex++; 
            }
        } else { 
            if (routeData.previewStopIndex > 0) {
                routeData.previewStopIndex--; 
            }
        } 
        window.updateDriveUI(); 
    } 
};

window.confirmSelection = function() { 
    window.playClick(); 
    if (appState === 'LINKOSPOJ') { 
        if (linkospojFocus === 'list') { 
            if (isListOpen && selectedListIndex >= 0 && filteredFiles[selectedListIndex]) { 
                inputValues.linkospoj = filteredFiles[selectedListIndex]; 
                linkospojFocus = 'input'; 
                isListOpen = false; 
                window.updateLinkospojDisplay(); 
                window.updateLinkospojUI(); 
            } else { 
                window.toggleListMouse(); 
            } 
        } 
    } else if (appState === 'IDPK_LINE') { 
        if (linkospojFocus === 'list') { 
            if (isListOpen && selectedListIndex >= 0 && filteredFiles[selectedListIndex]) { 
                const parts = filteredFiles[selectedListIndex].split('|'); 
                inputValues.idpk = parts[0].trim(); 
                selectedIdpkRouteId = parts[2] ? parts[2].trim() : ""; 
                let disp = document.getElementById('display-idpk'); 
                if(disp) disp.textContent = inputValues.idpk; 
                linkospojFocus = 'input'; 
                isListOpen = false; 
                window.updateLinkospojUI(); 
                window.submitAction(); 
            } else { 
                window.toggleListMouse(); 
            } 
        } 
    } else if (appState === 'DRIVE') { 
        if (window.isAtEndOfRoute()) return; 
        
        if (routeData.previewStopIndex !== routeData.realStopIndex) { 
            if (isDelayAuto) { 
                isDelayAuto = false; 
                window.updateBtnState('btn-delay-auto', false); 
                lockedAutoDelayMins = null; 
                lockedAutoStartTimeMins = null; 
                window.updateAHIndicator(); 
            } 
        } 
        
        routeData.realStopIndex = routeData.previewStopIndex; 
        stopSelectionBuffer = ""; 
        drivePhase = 0; 
        
        if (isClassicAuto) {
            window.syncTimeWithCurrentStop(); 
        }
        
        window.sendDataToPanel(); 
        window.updateDriveUI(); 
    } 
};

window.handleEnterOrStop = function() { 
    window.playClick(); 
    if (appState === 'DRIVE') {
        window.triggerStopAction(); 
    } else if (appState === 'LOGIN_DISCORD') { 
        return; 
    } else {
        window.submitAction(); 
    }
};

window.triggerStopAction = function() { 
    window.playClick(); 
    if (drivePhase === 1 || isStopCooldown) return; 
    isStopCooldown = true; 
    
    setTimeout(() => { 
        isStopCooldown = false; 
    }, 5000); 
    
    window.playStopSound(); 
    
    if (!stopPressed) { 
        stopPressed = true; 
        ipcRenderer.send('broadcast-stop-state', true); 
        window.updateStopVisuals(); 
        window.sendDataToPanel(false); 
        const btn = document.getElementById('key-ent'); 
        if(btn) { 
            btn.classList.add('blink-trigger'); 
            setTimeout(() => {
                btn.classList.remove('blink-trigger')
            }, 1000); 
        } 
    } 
};

window.manualResetStop = function() { 
    window.playClick(); 
    stopPressed = false; 
    ipcRenderer.send('broadcast-stop-state', false); 
    window.updateStopVisuals(); 
    window.sendDataToPanel(false); 
    window.toggleSettings(); 
};

window.updateStopVisuals = function() { 
    const btn = document.getElementById('key-ent'); 
    const ind = document.getElementById('drive-stop-indicator'); 
    if (appState === 'DRIVE') { 
        if(btn){
            btn.textContent = "STOP"; 
            btn.className = "btn btn-stop";
        } 
        if(ind) {
            ind.style.display = stopPressed ? 'block' : 'none'; 
        }
    } else { 
        if(btn){
            btn.textContent = "ENT"; 
            btn.className = "btn btn-confirm";
        } 
        if(ind) {
            ind.style.display = 'none'; 
        }
    } 
    window.syncDom(); 
};

window.playStopSound = function() { 
    if (isPlayingQueue || audioQueue.length > 0) {
        pendingStopSound = true; 
    } else {
        window.playDirectAudio('zvuky/hlaseni/ZASTAVIME.wav'); 
    }
};

window.playAudioSequence = function(fileList) { 
    if (routeData.isMuted) return; 
    lastPlayedSequence = [...fileList]; 
    fileList.forEach(f => { 
        audioQueue.push({ file: f }); 
    }); 
    isAnnouncementPlaying = true; 
    window.processAudioQueue(); 
};

window.processAudioQueue = function() { 
    if (isPlayingQueue) return; 
    
    if (audioQueue.length === 0) { 
        if (pendingStopSound) { 
            pendingStopSound = false; 
            window.playDirectAudio('zvuky/hlaseni/ZASTAVIME.wav', true); 
            return; 
        } 
        setTimeout(() => { 
            isAnnouncementPlaying = false; 
            autoAnnounceCooldown = false; 
            if (isClassicAuto && appState === 'DRIVE' && !routeStartupWait) {
                window.scheduleClassicAuto(); 
            }
        }, 1000); 
        return; 
    } 
    
    isPlayingQueue = true; 
    const item = audioQueue.shift(); 
    window.playDirectAudio(item.file, true); 
};

// --- OPRAVENÁ DETEKCE CHYBEJÍCÍCH ZVUKŮ S ODESLÁNÍM DO DISCORDU ---
window.playDirectAudio = function(relativePath, fromQueue = false) { 
    let absolutePath = "file:///" + path.join(getBasePath(), relativePath).replace(/\\/g, '/'); 
    audioPlayer.src = absolutePath; 
    
    audioPlayer.onended = () => { 
        if (fromQueue) { 
            isPlayingQueue = false; 
            window.processAudioQueue(); 
        } 
    }; 
    
    audioPlayer.onerror = (e) => { 
        let dId = localStorage.getItem('discordId') || storedDiscordId || "Neznámý";
        let nick = localStorage.getItem('discordNick') || "Neznámý";
        
        let stopName = window.currentAnnouncingStopName || "Neznámá zastávka";
        let errMsg = `U zastávky [${stopName}] chybí fyzický zvukový soubor ve složce zvuky/zastavky: ${relativePath.split('/').pop()}`;
        
        debugLog("<span style='color:#e74c3c;'>[CHYBA LINKY " + routeData.line + "] " + errMsg + "</span>");
        
        fetchBlesk(`${API_BASE}/api/report_error`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: dId, nick: nick, type: `CHYBA - LINKA ${routeData.line}`, message: errMsg })
        }, 3000).catch(()=>{});

        if (fromQueue) { 
            isPlayingQueue = false; 
            window.processAudioQueue(); 
        } 
    }; 
    
    audioPlayer.play().catch(e => { 
        let dId = localStorage.getItem('discordId') || storedDiscordId || "Neznámý";
        let nick = localStorage.getItem('discordNick') || "Neznámý";
        
        let stopName = window.currentAnnouncingStopName || "Neznámá zastávka";
        let errMsg = `Nelze přehrát zvuk (chybný formát/kodek) pro zastávku [${stopName}]: ${relativePath.split('/').pop()}`;
        
        debugLog("<span style='color:#e74c3c;'>[CHYBA LINKY " + routeData.line + "] " + errMsg + "</span>");
        
        fetchBlesk(`${API_BASE}/api/report_error`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: dId, nick: nick, type: `CHYBA - LINKA ${routeData.line}`, message: errMsg })
        }, 3000).catch(()=>{});

        if (fromQueue) { 
            isPlayingQueue = false; 
            window.processAudioQueue(); 
        } 
    }); 
};

window.syncDom = function() {
    try {
        document.querySelectorAll('input').forEach(i => { 
            if (i.getAttribute('value') !== i.value) {
                i.setAttribute('value', i.value); 
            }
        });
        
        document.querySelectorAll('.link-list-container, #direction-list, .settings-modal, .funk-modal, #debug-overlay, .announcement-content').forEach(el => {
            if(el.scrollTop > 0) { 
                if (el.getAttribute('data-scroll') !== String(el.scrollTop)) {
                    el.setAttribute('data-scroll', el.scrollTop); 
                }
            } else { 
                el.removeAttribute('data-scroll'); 
            }
        });
        
        const bodyClone = document.body.cloneNode(true);
        const scripts = bodyClone.querySelectorAll('script'); 
        scripts.forEach(s => s.remove());
        const audios = bodyClone.querySelectorAll('audio'); 
        audios.forEach(a => a.remove());
        const pcDot = bodyClone.querySelector('#mobile-conn-dot'); 
        if (pcDot) pcDot.remove();
        
        ipcRenderer.send('sync-dom', bodyClone.innerHTML);
    } catch(e) {}
}

ipcRenderer.on('mobile-action', (event, actionStr) => {
    let parts = actionStr.split(':::'); 
    let cmd = parts[0];
    
    if (cmd === 'updateDelayDisplay') { 
        let d = document.getElementById('delay-slider'); 
        if(d) d.value = parts[1]; 
        window.updateDelayDisplay(); 
    }
    else if (cmd === 'setFictionalTime') { 
        let f = document.getElementById('fictional-time-input'); 
        if(f) f.value = parts[1]; 
        window.setFictionalTime(); 
    }
    else if (cmd === 'submitPinNumber') { 
        window.submitPinNumber(parts[1]); 
    }
    else { 
        if (typeof window[cmd] === 'function') { 
            window[cmd](...parts.slice(1)); 
        } 
    }
});