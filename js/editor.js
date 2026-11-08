// js/editor.js
// Logika Editoru vlastních a komunitních linek OIS IDPK

const { ipcRenderer, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const BACKEND_URL = 'https://datacorebot.koyeb.app';

// Cesta k uživatelským datům
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
        userEl.innerHTML = `<i class="fab fa-discord"></i> ${currentUser.discord_nick} ${currentUser.discord_id ? '(' + currentUser.discord_id + ')' : '(Nepřihlášen)'}`;
    }
}

// ── NOTIFIKACE ───────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = 'info-circle';
    let borderColor = 'var(--primary)';

    if (type === 'success') {
        icon = 'check-circle';
        borderColor = 'var(--success)';
    } else if (type === 'error') {
        icon = 'exclamation-circle';
        borderColor = 'var(--danger)';
    } else if (type === 'warning') {
        icon = 'exclamation-triangle';
        borderColor = 'var(--warning)';
    }

    toast.style.borderLeftColor = borderColor;
    toast.innerHTML = `<i class="fas fa-${icon}" style="color:${borderColor};"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = 'all 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── PŘEPÍNÁNÍ ZÁLOŽEK ────────────────────────────────────────────────────────

function switchTab(tabKey) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(b => {
        if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabKey)) {
            b.classList.add('active');
        }
    });

    const pane = document.getElementById(`pane-${tabKey}`);
    if (pane) pane.classList.add('active');

    if (tabKey === 'community-catalog') loadCommunityCatalog();
    if (tabKey === 'cr-data-tab') refreshCrGtfsStatus();
}

// ── 1. IMPORT Z GTFS ─────────────────────────────────────────────────────────

let currentGtfsLine = null;
let currentGtfsStops = [];
let gtfsAudioFiles = {}; // index -> file path or File object

document.getElementById('btn-search-gtfs').addEventListener('click', async () => {
    const q = document.getElementById('gtfs-search-input').value.trim();
    const statusEl = document.getElementById('gtfs-search-status');
    const resultsContainer = document.getElementById('gtfs-results-container');

    if (!q) {
        statusEl.innerHTML = '<span style="color:#ef4444;"><i class="fas fa-exclamation-circle"></i> Zadejte číslo linky</span>';
        return;
    }

    statusEl.innerHTML = '<span style="color:#38bdf8;"><i class="fas fa-spinner fa-spin"></i> Vyhledávám v jízdních řádech...</span>';
    resultsContainer.style.display = 'none';

    try {
        const res = await ipcRenderer.invoke('editor-search-gtfs', q);
        if (!res.found) {
            if (res.crMissing) {
                statusEl.innerHTML = `<span style="color:#f59e0b;"><i class="fas fa-info-circle"></i> ${res.msg} <button class="btn btn-primary" style="padding:3px 10px; font-size:11px; margin-left:8px;" onclick="switchTab('cr-data-tab')">Stáhnout data ČR</button></span>`;
            } else {
                statusEl.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> ${res.msg || 'Linka nebyla nalezena.'}</span>`;
            }
            return;
        }

        statusEl.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Linka nalezena v ${res.source === 'idpk' ? 'IDPK (Plzeňský kraj)' : 'celostátních datech ČR'}!</span>`;
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
            opt.innerText = `Směr: ${v.headsign} (${v.stops_count} zastávek)`;
            selectEl.appendChild(opt);
        });

        selectEl.onchange = () => loadGtfsStopsForTrip(selectEl.value);

        if (variants.length > 0) {
            await loadGtfsStopsForTrip(variants[0].trip_id);
        }

        resultsContainer.style.display = 'block';
    } catch (e) {
        statusEl.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> Chyba při vyhledávání: ${e.message}</span>`;
    }
});

async function loadGtfsStopsForTrip(tripId) {
    if (!currentGtfsLine) return;
    try {
        const stops = await ipcRenderer.invoke('editor-get-variant-stops', {
            tripId: tripId,
            source: currentGtfsLine.source
        });
        currentGtfsStops = stops;
        gtfsAudioFiles = {};
        renderGtfsStopsTable();
    } catch (e) {
        showToast("Chyba při načítání zastávek: " + e.message, "error");
    }
}

function renderGtfsStopsTable() {
    const tbody = document.getElementById('gtfs-stops-tbody');
    tbody.innerHTML = '';

    const countBadge = document.getElementById('gtfs-stops-count-badge');
    if (countBadge) countBadge.innerText = `${currentGtfsStops.length} ZASTÁVEK`;

    currentGtfsStops.forEach((s, idx) => {
        const tr = document.createElement('tr');
        const audioAttached = !!gtfsAudioFiles[idx];

        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td style="font-weight:700; color:#fff;">
                <input type="text" class="form-control" style="padding:6px 10px; font-size:12.5px;" value="${s.name}" data-idx="${idx}" onchange="currentGtfsStops[${idx}].name = this.value">
            </td>
            <td style="width:110px;">
                <input type="text" class="form-control" style="padding:6px 10px; font-size:12.5px; text-align:center;" value="${s.time || ''}" placeholder="00:00" data-idx="${idx}" onchange="currentGtfsStops[${idx}].time = this.value">
            </td>
            <td style="width:110px;">
                <input type="text" class="form-control" style="padding:6px 10px; font-size:12.5px; text-align:center;" value="${s.zone || 'P'}" placeholder="P" data-idx="${idx}" onchange="currentGtfsStops[${idx}].zone = this.value">
            </td>
            <td style="width:90px; text-align:center;">
                <input type="checkbox" ${s.na_znameni ? 'checked' : ''} onchange="currentGtfsStops[${idx}].na_znameni = this.checked">
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <label class="audio-upload-btn ${audioAttached ? 'has-audio' : ''}">
                        <i class="fas ${audioAttached ? 'fa-check' : 'fa-upload'}"></i>
                        <span>${audioAttached ? (gtfsAudioFiles[idx].name || 'Zvuk nahrán') : 'Vybrat audio (.mp3, .wav)'}</span>
                        <input type="file" accept="audio/*" style="display:none;" onchange="handleGtfsAudioUpload(event, ${idx})">
                    </label>
                    <div id="gtfs-preview-wrap-${idx}"></div>
                </div>
            </td>
        `;
        tbody.appendChild(tr);

        if (audioAttached && gtfsAudioFiles[idx].path) {
            const previewWrap = tr.querySelector(`#gtfs-preview-wrap-${idx}`);
            if (previewWrap) {
                previewWrap.innerHTML = `<audio controls src="file://${gtfsAudioFiles[idx].path}"></audio>`;
            }
        }
    });
}

function handleGtfsAudioUpload(event, idx) {
    const file = event.target.files[0];
    if (!file) return;
    gtfsAudioFiles[idx] = {
        name: file.name,
        path: file.path,
        fileObj: file
    };
    currentGtfsStops[idx].audio_file = file.name;
    renderGtfsStopsTable();
}

// Uložení lokálně (GTFS)
document.getElementById('btn-save-gtfs-local').addEventListener('click', async () => {
    if (!currentGtfsLine || currentGtfsStops.length === 0) {
        showToast("Není načtena žádná trasa.", "error");
        return;
    }
    const routeNum = currentGtfsLine.route.route_short_name;
    const routeName = currentGtfsLine.route.route_long_name || `Linka ${routeNum}`;

    triggerSafeSave({
        routeNumber: routeNum,
        routeName: routeName,
        routeType: 'gtfs',
        systemTag: currentGtfsLine.source === 'idpk' ? 'IDPK' : 'CR',
        stops: currentGtfsStops,
        audioFilesMap: Object.fromEntries(Object.entries(gtfsAudioFiles).map(([k, v]) => [k, v.path]))
    });
});

// ── 2. TVORBA FIKTIVNÍ LINKY OD NULY ─────────────────────────────────────────

let customStops = [
    { name: "Výchozí zastávka", time: "00:00", zone: "P", na_znameni: false, audio_file: "" },
    { name: "Cílová zastávka", time: "00:15", zone: "P", na_znameni: false, audio_file: "" }
];
let customAudioFiles = {}; // index -> file path or File object

function renderCustomStopsTable() {
    const tbody = document.getElementById('custom-stops-tbody');
    tbody.innerHTML = '';

    customStops.forEach((s, idx) => {
        const tr = document.createElement('tr');
        const audioAttached = !!customAudioFiles[idx];

        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>
                <input type="text" class="form-control" style="padding:6px 10px; font-size:12.5px;" value="${s.name}" onchange="customStops[${idx}].name = this.value">
            </td>
            <td style="width:110px;">
                <input type="text" class="form-control" style="padding:6px 10px; font-size:12.5px; text-align:center;" value="${s.time}" onchange="customStops[${idx}].time = this.value">
            </td>
            <td style="width:110px;">
                <input type="text" class="form-control" style="padding:6px 10px; font-size:12.5px; text-align:center;" value="${s.zone}" onchange="customStops[${idx}].zone = this.value">
            </td>
            <td style="width:90px; text-align:center;">
                <input type="checkbox" ${s.na_znameni ? 'checked' : ''} onchange="customStops[${idx}].na_znameni = this.checked">
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <label class="audio-upload-btn ${audioAttached ? 'has-audio' : ''}">
                        <i class="fas ${audioAttached ? 'fa-check' : 'fa-upload'}"></i>
                        <span>${audioAttached ? (customAudioFiles[idx].name || 'Zvuk nahrán') : 'Vybrat audio'}</span>
                        <input type="file" accept="audio/*" style="display:none;" onchange="handleCustomAudioUpload(event, ${idx})">
                    </label>
                    <div id="custom-preview-wrap-${idx}"></div>
                </div>
            </td>
            <td style="text-align:right; width:90px;">
                <button type="button" class="btn btn-danger" style="padding:4px 8px; font-size:11px;" onclick="removeCustomStop(${idx})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);

        if (audioAttached && customAudioFiles[idx].path) {
            const previewWrap = tr.querySelector(`#custom-preview-wrap-${idx}`);
            if (previewWrap) {
                previewWrap.innerHTML = `<audio controls src="file://${customAudioFiles[idx].path}"></audio>`;
            }
        }
    });
}

function handleCustomAudioUpload(event, idx) {
    const file = event.target.files[0];
    if (!file) return;
    customAudioFiles[idx] = {
        name: file.name,
        path: file.path,
        fileObj: file
    };
    customStops[idx].audio_file = file.name;
    renderCustomStopsTable();
}

function removeCustomStop(idx) {
    if (customStops.length <= 2) {
        showToast("Linka musí mít alespoň 2 zastávky.", "warning");
        return;
    }
    customStops.splice(idx, 1);
    delete customAudioFiles[idx];
    renderCustomStopsTable();
}

document.getElementById('btn-add-custom-stop').addEventListener('click', () => {
    customStops.push({
        name: `Nová zastávka ${customStops.length + 1}`,
        time: "00:00",
        zone: "P",
        na_znameni: false,
        audio_file: ""
    });
    renderCustomStopsTable();
});

// Uložení lokálně (Fiktivní linka)
document.getElementById('btn-save-custom-local').addEventListener('click', async () => {
    const routeNum = document.getElementById('custom-route-num').value.trim();
    const routeName = document.getElementById('custom-route-name').value.trim();
    const systemTag = document.getElementById('custom-system-tag').value;
    const desc = document.getElementById('custom-route-desc').value.trim();

    if (!routeNum || !routeName) {
        showToast("Zadejte prosím číslo linky a název trasy.", "error");
        return;
    }

    triggerSafeSave({
        routeNumber: routeNum,
        routeName: routeName,
        routeType: 'custom',
        systemTag: systemTag,
        description: desc,
        stops: customStops,
        audioFilesMap: Object.fromEntries(Object.entries(customAudioFiles).map(([k, v]) => [k, v.path]))
    });
});

// ── SPOLEČNÁ LOGIKA KONTROLY DUPLIKACE A BEZPEČNÉHO ULOŽENÍ ─────────────────

let pendingSavePayload = null;

async function triggerSafeSave(payload) {
    pendingSavePayload = payload;

    try {
        // Kontrola, zda linka již existuje v základních datech
        const check = await ipcRenderer.invoke('editor-check-route-exists', payload.routeNumber);
        if (check.exists) {
            document.getElementById('dup-route-num-display').innerText = payload.routeNumber;
            document.getElementById('dup-modal-subtitle').innerText = `Detekována v: ${check.source}`;
            document.getElementById('duplicate-modal').style.display = 'flex';
            return;
        }

        // Pokud neexistuje, uložíme přímo
        await executeLocalSave(false);
    } catch (e) {
        showToast("Chyba při kontrole linky: " + e.message, "error");
    }
}

document.getElementById('btn-cancel-duplicate').addEventListener('click', () => {
    document.getElementById('duplicate-modal').style.display = 'none';
    pendingSavePayload = null;
});

document.getElementById('btn-confirm-duplicate').addEventListener('click', async () => {
    document.getElementById('duplicate-modal').style.display = 'none';
    if (!pendingSavePayload) return;
    await executeLocalSave(true);
});

async function executeLocalSave(isDuplicateCustom) {
    if (!pendingSavePayload) return;
    pendingSavePayload.isDuplicateCustom = isDuplicateCustom;

    try {
        const res = await ipcRenderer.invoke('editor-save-local-route', pendingSavePayload);
        if (res.success) {
            if (isDuplicateCustom) {
                showToast(`✅ Vytvořena komunitní úprava linky ${pendingSavePayload.routeNumber}! Původní linka zůstala zachována.`, "success");
            } else {
                showToast(`✅ Linka ${pendingSavePayload.routeNumber} byla úspěšně uložena do vašich dat!`, "success");
            }
        } else {
            showToast("Chyba při ukládání: " + res.error, "error");
        }
    } catch (e) {
        showToast("Chyba: " + e.message, "error");
    } finally {
        pendingSavePayload = null;
    }
}

// ── PUBLIKACE LINKY DO KOMUNITY ──────────────────────────────────────────────

let pendingPublishPayload = null;

document.getElementById('btn-open-publish-gtfs').addEventListener('click', () => {
    if (!currentGtfsLine || currentGtfsStops.length === 0) {
        showToast("Není načtena žádná trasa.", "error");
        return;
    }
    openPublishModal({
        routeNumber: currentGtfsLine.route.route_short_name,
        routeName: currentGtfsLine.route.route_long_name || `Linka ${currentGtfsLine.route.route_short_name}`,
        routeType: 'gtfs',
        systemTag: currentGtfsLine.source === 'idpk' ? 'IDPK' : 'PID',
        stops: currentGtfsStops,
        audioMap: gtfsAudioFiles
    });
});

document.getElementById('btn-open-publish-custom').addEventListener('click', () => {
    const routeNum = document.getElementById('custom-route-num').value.trim();
    const routeName = document.getElementById('custom-route-name').value.trim();
    const systemTag = document.getElementById('custom-system-tag').value;
    const desc = document.getElementById('custom-route-desc').value.trim();

    if (!routeNum || !routeName) {
        showToast("Nejprve vyplňte číslo a název fiktivní linky.", "error");
        return;
    }

    openPublishModal({
        routeNumber: routeNum,
        routeName: routeName,
        routeType: 'custom',
        systemTag: systemTag,
        description: desc,
        stops: customStops,
        audioMap: customAudioFiles
    });
});

function openPublishModal(payload) {
    if (!currentUser.discord_id) {
        showToast("Pro publikování se musíte v Launcheru přihlásit přes Discord.", "warning");
        return;
    }

    pendingPublishPayload = payload;
    document.getElementById('publish-preview-name').innerText = `Linka ${payload.routeNumber} • ${payload.routeName}`;
    
    const audioCount = Object.keys(payload.audioMap || {}).length;
    document.getElementById('publish-preview-meta').innerText = `${payload.stops.length} zastávek • ${audioCount} zvukových nahrávek`;
    
    const tagSelect = document.getElementById('publish-system-tag');
    if (tagSelect && payload.systemTag) tagSelect.value = payload.systemTag;

    const descInput = document.getElementById('publish-description');
    if (descInput && payload.description) descInput.value = payload.description;

    document.getElementById('publish-legal-check').checked = false;
    document.getElementById('publish-modal').style.display = 'flex';
}

document.getElementById('btn-cancel-publish').addEventListener('click', () => {
    document.getElementById('publish-modal').style.display = 'none';
    pendingPublishPayload = null;
});

document.getElementById('btn-submit-publish').addEventListener('click', async () => {
    if (!pendingPublishPayload) return;

    const legalChecked = document.getElementById('publish-legal-check').checked;
    if (!legalChecked) {
        showToast("Musíte potvrdit závazné právní prohlášení.", "warning");
        return;
    }

    const tag = document.getElementById('publish-system-tag').value;
    const desc = document.getElementById('publish-description').value.trim();
    const submitBtn = document.getElementById('btn-submit-publish');

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Odesílám balíček na server...';

    try {
        const formData = new FormData();
        formData.append('route_number', pendingPublishPayload.routeNumber);
        formData.append('route_name', pendingPublishPayload.routeName);
        formData.append('route_type', pendingPublishPayload.routeType);
        formData.append('system_tag', tag);
        formData.append('description', desc);
        formData.append('author_id', currentUser.discord_id);
        formData.append('author_name', currentUser.discord_nick);
        formData.append('legal_confirmed', 'true');
        formData.append('stops_json', JSON.stringify(pendingPublishPayload.stops));

        // Zvukové soubory
        const audioMap = pendingPublishPayload.audioMap || {};
        for (const [idxStr, audioItem] of Object.entries(audioMap)) {
            if (audioItem && audioItem.path && fs.existsSync(audioItem.path)) {
                const buffer = fs.readFileSync(audioItem.path);
                const blob = new Blob([buffer]);
                formData.append(`audio_${idxStr}`, blob, audioItem.name);
            }
        }

        const resp = await fetch(`${BACKEND_URL}/api/community-routes/submit`, {
            method: 'POST',
            body: formData
        });

        const data = await resp.json();
        if (data.success) {
            document.getElementById('publish-modal').style.display = 'none';
            showToast("🎉 Linka byla úspěšně odeslána ke schválení! Po kontrole vám přijde DM zpráva.", "success");
            switchTab('community-catalog');
        } else {
            showToast("Chyba při odesílání: " + (data.error || 'Neznámá chyba'), "error");
        }
    } catch (e) {
        showToast("Chyba komunikace se serverem: " + e.message, "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Odeslat ke schválení';
        pendingPublishPayload = null;
    }
});

// ── 3. KOMUNITNÍ KATALOG LINEK ───────────────────────────────────────────────

let loadedCommunityRoutes = [];
let activeTagFilter = 'ALL';

async function loadCommunityCatalog() {
    const loadingEl = document.getElementById('catalog-loading');
    const gridEl = document.getElementById('catalog-routes-grid');
    const emptyEl = document.getElementById('catalog-empty');

    if (loadingEl) loadingEl.style.display = 'block';
    if (gridEl) gridEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
        const resp = await fetch(`${BACKEND_URL}/api/community-routes`);
        const data = await resp.json();

        if (data.success && Array.isArray(data.routes)) {
            loadedCommunityRoutes = data.routes;
            renderCommunityRoutes();
        } else {
            showToast("Chyba při načítání katalogu: " + (data.error || 'Neznámá chyba'), "error");
            if (emptyEl) emptyEl.style.display = 'block';
        }
    } catch (e) {
        showToast("Nelze se spojit se serverem komunity: " + e.message, "error");
        if (emptyEl) emptyEl.style.display = 'block';
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

function renderCommunityRoutes() {
    const gridEl = document.getElementById('catalog-routes-grid');
    const emptyEl = document.getElementById('catalog-empty');
    const searchVal = document.getElementById('catalog-search-input').value.trim().toLowerCase();

    gridEl.innerHTML = '';

    let filtered = loadedCommunityRoutes.filter(r => {
        // Filtr podle tagu
        if (activeTagFilter === 'MY') {
            if (String(r.author_id) !== String(currentUser.discord_id)) return false;
        } else if (activeTagFilter !== 'ALL') {
            const rTag = (r.system_tag || 'IDPK').toUpperCase();
            if (rTag !== activeTagFilter.toUpperCase()) return false;
        }

        // Filtr podle vyhledávání
        if (searchVal) {
            const matchNum = String(r.route_number || '').toLowerCase().includes(searchVal);
            const matchName = String(r.route_name || '').toLowerCase().includes(searchVal);
            const matchAuthor = String(r.author_name || '').toLowerCase().includes(searchVal);
            const matchDesc = String(r.description || '').toLowerCase().includes(searchVal);
            if (!matchNum && !matchName && !matchAuthor && !matchDesc) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
        gridEl.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
    }

    gridEl.style.display = 'grid';
    emptyEl.style.display = 'none';

    filtered.forEach(r => {
        const card = document.createElement('div');
        card.className = 'route-card';

        const rawTag = (r.system_tag || 'IDPK').toLowerCase();
        let tagClass = 'tag-custom';
        if (rawTag.includes('idpk')) tagClass = 'tag-idpk';
        else if (rawTag.includes('pid')) tagClass = 'tag-pid';
        else if (rawTag.includes('dúk') || rawTag.includes('duk')) tagClass = 'tag-duk';
        else if (rawTag.includes('iredo')) tagClass = 'tag-iredo';
        else if (rawTag.includes('odis')) tagClass = 'tag-odis';
        else if (rawTag.includes('jmk')) tagClass = 'tag-idsjmk';

        const stops = r.stops || [];
        const isAuthor = currentUser.discord_id && String(r.author_id) === String(currentUser.discord_id);
        const cardId = `route-card-${r.id}`;

        card.innerHTML = `
            <div>
                <div class="rc-top">
                    <div class="rc-badge-group">
                        <span class="rc-num-badge">${r.route_number}</span>
                        <span class="rc-tag-badge ${tagClass}">${r.system_tag || 'IDPK'}</span>
                    </div>
                    <span style="font-size:11px; color:#64748b;"><i class="fas fa-calendar-alt"></i> ${formatDate(r.created_at)}</span>
                </div>

                <div class="rc-name">${r.route_name}</div>
                <div class="rc-desc">${r.description || 'Komunitní linka se zvukovým hlášením.'}</div>

                <div class="rc-meta">
                    <span><i class="fab fa-discord" style="color:#5865F2;"></i> ${r.author_name || 'Hráč'}</span>
                    <span><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${stops.length} zastávek</span>
                </div>
            </div>

            <div>
                <div class="rc-actions">
                    <button class="btn btn-secondary" style="flex:1; font-size:11.5px; padding:8px 10px;" onclick="toggleStopsDrawer('${cardId}')">
                        <i class="fas fa-headphones"></i> Poslech hlášení
                    </button>
                    <button class="btn btn-primary" style="flex:1; font-size:11.5px; padding:8px 10px;" onclick="installCommunityRoute('${r.audio_package_url}', '${r.route_number}')">
                        <i class="fas fa-download"></i> Nainstalovat
                    </button>
                    ${isAuthor ? `
                        <button class="btn btn-danger" style="padding:8px 12px; font-size:11.5px;" title="Stáhnout linku z veřejné nabídky" onclick="deleteMyCommunityRoute(${r.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>

                <!-- Rozbalovací seznam zastávek a poslech -->
                <div class="stops-drawer" id="drawer-${cardId}">
                    <div style="font-size:11px; font-weight:bold; color:var(--primary); margin-bottom:6px; text-transform:uppercase;">
                        Zastávky a nahrané audio:
                    </div>
                    ${stops.map((s, idx) => `
                        <div class="drawer-stop-item">
                            <div>
                                <b style="color:#f8fafc;">${idx + 1}. ${s.name}</b>
                                ${s.na_znameni ? '<span style="font-size:10px; color:#f59e0b; margin-left:4px;">(x)</span>' : ''}
                            </div>
                            <div>
                                ${s.audio_url ? `
                                    <audio controls preload="none" src="${s.audio_url}"></audio>
                                ` : '<span style="color:#64748b; font-size:11px;">Bez audia</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        gridEl.appendChild(card);
    });
}

function toggleStopsDrawer(cardId) {
    const drawer = document.getElementById(`drawer-${cardId}`);
    if (drawer) {
        drawer.classList.toggle('open');
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('cs-CZ');
    } catch (_) {
        return dateStr;
    }
}

// Filtrování tagy v katalogu
document.querySelectorAll('.tag-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeTagFilter = pill.getAttribute('data-tag');
        renderCommunityRoutes();
    });
});

document.getElementById('catalog-search-input').addEventListener('input', () => {
    renderCommunityRoutes();
});

document.getElementById('btn-refresh-catalog').addEventListener('click', () => {
    loadCommunityCatalog();
});

// Instalace balíčku do hry
async function installCommunityRoute(packageUrl, routeNumber) {
    if (!packageUrl) {
        showToast("Tato linka nemá dostupný balíček ke stažení.", "error");
        return;
    }

    showToast(`⏳ Stahuji a instaluji linku ${routeNumber}...`, "info");
    try {
        const res = await ipcRenderer.invoke('community-install-package', {
            packageUrl: packageUrl,
            routeNumber: routeNumber
        });

        if (res.success) {
            showToast(`🎉 Linka ${routeNumber} byla úspěšně nainstalována! Najdete ji v OIS ovladači pod [VLASTNÍ].`, "success");
        } else {
            showToast("Chyba při instalaci: " + res.error, "error");
        }
    } catch (e) {
        showToast("Chyba: " + e.message, "error");
    }
}

// Stažení linky autorem
async function deleteMyCommunityRoute(routeId) {
    if (!confirm("Opravdu chcete stáhnout svou linku z veřejné nabídky? V databázi zůstane archivována, ale ostatní hráči ji již neuvidí.")) {
        return;
    }

    try {
        const resp = await fetch(`${BACKEND_URL}/api/community-routes/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                route_id: routeId,
                discord_id: currentUser.discord_id
            })
        });

        const data = await resp.json();
        if (data.success) {
            showToast("Linka byla stažena z veřejné nabídky.", "success");
            loadCommunityCatalog();
        } else {
            showToast("Chyba: " + data.error, "error");
        }
    } catch (e) {
        showToast("Chyba serveru: " + e.message, "error");
    }
}

// ── 4. CELOSTÁTNÍ GTFS ČR ────────────────────────────────────────────────────

async function refreshCrGtfsStatus() {
    try {
        const status = await ipcRenderer.invoke('cr-gtfs-get-status');
        const badge = document.getElementById('cr-status-badge');
        const title = document.getElementById('cr-status-title');
        const details = document.getElementById('cr-status-details');
        const btnLabel = document.getElementById('btn-cr-label');

        if (status.installed) {
            if (badge) {
                badge.innerText = 'STAV: AKTIVNÍ A NAINSTALOVÁNO';
                badge.style.color = 'var(--success)';
                badge.style.borderColor = 'var(--success)';
                badge.style.background = 'rgba(16, 185, 129, 0.15)';
            }
            if (title) title.innerText = '✅ Celostátní databáze ČR je připravena k použití';
            if (details) details.innerText = `Velikost souboru: ${status.sizeFormatted} • Umístění: uživatelská mezipaměť`;
            if (btnLabel) btnLabel.innerText = 'Aktualizovat data ČR (stáhnout znovu)';
        } else {
            if (badge) {
                badge.innerText = 'STAV: NENÍ STAŽENO (VOLITELNÉ)';
                badge.style.color = 'var(--warning)';
                badge.style.borderColor = 'var(--warning)';
                badge.style.background = 'rgba(245, 158, 11, 0.15)';
            }
            if (title) title.innerText = 'ℹ️ Celostátní data ČR nejsou stažena';
            if (details) details.innerText = 'Stažení je volitelné. Po stažení budete moci vyhledávat trasy linek z celé ČR.';
            if (btnLabel) btnLabel.innerText = 'Stáhnout celostátní data ČR (cca 30 MB)';
        }
    } catch (_) {}
}

document.getElementById('btn-download-cr-gtfs').addEventListener('click', async () => {
    const btn = document.getElementById('btn-download-cr-gtfs');
    const progressWrap = document.getElementById('cr-progress-container');
    const progressBar = document.getElementById('cr-progress-bar');
    const percentEl = document.getElementById('cr-progress-percent');
    const bytesEl = document.getElementById('cr-progress-bytes');

    btn.disabled = true;
    if (progressWrap) progressWrap.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (percentEl) percentEl.innerText = '0%';
    if (bytesEl) bytesEl.innerText = 'Zahajuji stahování z rychlé Azure CDN...';

    ipcRenderer.on('cr-gtfs-progress', (event, data) => {
        if (progressBar) progressBar.style.width = data.percent + '%';
        if (percentEl) percentEl.innerText = data.percent + '%';
        if (bytesEl) {
            const dlMb = (data.downloadedBytes / (1024 * 1024)).toFixed(1);
            const totMb = (data.totalBytes / (1024 * 1024)).toFixed(1);
            bytesEl.innerText = `${dlMb} MB z ${totMb} MB`;
        }
    });

    try {
        const res = await ipcRenderer.invoke('cr-gtfs-download');
        if (res.success) {
            showToast("🎉 Celostátní GTFS data ČR byla úspěšně stažena!", "success");
            refreshCrGtfsStatus();
        } else {
            showToast("Chyba při stahování dat ČR: " + res.error, "error");
        }
    } catch (e) {
        showToast("Chyba: " + e.message, "error");
    } finally {
        btn.disabled = false;
        if (progressWrap) progressWrap.style.display = 'none';
        ipcRenderer.removeAllListeners('cr-gtfs-progress');
    }
});

// Inicializace
loadUserData();
renderCustomStopsTable();
refreshCrGtfsStatus();
