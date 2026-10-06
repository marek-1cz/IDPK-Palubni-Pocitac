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
    ipcRenderer.send('minimize-app');
});

const SUPABASE_URL = 'https://tdonrppusbwhoftdontz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkb25ycHB1c2J3aG9mdGRvbnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDI1NDIsImV4cCI6MjA4ODM3ODU0Mn0.4RLDe65aE5aW1HtWkfgS0QL6JY1MNzGrA7yfnehBFzo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

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
    currentHWID = await getHWID();
    hwidText.innerText = "HWID: " + currentHWID;
    
    let config = loadConfig();
    if (config.auto_launch === undefined) {
        config.auto_launch = true;
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
    const email = inputEmail.value.trim();
    if (!email || !email.includes('@')) {
        showLoginError("Zadejte platný e-mail!");
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
            body: JSON.stringify({ email: email, intent: 'app_login' })
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
                let { data: pollData, error: pollErr } = await supabase.from('users').select('*').eq('email', email).single();
                if (pollErr && (pollErr.code === '402' || pollErr.message?.includes('402'))) {
                    clearInterval(window.emailPollInterval);
                    if (statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #ef4444; margin-right: 5px;"></i>Datab\u00e1ze nedostupn\u00e1 (limit)';
                    return;
                }
                if (pollData && pollData.web_session_token && pollData.web_session_token !== emailAuthOldToken) {
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
            let { data } = await supabase.from('users').select('*').eq('email', email).eq('login_token', code).single();
            if (data) {
                await supabase.from('users').update({ login_token: '' }).eq('id', data.id);
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
        hwidDisplay.innerText = config.discord_nick || currentHWID;
        
        // Získat roli z users tabulky
        let { data, error } = await supabase.from('users').select('role, avatar_url').eq('discord_id', config.discord_id).single();
        if (data) {
            currentUserRole = data.role || 'User';
            
            // Uložit roli do config.json pro Ovladač (Premium detekce)
            config.user_role = currentUserRole;
            saveConfig(config);

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
    document.getElementById('initial-loading-overlay').style.display = 'none';
    let dbVersions = [];
    try {
        let cfg = loadConfig();
        if (cfg.offline_mode) {
            dbVersions = [{
                id: 'offline',
                name: 'Ovladač (Offline Režim)',
                type: 'STABLE',
                version_code: '1.0.0',
                folder_name: 'Ovladač',
                has_access: true,
                can_launch: true
            }];
            currentUserRole = cfg.user_role || 'DEV';
            return;
        }

        let id_param = cfg.discord_id;
        if (!id_param && cfg.email) id_param = 'email-' + cfg.email; // Fallback
        const res = await fetch(`${API_BASE}/api/launcher/versions?discord_id=${id_param}`);
        const data = await res.json();
                if (data.status === 'ok') {
            dbVersions = data.versions;
            if (data.user_role) currentUserRole = data.user_role;
        } else if (data.status === 'error') {
            // Detekuj jestli je to DB/Supabase blokace (402 / egress limit)
            let isDbBlock = data.message && (
                data.message.includes('402') ||
                data.message.includes('egress') ||
                data.message.includes('exceed') ||
                data.message.includes('restricted') ||
                data.message.includes('Payment')
            );
            document.getElementById('initial-loading-overlay').style.display = 'flex';
            if (isDbBlock) {
                document.getElementById('initial-loading-overlay').innerHTML = `
                    <div style="background: #111; padding: 25px; border-radius: 8px; text-align: center; max-width: 400px; position: relative; overflow: hidden; font-family: sans-serif;">
                        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; border: 4px solid transparent; border-image: repeating-linear-gradient(45deg, #ef4444, #ef4444 10px, transparent 10px, transparent 20px) 1; pointer-events: none;"></div>
                        <div style="padding: 10px; position: relative; z-index: 2;">
                            <i class="fas fa-exclamation-triangle" style="font-size: 32px; color: #ef4444; margin-bottom: 15px;"></i>
                            <h2 style="color: white; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; font-size: 18px;">Systém je offline</h2>
                            <h3 style="color: #ef4444; margin-bottom: 15px; font-size: 14px;">Databáze je dočasně nedostupná</h3>
                            <p style="color: #cbd5e1; font-size: 13px; line-height: 1.5; margin-bottom: 25px;">
                                O tom jestli systém běží nebo ne se informujete na našem discordu (server Projekt OIS IDPK).
                            </p>
                            <button onclick="window.close()" style="width: 100%; background: #ef4444; border: none; color: white; padding: 10px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold; text-transform: uppercase; margin-bottom: 10px; transition: 0.2s;">
                                Zavřít aplikaci
                            </button>
                            <button onclick="document.getElementById('dev-login-panel').style.display='block'; this.style.display='none';" style="background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #64748b; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 9px; float: right;">
                                DEV
                            </button>
                            <div id="dev-login-panel" style="display: none; text-align: left; margin-top: 25px; border-top: 1px solid rgba(239,68,68,0.2); padding-top: 15px;">
                                <p style="color: #ef4444; font-size: 11px; margin-bottom: 8px; font-weight: bold;"><i class="fas fa-shield-alt"></i> NOUZOVÝ REŽIM (ADMIN)</p>
                                <input id="ol-username" type="text" placeholder="Uživatelské jméno" value=""
                                    style="width:100%; padding:8px; background:rgba(255,255,255,0.05); border:1px solid rgba(239,68,68,0.3); border-radius:4px; color:white; font-size:12px; box-sizing:border-box; margin-bottom:6px;">
                                <input id="ol-password" type="password" placeholder="Heslo"
                                    style="width:100%; padding:8px; background:rgba(255,255,255,0.05); border:1px solid rgba(239,68,68,0.3); border-radius:4px; color:white; font-size:12px; box-sizing:border-box; margin-bottom:10px;">
                                <button onclick="doLauncherOfflineLogin()" style="width:100%; background:rgba(239,68,68,0.15); color:#fca5a5; border:1px solid #ef4444; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">
                                    PŘIHLÁSIT SE
                                </button>
                                <p id="ol-err" style="color:#f87171; font-size:11px; margin-top:5px; min-height:14px; text-align: center;"></p>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                document.getElementById('initial-loading-overlay').innerHTML = `
                    <div style="background: rgba(239, 68, 68, 0.2); padding: 30px; border-radius: 15px; border: 1px solid rgba(239, 68, 68, 0.5); text-align: center; max-width: 400px;">
                        <i class="fas fa-lock" style="font-size: 40px; color: #ef4444; margin-bottom: 20px;"></i>
                        <h2 style="color: white; margin-bottom: 10px;">Přístup Zablokován</h2>
                        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">${data.message || 'Launcher je dočasně uzamčen.'}</p>
                        <button onclick="window.close()" style="margin-top: 20px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Zavřít</button>
                    </div>
                `;
            }
            return; // Stop initialization
                } else if (data.status === 'banned') {
            document.getElementById('initial-loading-overlay').style.display = 'flex';
            document.getElementById('initial-loading-overlay').innerHTML = `
                <div style="background: rgba(185, 28, 28, 0.9); padding: 40px; border-radius: 15px; border: 2px solid #ef4444; text-align: center; max-width: 500px; box-shadow: 0 0 40px rgba(239, 68, 68, 0.6); position: relative; overflow: hidden;">
                    <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px); z-index: 1;"></div>
                    <div style="position: relative; z-index: 2;">
                        <i class="fas fa-ban" style="font-size: 60px; color: white; margin-bottom: 20px; filter: drop-shadow(0 0 10px rgba(255,255,255,0.5));"></i>
                        <h1 style="color: white; margin-bottom: 15px; font-size: 28px; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">Účet Zablokován</h1>
                        <p style="color: #fca5a5; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                            Váš účet byl zablokován administrátorem.<br><br>
                            Pokud se domníváte, že se jedná o omyl a chcete se odvolat, vytvořte si ticket na našem Discordu v kanále <strong>#💁‍♂️・podpora-založení-ticketu</strong>.
                        </p>
                        <button onclick="window.close()" style="background: #171717; border: 1px solid #404040; color: white; padding: 12px 30px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px; transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">UKONČIT LAUNCHER</button>
                    </div>
                </div>
            `;
            return; // Zastavit načítání
        } else {
            console.error("Chyba při načítání verzí z API:", data.message);
        }
    } catch(e) {
        console.error("Síťová chyba při načítání verzí z API:", e);
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

function checkLocalVersion(versionName) {
    const selectedVersion = availableVersions.find(v => v.db_version === versionName);
    if (!selectedVersion) {
        btnLaunch.classList.add('btn-locked');
        launchText.innerText = "ŽÁDNÉ VERZE K DISPOZICI";
        launchIcon.className = "fas fa-times";
        return;
    }

    const folder = getVersionFolder(versionName);
    let hasLocalCopy = false;
    
    // Check main folder for any .exe
    if (fs.existsSync(folder)) {
        let files = [];
        try { files = fs.readdirSync(folder); } catch(e){}
        let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
        if (exeFile) hasLocalCopy = true;
        
        // Check subfolder
        let subFolder = path.join(folder, 'win-unpacked');
        if (!hasLocalCopy && fs.existsSync(subFolder)) {
            let subFiles = [];
            try { subFiles = fs.readdirSync(subFolder); } catch(e){}
            let subExe = subFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
            if (subExe) hasLocalCopy = true;
        }
    }

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
        } else {
            launchText.innerText = "HRÁT";
            launchIcon.className = "fas fa-play";
            btnLaunch.classList.remove('btn-locked'); btnLaunch.disabled = false;
            btnLaunch.title = "";
        }
    } else {
        if (!selectedVersion.has_access) {
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
            launchText.innerText = "STÁHNOUT";
            launchIcon.className = "fas fa-download";
            btnLaunch.classList.remove('btn-locked'); btnLaunch.disabled = false;
            btnLaunch.title = "";
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

    // Blesková ověřovací kontrola
    try {
        let cfg = loadConfig();
        let id_param = cfg.discord_id;
        if (!id_param && cfg.email) id_param = 'email-' + cfg.email;
        const resCheck = await fetch(`${API_BASE}/api/launcher/versions?discord_id=${id_param}`);
        const dataCheck = await resCheck.json();
        if (dataCheck.status === 'ok') {
            const currentV = dataCheck.versions.find(v => v.db_version === versionName);
            if (currentV) {
                // Aktualizace lokálního pole pro správný refresh
                let localV = availableVersions.find(v => v.db_version === versionName);
                if (localV) {
                    localV.can_launch = currentV.can_launch;
                    localV.can_download = currentV.can_download;
                    localV.has_access = currentV.has_access;
                }
                
                // Pokud už ztratil právo
                if (!currentV.has_access) {
                    alert("Ztratil jsi oprávnění k této verzi.");
                    isLaunchingApp = false;
                    checkLocalVersion(versionName);
                    return;
                }
                
                // Je stažená, ale nelze spustit? (Pokud se teprve bude stahovat, to řešíme níž)
            }
        } else if (dataCheck.status === 'error') {
            alert(dataCheck.message || "Launcher je dočasně uzamčen.");
            isLaunchingApp = false;
            btnLaunch.classList.add('btn-locked');
            return;
        }
    } catch (e) {
        console.error("Nepodařilo se ověřit oprávnění", e);
    }
        
    const versionName = versionSelect.value;
    const folder = getVersionFolder(versionName);
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
                    
                    // Najít EXE
                    let files = await fs.promises.readdir(folder);
                    let exeFile = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
                    
                    if (exeFile) {
                        const selectedVersion = availableVersions.find(v => v.db_version === versionName);
                        if (selectedVersion && selectedVersion.can_launch && selectedVersion.has_access) {
                            launchApp(path.join(folder, exeFile));
                        } else {
                            // Je zablokovaná, po stažení nespouštět!
                            const isBlocked = (!selectedVersion || !selectedVersion.has_access || !selectedVersion.can_launch);
                            secureExecutable(folder, isBlocked);
                            progressContainer.style.display = 'none';
                            launchText.innerText = "STAŽENO";
                            launchIcon.className = "fas fa-check";
                            btnLaunch.classList.add('btn-locked');
                            checkLocalVersion(versionName);
                        }
                    } else {
                        // Možná je to o složku níž v win-unpacked?
                        if(fs.existsSync(path.join(folder, 'win-unpacked'))) {
                            let subFiles = await fs.promises.readdir(path.join(folder, 'win-unpacked'));
                            let subExe = subFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
                            if(subExe) {
                                const selectedVersion = availableVersions.find(v => v.db_version === versionName);
                                if (selectedVersion && selectedVersion.can_launch && selectedVersion.has_access) {
                                    launchApp(path.join(folder, 'win-unpacked', subExe));
                                } else {
                                    // Zablokovaná
                                    const isBlocked = (!selectedVersion || !selectedVersion.has_access || !selectedVersion.can_launch);
                                    secureExecutable(path.join(folder, 'win-unpacked'), isBlocked);
                                    progressContainer.style.display = 'none';
                                    launchText.innerText = "STAŽENO";
                                    launchIcon.className = "fas fa-check";
                                    btnLaunch.classList.add('btn-locked');
                                    checkLocalVersion(versionName);
                                }
                                return;
                            }
                        }
                        showError("Staženo, ale nenašel jsem spouštěcí .exe soubor.");
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
        const { shell } = require('electron');
        const udPath = path.join(process.env.APPDATA || os.homedir(), 'idpk-palubni-pocitac', 'userdata');
        if (!fs.existsSync(udPath)) fs.mkdirSync(udPath, { recursive: true });
        shell.openPath(udPath);
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
            if (badge) badge.innerText = v.db_version;
            
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
        const badge = document.getElementById('hero-version-badge');
        if (badge) badge.innerText = versionSelect.value;
        
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
