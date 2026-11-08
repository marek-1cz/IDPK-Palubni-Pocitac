// js/editor.js
// Logika Editoru vlastních a komunitních linek OIS IDPK

const { ipcRenderer, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const BACKEND_URL = 'https://datacorebot.koyeb.app';

// Centrální userdata cesta
const userDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'idpk-palubni-pocitac') : require('os').homedir();
const configPath = path.join(userDataPath, 'config.json');

let currentUser = {
    discord_id: '',
    discord_nick: 'Hráč',
    role: 'public'
};

function loadUserData() {
    try {
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg.discord_id) currentUser.discord_id = String(cfg.discord_id);
            if (cfg.discord_nick) currentUser.discord_nick = cfg.discord_nick;
            if (cfg.app_id && !currentUser.discord_nick) currentUser.discord_nick = cfg.app_id;
            if (cfg.role) currentUser.role = cfg.role;
        }
    } catch (_) {}
    const userEl = document.getElementById('user-display');
    if (userEl) {
        userEl.innerHTML = `<i class="fab fa-discord" style="color:#5865F2;"></i> ${currentUser.discord_nick} (${currentUser.discord_id || 'Nepřihlášen'})`;
    }
}

// ── PŘEPÍNÁNÍ ZÁLOŽEK ────────────────────────────────────────────────────────

function switchTab(tabKey) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick')?.includes(tabKey));
    if (activeBtn) activeBtn.classList.add('active');

    const pane = document.getElementById(`pane-${tabKey}`);
    if (pane) pane.classList.add('active');

    if (tabKey === 'community-catalog') loadCommunityCatalog();
    if (tabKey === 'my-routes') loadMyRoutes();
    if (tabKey === 'cr-data-tab') refreshCrGtfsStatus();
}

// ── 1. IMPORT Z GTFS ─────────────────────────────────────────────────────────

let currentGtfsLine = null;
let currentGtfsStops = [];
let gtfsAudioFiles = {}; // index -> filePath or File object

document.getElementById('btn-search-gtfs').addEventListener('click', async () => {
    const q = document.getElementById('gtfs-search-input').value.trim();
    const statusEl = document.getElementById('gtfs-search-status');
    const resultsContainer = document.getElementById('gtfs-results-container');

    if (!q) {
        statusEl.innerHTML = '<span style="color:#ef4444;"><i class="fas fa-exclamation-circle"></i> Zadejte číslo linky</span>';
        return;
    }

    statusEl.innerHTML = '<span style="color:#38bdf8;"><i class="fas fa-spinner fa-spin"></i> Vyhledávám v GTFS...</span>';
    resultsContainer.style.display = 'none';

    try {
        const res = await ipcRenderer.invoke('editor-search-gtfs', q);
        if (!res.found) {
            if (res.crMissing) {
                statusEl.innerHTML = `<span style="color:#f59e0b;"><i class="fas fa-info-circle"></i> ${res.msg} <button class="btn btn-primary" style="padding:2px 8px; font-size:11px; margin-left:6px;" onclick="switchTab('cr-data-tab')">Stáhnout data ČR</button></span>`;
            } else {
                statusEl.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> ${res.msg || 'Linka nenalezena.'}</span>`;
            }
            return;
        }

        statusEl.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Nalezeno v ${res.source === 'idpk' ? 'IDPK' : 'celostátních datech ČR'}!</span>`;
        currentGtfsLine = {
            source: res.source,
            route: res.routes[0]
        };

        document.getElementById('gtfs-line-title').innerText = `Linka ${currentGtfsLine.route.route_short_name} • ${currentGtfsLine.route.route_long_name || ''}`;
        document.getElementById('gtfs-line-meta').innerText = `Zdroj: ${res.source.toUpperCase()} • Route ID: ${currentGtfsLine.route.route_id}`;

        // Načíst varianty/směry
        const variants = await ipcRenderer.invoke('editor-get-route-variants', {
            routeId: currentGtfsLine.route.route_id,
            source: currentGtfsLine.source
        });

        const selectEl = document.getElementById('gtfs-variants-select');
        selectEl.innerHTML = '';
        variants.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.trip_id;
            opt.innerText = `${v.trip_headsign || 'Trasa linky'} (${v.stop_count} zastávek)`;
            selectEl.appendChild(opt);
        });

        if (variants.length > 0) {
            loadGtfsVariantStops(variants[0].trip_id);
        }

        resultsContainer.style.display = 'block';
    } catch (e) {
        statusEl.innerHTML = `<span style="color:#ef4444;">Chyba vyhledávání: ${e.message}</span>`;
    }
});

document.getElementById('gtfs-variants-select').addEventListener('change', (e) => {
    loadGtfsVariantStops(e.target.value);
});

async function loadGtfsVariantStops(tripId) {
    if (!currentGtfsLine) return;
    const stops = await ipcRenderer.invoke('editor-get-variant-stops', {
        tripId,
        source: currentGtfsLine.source
    });

    currentGtfsStops = stops;
    gtfsAudioFiles = {};
    renderGtfsStopsTable();
}

function renderGtfsStopsTable() {
    const tbody = document.getElementById('gtfs-stops-tbody');
    tbody.innerHTML = '';
    document.getElementById('stops-counter').innerText = `Celkem zastávek: ${currentGtfsStops.length}`;

    currentGtfsStops.forEach((s, idx) => {
        const tr = document.createElement('tr');
        const assignedFile = gtfsAudioFiles[idx];
        const audioSrc = assignedFile ? (assignedFile.path ? 'file://' + assignedFile.path.replace(/\\/g, '/') : '') : '';

        tr.innerHTML = `
            <td style="color:#94a3b8; font-weight:bold;">${idx + 1}</td>
            <td style="font-weight:bold; color:#fff;">${s.name}</td>
            <td style="color:#cbd5e1;">${s.time || '--:--'}</td>
            <td style="color:#38bdf8;">${s.zone || 'P'}</td>
            <td>${s.na_znameni ? '<span style="color:#f59e0b; font-size:11px; font-weight:bold;"><i class="fas fa-hand-paper"></i> (x)</span>' : '<span style="color:#64748b; font-size:11px;">stálá</span>'}</td>
            <td>
                <div class="audio-slot">
                    <input type="file" id="audio-input-${idx}" accept=".wav,.mp3,.ogg" style="display:none;" onchange="handleGtfsAudioSelect(${idx}, this)">
                    <button class="btn" style="padding:4px 9px; font-size:11px; background:#1e293b; border:1px solid #334155;" onclick="document.getElementById('audio-input-${idx}').click()">
                        <i class="fas fa-file-audio"></i> ${assignedFile ? 'Změnit' : 'Přiřadit audio'}
                    </button>
                    ${assignedFile ? `
                        <span class="audio-badge-ok" title="${assignedFile.name}">
                            <i class="fas fa-check-circle"></i> ${assignedFile.name.length > 18 ? assignedFile.name.substring(0, 16) + '...' : assignedFile.name}
                        </span>
                        ${audioSrc ? `<audio controls src="${audioSrc}" style="height:24px; max-width:140px;"></audio>` : ''}
                        <button class="btn btn-danger" style="padding:2px 6px; font-size:10px;" onclick="removeGtfsAudio(${idx})"><i class="fas fa-times"></i></button>
                    ` : '<span class="audio-badge-missing">Není přiřazeno</span>'}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.handleGtfsAudioSelect = function(idx, input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        gtfsAudioFiles[idx] = {
            file,
            path: file.path || '',
            name: file.name
        };
        renderGtfsStopsTable();
    }
};

window.removeGtfsAudio = function(idx) {
    delete gtfsAudioFiles[idx];
    renderGtfsStopsTable();
};

// Uložení lokálně do userdata
document.getElementById('btn-save-gtfs-local').addEventListener('click', async () => {
    if (!currentGtfsLine || currentGtfsStops.length === 0) return alert('Nejprve vyberte linku a trasu.');
    
    const routeNumber = currentGtfsLine.route.route_short_name;
    const routeName = currentGtfsLine.route.route_long_name || document.getElementById('gtfs-variants-select').selectedOptions[0]?.text || 'Trasa';

    const payload = {
        routeNumber,
        routeName,
        routeType: 'gtfs',
        description: `Linka ${routeNumber} importována z GTFS`,
        stops: currentGtfsStops.map((s, idx) => ({
            ...s,
            audio_file: gtfsAudioFiles[idx]?.name || ''
        })),
        audioFilesMap: Object.fromEntries(
            Object.entries(gtfsAudioFiles).map(([k, v]) => [k, v.path])
        )
    };

    try {
        const res = await ipcRenderer.invoke('editor-save-local-route', payload);
        if (res.success) {
            alert(`✅ Linka ${routeNumber} byla úspěšně uložena do vašich linek (userdata)!\nNyní ji můžete rovnou spustit v palubním počítači.`);
        } else {
            alert(`Chyba při ukládání: ${res.error}`);
        }
    } catch (e) {
        alert(`Chyba: ${e.message}`);
    }
});

// ── 2. VLASTNÍ FIKTIVNÍ LINKA ───────────────────────────────────────────────

let customStops = [
    { name: "Výchozí zastávka", time: "08:00", zone: "P", na_znameni: false, audio_file: "", audio_path: "" },
    { name: "Konečná zastávka", time: "08:15", zone: "P", na_znameni: false, audio_file: "", audio_path: "" }
];

document.getElementById('btn-cust-add-stop').addEventListener('click', () => {
    customStops.push({
        name: `Zastávka ${customStops.length + 1}`,
        time: "",
        zone: "P",
        na_znameni: false,
        audio_file: "",
        audio_path: ""
    });
    renderCustomStopsTable();
});

function renderCustomStopsTable() {
    const tbody = document.getElementById('cust-stops-tbody');
    tbody.innerHTML = '';

    customStops.forEach((s, idx) => {
        const tr = document.createElement('tr');
        const audioSrc = s.audio_path ? 'file://' + s.audio_path.replace(/\\/g, '/') : '';

        tr.innerHTML = `
            <td style="color:#94a3b8; font-weight:bold;">${idx + 1}</td>
            <td>
                <input type="text" value="${s.name}" onchange="customStops[${idx}].name = this.value" style="padding:6px 10px; font-size:12px;">
            </td>
            <td>
                <input type="text" value="${s.time}" placeholder="HH:MM" onchange="customStops[${idx}].time = this.value" style="padding:6px 10px; font-size:12px; max-width:80px;">
            </td>
            <td>
                <input type="text" value="${s.zone}" onchange="customStops[${idx}].zone = this.value" style="padding:6px 10px; font-size:12px; max-width:60px;">
            </td>
            <td style="text-align:center;">
                <input type="checkbox" ${s.na_znameni ? 'checked' : ''} onchange="customStops[${idx}].na_znameni = this.checked">
            </td>
            <td>
                <div class="audio-slot">
                    <input type="file" id="cust-audio-input-${idx}" accept=".wav,.mp3,.ogg" style="display:none;" onchange="handleCustAudioSelect(${idx}, this)">
                    <button class="btn" style="padding:4px 8px; font-size:11px; background:#1e293b; border:1px solid #334155;" onclick="document.getElementById('cust-audio-input-${idx}').click()">
                        <i class="fas fa-file-audio"></i> ${s.audio_file ? 'Změnit' : 'Audio'}
                    </button>
                    ${s.audio_file ? `
                        <span class="audio-badge-ok" title="${s.audio_file}">
                            <i class="fas fa-check-circle"></i> ${s.audio_file.length > 14 ? s.audio_file.substring(0, 12) + '...' : s.audio_file}
                        </span>
                        ${audioSrc ? `<audio controls src="${audioSrc}" style="height:22px; max-width:110px;"></audio>` : ''}
                        <button class="btn btn-danger" style="padding:2px 5px; font-size:9px;" onclick="removeCustAudio(${idx})"><i class="fas fa-times"></i></button>
                    ` : '<span class="audio-badge-missing">Chybí</span>'}
                </div>
            </td>
            <td style="text-align:right;">
                <div style="display:flex; justify-content:flex-end; gap:4px;">
                    <button class="btn" style="padding:3px 6px; font-size:10px;" onclick="moveCustStop(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
                    <button class="btn" style="padding:3px 6px; font-size:10px;" onclick="moveCustStop(${idx}, 1)" ${idx === customStops.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button>
                    <button class="btn btn-danger" style="padding:3px 6px; font-size:10px;" onclick="deleteCustStop(${idx})" ${customStops.length <= 2 ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.handleCustAudioSelect = function(idx, input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        customStops[idx].audio_fileObj = file;
        customStops[idx].audio_file = file.name;
        customStops[idx].audio_path = file.path || '';
        renderCustomStopsTable();
    }
};

window.removeCustAudio = function(idx) {
    customStops[idx].audio_file = "";
    customStops[idx].audio_path = "";
    delete customStops[idx].audio_fileObj;
    renderCustomStopsTable();
};

window.moveCustStop = function(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= customStops.length) return;
    const temp = customStops[idx];
    customStops[idx] = customStops[target];
    customStops[target] = temp;
    renderCustomStopsTable();
};

window.deleteCustStop = function(idx) {
    if (customStops.length <= 2) return alert('Linka musí mít alespoň 2 zastávky.');
    customStops.splice(idx, 1);
    renderCustomStopsTable();
};

// Uložit fiktivní linku lokálně
document.getElementById('btn-save-cust-local').addEventListener('click', async () => {
    const routeNumber = document.getElementById('cust-line-num').value.trim();
    const routeName = document.getElementById('cust-line-name').value.trim();
    const description = document.getElementById('cust-line-desc').value.trim();

    if (!routeNumber || !routeName) return alert('Zadejte prosím označení a název linky.');

    const audioMap = {};
    customStops.forEach((s, idx) => {
        if (s.audio_path) audioMap[idx] = s.audio_path;
    });

    const payload = {
        routeNumber,
        routeName,
        routeType: 'custom',
        description,
        stops: customStops,
        audioFilesMap: audioMap
    };

    try {
        const res = await ipcRenderer.invoke('editor-save-local-route', payload);
        if (res.success) {
            alert(`✅ Linka ${routeNumber} byla úspěšně uložena do vašich linek (userdata)!`);
        } else {
            alert(`Chyba při ukládání: ${res.error}`);
        }
    } catch (e) {
        alert(`Chyba: ${e.message}`);
    }
});

// ── PUBLIKOVÁNÍ DO KOMUNITY & PRÁVNÍ MODAL ───────────────────────────────────

let pendingPublishPayload = null;

document.getElementById('btn-publish-gtfs-community').addEventListener('click', () => {
    if (!currentGtfsLine || currentGtfsStops.length === 0) return alert('Nejprve vyberte a načtěte linku.');
    const routeNumber = currentGtfsLine.route.route_short_name;
    const routeName = currentGtfsLine.route.route_long_name || 'Linka ' + routeNumber;
    
    pendingPublishPayload = {
        routeNumber,
        routeName,
        routeType: 'gtfs',
        description: `GTFS linka ${routeNumber}`,
        stops: currentGtfsStops.map((s, idx) => ({
            ...s,
            audio_fileObj: gtfsAudioFiles[idx]?.file,
            audio_path: gtfsAudioFiles[idx]?.path
        }))
    };
    openLegalModal();
});

document.getElementById('btn-publish-cust-community').addEventListener('click', () => {
    const routeNumber = document.getElementById('cust-line-num').value.trim();
    const routeName = document.getElementById('cust-line-name').value.trim();
    const description = document.getElementById('cust-line-desc').value.trim();
    if (!routeNumber || !routeName) return alert('Zadejte označení a název linky.');

    pendingPublishPayload = {
        routeNumber,
        routeName,
        routeType: 'custom',
        description,
        stops: customStops
    };
    openLegalModal();
});

function openLegalModal() {
    document.getElementById('legal-check-1').checked = false;
    document.getElementById('legal-check-2').checked = false;
    document.getElementById('legal-check-3').checked = false;
    document.getElementById('btn-submit-legal-confirmed').disabled = true;
    document.getElementById('legal-modal').style.display = 'flex';
}

function closeLegalModal() {
    document.getElementById('legal-modal').style.display = 'none';
    pendingPublishPayload = null;
}

['legal-check-1', 'legal-check-2', 'legal-check-3'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
        const c1 = document.getElementById('legal-check-1').checked;
        const c2 = document.getElementById('legal-check-2').checked;
        const c3 = document.getElementById('legal-check-3').checked;
        document.getElementById('btn-submit-legal-confirmed').disabled = !(c1 && c2 && c3);
    });
});

document.getElementById('btn-submit-legal-confirmed').addEventListener('click', async () => {
    if (!pendingPublishPayload) return;
    const btn = document.getElementById('btn-submit-legal-confirmed');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Odesílám na server...';
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('route_number', pendingPublishPayload.routeNumber);
        formData.append('route_name', pendingPublishPayload.routeName);
        formData.append('route_type', pendingPublishPayload.routeType);
        formData.append('description', pendingPublishPayload.description || '');
        formData.append('author_id', currentUser.discord_id || 'anonymous_player');
        formData.append('author_name', currentUser.discord_nick || 'Hráč');
        formData.append('legal_confirmed', 'true');

        const cleanStops = pendingPublishPayload.stops.map(s => ({
            name: s.name,
            time: s.time || '',
            zone: s.zone || 'P',
            na_znameni: !!s.na_znameni
        }));
        formData.append('stops_json', JSON.stringify(cleanStops));

        // Přidání audio souborů
        pendingPublishPayload.stops.forEach((s, idx) => {
            if (s.audio_fileObj) {
                formData.append(`audio_${idx}`, s.audio_fileObj);
            } else if (s.audio_path && fs.existsSync(s.audio_path)) {
                const buf = fs.readFileSync(s.audio_path);
                const blob = new Blob([buf]);
                formData.append(`audio_${idx}`, blob, path.basename(s.audio_path));
            }
        });

        const resp = await fetch(`${BACKEND_URL}/api/community-routes/submit`, {
            method: 'POST',
            body: formData
        });
        const resJson = await resp.json();

        if (resJson.success) {
            closeLegalModal();
            alert('🎉 ' + resJson.message);
            switchTab('my-routes');
        } else {
            alert('Chyba při odesílání: ' + (resJson.error || 'Neznámá chyba'));
        }
    } catch (e) {
        alert('Chyba spojení se serverem: ' + e.message);
    } finally {
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Odeslat ke schválení';
        btn.disabled = false;
    }
});

// ── 3. KOMUNITNÍ KATALOG KE STAŽENÍ ──────────────────────────────────────────

async function loadCommunityCatalog() {
    const grid = document.getElementById('comm-routes-grid');
    grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center; grid-column:1/-1; padding:30px;"><i class="fas fa-spinner fa-spin"></i> Načítám schválené linky...</div>';

    try {
        const resp = await fetch(`${BACKEND_URL}/api/community-routes`);
        const data = await resp.json();

        if (!data.success || !data.routes || data.routes.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center; grid-column:1/-1; padding:30px;">Zatím nejsou k dispozici žádné schválené komunitní linky. Buďte první a vytvořte svou!</div>';
            return;
        }

        grid.innerHTML = '';
        data.routes.forEach(r => {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.margin = '0';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                    <span style="background:var(--primary); color:#000; font-weight:bold; font-size:13px; padding:2px 8px; border-radius:6px;">${r.route_number}</span>
                    <span style="font-size:11px; color:var(--text-muted);">${r.created_at ? r.created_at.substring(0, 10) : ''}</span>
                </div>
                <h4 style="color:#fff; font-size:15px; margin-bottom:4px;">${r.route_name}</h4>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
                    Autor: <b style="color:#e2e8f0;">${r.author_name || 'Hráč'}</b> • Zastávek: ${r.stops?.length || 0}
                </div>
                ${r.description ? `<p style="font-size:11px; color:#94a3b8; font-style:italic; margin-bottom:12px;">"${r.description}"</p>` : ''}
                <div style="display:flex; justify-content:flex-end;">
                    <button class="btn btn-success" style="padding:6px 12px; font-size:12px;" onclick="installCommunityRoute('${r.audio_package_url}', '${r.route_number}')">
                        <i class="fas fa-download"></i> Nainstalovat do hry
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        grid.innerHTML = `<div style="color:#ef4444; font-size:13px; text-align:center; grid-column:1/-1; padding:30px;">Chyba při stahování nabídky: ${e.message}</div>`;
    }
}

window.installCommunityRoute = async function(pkgUrl, routeNum) {
    if (!pkgUrl) return alert('Balíček linky není dostupný.');
    try {
        const fullUrl = pkgUrl.startsWith('http') ? pkgUrl : `${BACKEND_URL}${pkgUrl}`;
        const res = await ipcRenderer.invoke('community-install-package', { packageUrl: fullUrl, routeNumber: routeNum });
        if (res.success) {
            alert(`🎉 Linka ${routeNum} a veškerá její hlášení byla úspěšně stažena do vašich linek (userdata)!\nMůžete ji ihned spustit.`);
        } else {
            alert(`Chyba při instalaci linky: ${res.error}`);
        }
    } catch (e) {
        alert(`Chyba: ${e.message}`);
    }
};

// ── 4. MOJE PUBLIKOVANÉ LINKY ────────────────────────────────────────────────

async function loadMyRoutes() {
    const listEl = document.getElementById('my-routes-list');
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Načítám vaše linky...</div>';

    if (!currentUser.discord_id) {
        listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#f59e0b; font-size:13px;">Nejste přihlášeni přes Discord. Přihlaste se v Launcheru.</div>';
        return;
    }

    try {
        const resp = await fetch(`${BACKEND_URL}/api/community-routes/my?discord_id=${currentUser.discord_id}`);
        const data = await resp.json();

        if (!data.success || !data.routes || data.routes.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">Zatím jste nepublikovali žádné komunitní linky.</div>';
            return;
        }

        listEl.innerHTML = '';
        data.routes.forEach(r => {
            const row = document.createElement('div');
            row.style.background = '#0f172a';
            row.style.border = '1px solid var(--border-color)';
            row.style.borderRadius = '8px';
            row.style.padding = '14px';
            row.style.marginBottom = '10px';
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.flexWrap = 'wrap';
            row.style.gap = '10px';

            let statusBadge = '';
            if (r.status === 'approved') statusBadge = '<span style="background:rgba(16,185,129,0.2); color:#10b981; border:1px solid #10b981; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;"><i class="fas fa-check-circle"></i> Schváleno</span>';
            else if (r.status === 'rejected') statusBadge = `<span style="background:rgba(239,68,68,0.2); color:#ef4444; border:1px solid #ef4444; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;"><i class="fas fa-times-circle"></i> Zamítnuto: ${r.reject_reason || ''}</span>`;
            else if (r.status === 'deleted_by_user') statusBadge = '<span style="background:rgba(148,163,184,0.2); color:#94a3b8; border:1px solid #94a3b8; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;"><i class="fas fa-trash-alt"></i> Staženo z nabídky</span>';
            else statusBadge = '<span style="background:rgba(245,158,11,0.2); color:#f59e0b; border:1px solid #f59e0b; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;"><i class="fas fa-clock"></i> Čeká na schválení</span>';

            row.innerHTML = `
                <div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="background:var(--primary); color:#000; font-weight:bold; font-size:12px; padding:2px 7px; border-radius:4px;">${r.route_number}</span>
                        <b style="color:#fff;">${r.route_name}</b>
                        ${statusBadge}
                    </div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
                        Odesláno: ${r.created_at || ''}
                    </div>
                </div>
                <div>
                    ${!r.is_deleted_by_author ? `
                        <button class="btn btn-danger" style="padding:5px 10px; font-size:11px;" onclick="deleteMyCommunityRoute(${r.id})">
                            <i class="fas fa-trash"></i> Stáhnout z komunity
                        </button>
                    ` : '<span style="font-size:11px; color:#64748b; font-style:italic;">Zvuky archivovány</span>'}
                </div>
            `;
            listEl.appendChild(row);
        });
    } catch (e) {
        listEl.innerHTML = `<div style="color:#ef4444; font-size:13px; text-align:center; padding:20px;">Chyba: ${e.message}</div>`;
    }
}

window.deleteMyCommunityRoute = async function(routeId) {
    if (!confirm('Opravdu chcete tuto linku stáhnout z veřejné komunitní nabídky?')) return;
    try {
        const resp = await fetch(`${BACKEND_URL}/api/community-routes/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_id: routeId, discord_id: currentUser.discord_id })
        });
        const resJson = await resp.json();
        if (resJson.success) {
            alert('Linka byla stažena z veřejné nabídky.');
            loadMyRoutes();
        } else {
            alert('Chyba: ' + (resJson.error || 'Neznámá chyba'));
        }
    } catch (e) {
        alert('Chyba: ' + e.message);
    }
};

// ── 5. CELOSTÁTNÍ GTFS DATA ČR ───────────────────────────────────────────────

async function refreshCrGtfsStatus() {
    try {
        const status = await ipcRenderer.invoke('cr-gtfs-get-status');
        const titleEl = document.getElementById('cr-status-title');
        const detailEl = document.getElementById('cr-status-details');
        const btnLabel = document.getElementById('cr-btn-label');

        if (status.installed) {
            titleEl.innerHTML = '<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Celostátní data ČR jsou nainstalována</span>';
            detailEl.innerText = `Velikost: ${status.sizeFormatted} • Poslední aktualizace: ${status.updatedAt}`;
            btnLabel.innerText = 'Aktualizovat data celé ČR';
        } else {
            titleEl.innerHTML = '<span style="color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i> Data celé ČR nejsou stažena (volitelné)</span>';
            detailEl.innerText = 'Máte k dispozici pouze povinná data IDPK (Plzeňský kraj). Pro linky z ostatních krajů ČR stáhněte celostátní databázi.';
            btnLabel.innerText = 'Stáhnout data celé ČR (cca 650 MB)';
        }
    } catch (e) {
        console.error(e);
    }
}

document.getElementById('btn-download-cr-gtfs').addEventListener('click', async () => {
    const progressContainer = document.getElementById('cr-download-progress-container');
    const progressBar = document.getElementById('cr-download-progress-bar');
    const progressPercent = document.getElementById('cr-progress-percent');
    const btn = document.getElementById('btn-download-cr-gtfs');

    btn.disabled = true;
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.innerText = 'Zahajuji stahování z CDN...';

    ipcRenderer.on('cr-gtfs-progress', (event, data) => {
        progressBar.style.width = data.percent + '%';
        progressPercent.innerText = data.percent + '%';
        document.getElementById('cr-progress-bytes').innerText = `${(data.downloadedBytes / (1024*1024)).toFixed(1)} MB z ${(data.totalBytes / (1024*1024)).toFixed(1)} MB`;
    });

    try {
        const res = await ipcRenderer.invoke('cr-gtfs-download');
        if (res.success) {
            alert('✅ Celostátní data České republiky byla úspěšně stažena!\nNyní můžete vyhledávat a tvořit jakoukoliv linku v ČR.');
            refreshCrGtfsStatus();
        } else {
            alert('Chyba při stahování: ' + res.error);
        }
    } catch (e) {
        alert('Chyba: ' + e.message);
    } finally {
        btn.disabled = false;
        progressContainer.style.display = 'none';
        ipcRenderer.removeAllListeners('cr-gtfs-progress');
    }
});

// Startovací inicializace
loadUserData();
renderCustomStopsTable();
refreshCrGtfsStatus();
