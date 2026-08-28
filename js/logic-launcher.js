const { ipcRenderer } = require('electron');
const { createClient } = require('@supabase/supabase-js');
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
    // Musíme přidat ipc handler pro minimalizaci, nebo můžeme odeslat quit-app
    // Pro jednoduchost zatím jen zavře okno.
});

const SUPABASE_URL = 'https://tdonrppusbwhoftdontz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkb25ycHB1c2J3aG9mdGRvbnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDI1NDIsImV4cCI6MjA4ODM3ODU0Mn0.4RLDe65aE5aW1HtWkfgS0QL6JY1MNzGrA7yfnehBFzo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const hwidDisplay = document.getElementById('hwid-display');
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
const inputEmailCode = document.getElementById('login-email-code-input');
const btnVerifyEmailCode = document.getElementById('btn-verify-email-code');
const btnCancelEmailAuth = document.getElementById('btn-cancel-email-auth');

const inputIdentifier = document.getElementById('login-identifier-input');
const hwidText = document.getElementById('login-hwid-text');
const autoLaunchCheckbox = document.getElementById('auto-launch-checkbox');

// Vylepšení UX - odeslání přes Enter
inputIdentifier.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnStartAuth.click();
});
inputEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnStartEmailAuth.click();
});
inputEmailCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnVerifyEmailCode.click();
});

let authPollInterval = null;
let currentHWID = '';
const API_BASE = 'https://datacorebot.koyeb.app';
const APP_VERSION = 'V1.6 RC-EDITION';

async function checkAuthAndInit() {
    currentHWID = await getHWID();
    hwidText.innerText = "HWID: " + currentHWID;
    
    let config = loadConfig();
    if (config.auto_launch === undefined) {
        config.auto_launch = true;
    }
    if (config.auto_launch) {
        autoLaunchCheckbox.checked = true;
    }

    if (config.discord_id) {
        // Uživatel už je přihlášen, pustíme ho dál
        initLauncher(config);
    } else {
        // Není přihlášen, zobrazit auth
        document.getElementById('initial-loading-overlay').style.display = 'none';
        loginOverlay.style.display = 'flex';
        showAuthView('discord');
    }
}

function showAuthView(viewName) {
    loginDiscordView.style.display = 'none';
    loginWaitingView.style.display = 'none';
    loginEmailView.style.display = 'none';
    loginEmailCodeView.style.display = 'none';
    if (viewName === 'discord') loginDiscordView.style.display = 'flex';
    if (viewName === 'waiting') loginWaitingView.style.display = 'flex';
    if (viewName === 'email') loginEmailView.style.display = 'flex';
    if (viewName === 'emailCode') loginEmailCodeView.style.display = 'flex';
    
    // Zajištění, že se nezasekne disabled stav (např. při reloadu stránky)
    inputIdentifier.disabled = false;
    inputEmail.disabled = false;
    inputEmailCode.disabled = false;
    btnStartAuth.disabled = false;
    btnStartEmailAuth.disabled = false;
    btnStartEmailAuth.innerText = 'ZASLAT KÓD';
    btnVerifyEmailCode.disabled = false;
    btnVerifyEmailCode.innerText = 'OVĚŘIT KÓD';
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
    const email = inputEmail.value.trim();
    if (!email || !email.includes('@')) {
        alert("Zadejte platný e-mail!");
        return;
    }
    
    btnStartEmailAuth.disabled = true;
    btnStartEmailAuth.innerText = 'ODESÍLÁM...';
    
    let emailAuthOldToken = null;
    try {
        let { data } = await supabase.from('users').select('web_session_token').eq('email', email).single();
        emailAuthOldToken = data ? data.web_session_token : null;
    } catch(e) {}
    
    try {
        const res = await fetch(`${API_BASE}/api/auth/email/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, intent: 'login' })
        });
        
        const data = await res.json();
        if (data.success || res.ok) {
            showAuthView('emailCode');
            if (window.emailPollInterval) clearInterval(window.emailPollInterval);
            window.emailPollInterval = setInterval(async () => {
                let { data: pollData } = await supabase.from('users').select('*').eq('email', email).single();
                if (pollData && pollData.web_session_token && pollData.web_session_token !== emailAuthOldToken) {
                    clearInterval(window.emailPollInterval);
                    let config = loadConfig();
                    config.discord_id = pollData.discord_id || "email-" + pollData.id;
                    config.discord_nick = pollData.nick || pollData.email;
                    config.email = pollData.email;
                    saveConfig(config);
                    loginOverlay.style.display = 'none';
                    initLauncher(config);
                }
            }, 3000);
        } else {
            alert(data.message || "Nepodařilo se odeslat kód na e-mail.");
        }
    } catch (e) {
        alert("Chyba spojení s API.");
    }
    
    btnStartEmailAuth.disabled = false;
    btnStartEmailAuth.innerText = 'ZASLAT KÓD';
});

btnVerifyEmailCode.addEventListener('click', async () => {
    const code = inputEmailCode.value.trim();
    const email = inputEmail.value.trim();
    
    if (code.length !== 5) {
        alert("Zadejte platný 5místný kód.");
        return;
    }
    
    btnVerifyEmailCode.disabled = true;
    btnVerifyEmailCode.innerText = 'OVĚŘUJI...';
    
    try {
        // Kontrola v Supabase tabulce users
        let { data, error } = await supabase.from('users').select('*').eq('email', email).eq('login_token', code).single();
        
        if (data) {
            // Smazat token po použití
            await supabase.from('users').update({ login_token: '' }).eq('id', data.id);
            if (window.emailPollInterval) clearInterval(window.emailPollInterval);
            
            let config = loadConfig();
            config.discord_id = data.discord_id || "email-" + data.id;
            config.discord_nick = data.nick || data.email;
            config.email = data.email;
            saveConfig(config);
            
            loginOverlay.style.display = 'none';
            initLauncher(config);
        } else {
            alert("Neplatný kód nebo vypršela platnost.");
        }
    } catch(e) {
        alert("Chyba při ověřování kódu.");
    }
    
    btnVerifyEmailCode.disabled = false;
    btnVerifyEmailCode.innerText = 'OVĚŘIT KÓD';
});

btnCancelEmailAuth.addEventListener('click', () => {
    if (window.emailPollInterval) clearInterval(window.emailPollInterval);
    showAuthView('email');
    inputEmailCode.value = '';
});

document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm("Opravdu se chcete odhlásit?")) {
        let config = loadConfig();
        config.discord_id = "";
        config.discord_nick = "";
        config.email = "";
        saveConfig(config);
        
        // Znovu zobrazit přihlašovací okno
        document.getElementById('launcher-overlay').style.display = 'none';
        loginOverlay.style.display = 'flex';
        showAuthView('discord');
    }
});

btnCancelAuth.addEventListener('click', () => {
    if (authPollInterval) clearInterval(authPollInterval);
    showAuthView('discord');
    inputIdentifier.disabled = false;
});

btnStartAuth.addEventListener('click', async () => {
    const val = inputIdentifier.value.trim();
    if (!val) { alert("Zadejte ID nebo Nick!"); return; }
    
    inputIdentifier.disabled = true;
    showAuthView('waiting');

    try {
        const fetchTimeout = (url, options, timeout = 6000) => {
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

        const isDevMode = !__dirname.includes('app.asar');

        if (data.status === 'waiting' || isDevMode) {
            if (isDevMode && data.status !== 'waiting') {
                data.discord_id = val;
            }
            authPollInterval = setInterval(() => pollAuth(data.discord_id), 2000);
        } else {
            alert(data.message || "Přístup odepřen.");
            showAuthView('discord');
            inputIdentifier.disabled = false;
        }
    } catch(e) {
        alert("Chyba spojení.");
        showAuthView('discord');
        inputIdentifier.disabled = false;
    }
});

async function pollAuth(discordId) {
    try {
        const isDevMode = !__dirname.includes('app.asar');
        const res = await fetch(`${API_BASE}/api/app_check`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_id: discordId, hwid: currentHWID })
        });
        const data = await res.json();
        
        if (data.status === 'success' || isDevMode) {
            if (isDevMode) {
                console.log("⚠️ VSC REŽIM: Ignoruji chybu Discord Pollingu.");
            }
            clearInterval(authPollInterval);
            let config = loadConfig();
            config.discord_id = discordId;
            config.discord_nick = data.display_name || (isDevMode ? "VSC-DEV" : "Neznámý");
            saveConfig(config);
            
            loginOverlay.style.display = 'none';
            initLauncher(config);
        } else if (data.status === 'error') {
            clearInterval(authPollInterval);
            alert(data.message || "Zamítnuto v Discordu.");
            showAuthView('discord');
            inputIdentifier.disabled = false;
        }
    } catch(e) {}
}

async function initLauncher(config) {
    try {
        hwidDisplay.innerText = config.discord_nick || currentHWID;
        
        // Získat roli z users tabulky
        let { data, error } = await supabase.from('users').select('role, avatar_url').eq('discord_id', config.discord_id).single();
        if (data) {
            currentUserRole = data.role || 'User';
            if (data.avatar_url) {
                // Najít element pro avatar
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
            currentUserRole = 'User';
        }
        
        let color = '#64748b'; // public
        if (currentUserRole.includes('DEV') || currentUserRole.includes('SA')) color = '#ef4444';
        else if (currentUserRole.includes('BT')) color = '#3b82f6';
        
        roleDisplay.innerText = currentUserRole.toUpperCase();
        roleDisplay.style.backgroundColor = color;

        await loadAvailableVersions();
    } catch(e) {
        alert("Chyba při startu: " + e.message + "\n\n" + e.stack);
    }
}

async function loadAvailableVersions() {
    let { data: dbVersions, error } = await supabase.from('software_versions').select('*').eq('is_active', true);
    if (error) {
        console.error("Chyba při načítání verzí z DB:", error);
        dbVersions = [];
    }

    const sortedActive = dbVersions.sort((a,b) => b.id - a.id); // Od nejnovější
    
    let finalVersions = [];
    
    sortedActive.forEach(v => {
        // Zkontrolovat jestli se má zobrazit v launcheru (defaultně ano)
        if (v.show_in_launcher === false || v.show_in_launcher === "false") return;
        
        let targetRole = v.target_role || 'User';
        let allowed = false;
        
        if (targetRole === 'User') {
            allowed = true;
        } else if (targetRole === 'BT') {
            if (currentUserRole.includes('BT') || currentUserRole.includes('DEV') || currentUserRole.includes('SA')) allowed = true;
        } else if (targetRole === 'DEV_SA') {
            if (currentUserRole.includes('DEV') || currentUserRole.includes('SA')) allowed = true;
        }
        
        if (allowed) finalVersions.push(v);
    });

    versionSelect.innerHTML = '';
    
    if (finalVersions.length === 0) {
        const opt = document.createElement('option');
        opt.innerText = "Žádné verze k dispozici";
        versionSelect.appendChild(opt);
        launchText.innerText = "NENÍ CO HRÁT";
        launchIcon.className = "fas fa-times";
        return;
    }

    availableVersions = finalVersions;
    finalVersions.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.db_version;
        opt.innerText = v.version_name;
        versionSelect.appendChild(opt);
    });

    versionSelect.disabled = false;
    btnLaunch.disabled = false;
    
    document.getElementById('initial-loading-overlay').style.display = 'none';
    
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

function checkLocalVersion(versionName) {
    const folder = getVersionFolder(versionName);
    const exePath = path.join(folder, 'Palubní Počítač IDPK.exe'); // TODO: přesný název .exe

    if (fs.existsSync(exePath) || fs.existsSync(path.join(folder, 'IDPK_OIS.exe'))) {
        launchText.innerText = "HRÁT";
        launchIcon.className = "fas fa-play";
    } else {
        launchText.innerText = "STÁHNOUT";
        launchIcon.className = "fas fa-download";
    }
}

let isLaunchingApp = false;
btnLaunch.addEventListener('click', async () => {
    if (isLaunchingApp) return;
    isLaunchingApp = true;
    btnLaunch.disabled = true;
    
    const versionName = versionSelect.value;
    const folder = getVersionFolder(versionName);
    // Budeme hledat jakýkoliv .exe soubor v adresáři
    
    if (fs.existsSync(folder)) {
        let files = [];
        try { files = fs.readdirSync(folder); } catch(e){}
        let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
        
        if (exeFile) {
            launchApp(path.join(folder, exeFile));
            return;
        }
    }

    // Potřebujeme stáhnout!
    await downloadVersion(versionName, folder);
});

async function downloadVersion(versionName, folder) {
    btnLaunch.disabled = true;
    versionSelect.disabled = true;
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
            file.on('finish', async () => {
                file.close();
                progressText.innerText = 'Rozbalování... (může trvat minutu)';
                launchText.innerText = 'ROZBALOVÁNÍ...';
                
                try {
                    await extract(zipPath, { dir: folder });
                    fs.unlinkSync(zipPath); // Smazat zip
                    
                    // Najít EXE
                    let files = fs.readdirSync(folder);
                    let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
                    
                    if (exeFile) {
                        launchApp(path.join(folder, exeFile));
                    } else {
                        // Možná je to o složku níž v win-unpacked?
                        if(fs.existsSync(path.join(folder, 'win-unpacked'))) {
                            let subFiles = fs.readdirSync(path.join(folder, 'win-unpacked'));
                            let subExe = subFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
                            if(subExe) {
                                launchApp(path.join(folder, 'win-unpacked', subExe));
                                return;
                            }
                        }
                        showError("Staženo, ale nenašel jsem spouštěcí .exe soubor.");
                    }
                } catch(e) {
                    showError("Chyba při rozbalování: " + e.message);
                }
            });
        }).on('error', (e) => {
            fs.unlinkSync(zipPath);
            showError("Chyba sítě: " + e.message);
        });
    };
    
    doDownload(url);
}

function launchApp(exePath) {
    progressContainer.style.display = 'none';
    launchText.innerText = "SPUŠTĚNO";
    launchIcon.className = "fas fa-check";

    // Uložíme konfiguraci
    let config = loadConfig();
    config.last_version = versionSelect.value;
    config.auto_launch = autoLaunchCheckbox.checked;
    
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

checkAuthAndInit();

function showError(msg) {
    alert(msg);
    isLaunchingApp = false;
    btnLaunch.disabled = false;
    versionSelect.disabled = false;
    launchText.innerText = "CHYBA";
    launchIcon.className = "fas fa-exclamation-triangle";
    progressContainer.style.display = 'none';
    checkLocalVersion(versionSelect.value);
    
    // Odeslání logu o chybě do Discordu
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
