const { ipcRenderer } = require('electron');
const path = require('path');
const process = require('process');

function getBasePath() {
    try {
        let devBase = __dirname;
        if (devBase.endsWith('js') || devBase.endsWith('js\\') || devBase.endsWith('js/')) {
            devBase = path.join(__dirname, '..');
        }
        if (require('fs').existsSync(path.join(devBase, 'obraz'))) {
            return devBase;
        }
    } catch(e) {}
    return path.join(__dirname, '..');
}

let isIdle = true; 
let bootFinished = false;
let currentBgLayer = 1;
let currentBgPath = "";

document.addEventListener('keydown', (e) => {
    if (e.key === ' ') e.preventDefault(); 
    ipcRenderer.send('forward-key-to-controller', { key: e.key, code: e.code });
});

const bootSequence = [ 
    { text: "IDPK OIS BOOTLOADER v2.5", delay: 100 }, 
    { text: "Memory Test: 4096K OK", delay: 50 }, 
    { text: "System Ready.", delay: 800 } 
];

async function runBootSequence() {
    const container = document.getElementById('boot-content');
    if (!container) return;
    
    container.innerHTML = "";
    for (let i = 0; i < bootSequence.length; i++) {
        const div = document.createElement('div'); 
        div.className = 'boot-line'; 
        div.textContent = bootSequence[i].text;
        container.appendChild(div); 
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, bootSequence[i].delay));
    }
    bootFinished = true;
    document.getElementById('boot-screen').style.display = 'none';
    
    if (isIdle) {
        document.getElementById('main-content').style.display = 'none';
        changeBackground('obraz/podklady/podklad-v.png');
    } else {
        document.getElementById('main-content').style.display = 'block';
    }
}
runBootSequence();

ipcRenderer.on('update-time-delay', (event, data) => {
    if (data.timeOnly) { 
        document.getElementById('clock').innerText = data.timeStr; 
    }
});

ipcRenderer.on('show-boot-screen', () => {
    document.getElementById('boot-screen').style.display = 'block';
    document.getElementById('main-content').style.display = 'none';
    bootFinished = false;
    runBootSequence();
});

ipcRenderer.on('reset-panel-ui', () => {
    isIdle = true;
    if (bootFinished) {
        document.getElementById('boot-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block'; 
        document.getElementById('arrow-icon').style.display = 'none'; 
        document.getElementById('clock').style.display = 'none'; 
        document.getElementById('line-num').textContent = "";
        document.getElementById('destination').textContent = "";
        document.getElementById('list-view').style.display = 'none';
        document.getElementById('single-stop-view').style.display = 'none';
        changeBackground('obraz/podklady/podklad-v.png');
    }
});

ipcRenderer.on('update-panel-data', (event, data) => {
    isIdle = false;
    if (bootFinished) {
        document.getElementById('boot-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        document.getElementById('arrow-icon').style.display = 'block';
        document.getElementById('clock').style.display = 'block'; 
    }
    updateUI(data);
});

// POKROČILÁ LOGIKA PRO ZMĚNU POZADÍ (TVRDÝ STŘIH BEZ PROBLIKÁVÁNÍ)
function changeBackground(relativePath) {
    if (!relativePath) return;
    
    if (relativePath.includes('undefined')) {
        relativePath = 'obraz/podklady/podklad-n-n-n.png';
    }
    
    const absolutePath = "file:///" + path.join(getBasePath(), relativePath).replace(/\\/g, '/');
    
    if (currentBgPath === absolutePath) return; 
    currentBgPath = absolutePath;

    let layerToHide = document.getElementById(`bg-layer-${currentBgLayer}`);
    currentBgLayer = currentBgLayer === 1 ? 2 : 1;
    let layerToShow = document.getElementById(`bg-layer-${currentBgLayer}`);

    const tempImg = new Image();
    tempImg.onload = () => {
        layerToShow.src = absolutePath;
        layerToShow.classList.remove('bg-hidden');
        layerToShow.classList.add('bg-visible');
        
        layerToHide.classList.remove('bg-visible');
        layerToHide.classList.add('bg-hidden');
    };
    tempImg.onerror = () => {
        console.error("Podklad nenalezen: " + absolutePath);
        if (!absolutePath.includes('podklad-n-n-n.png') && !absolutePath.includes('podklad-v.png')) {
            changeBackground('obraz/podklady/podklad-n-n-n.png');
        }
    };
    tempImg.src = absolutePath;
}

function updateUI(data) {
    if (data.line) {
        let displayLine = data.line;
        if (displayLine.length > 3 && !isNaN(parseInt(displayLine))) displayLine = displayLine.slice(-3);
        document.getElementById('line-num').textContent = displayLine;
    }
    if (data.destination) {
        const formatDestination = (text) => {
            return text.toLowerCase().split(/([\s-]+)/).map(part => {
                if (part.match(/^[\s-]+$/)) return part;
                return part.charAt(0).toUpperCase() + part.slice(1);
            }).join('');
        };
        const destEl = document.getElementById('destination');
        destEl.textContent = formatDestination(data.destination);
        fitDestinationText(destEl);
    }

    const listView = document.getElementById('list-view');
    const singleView = document.getElementById('single-stop-view');

    if (data.showBigStop === true) {
        listView.style.display = 'none';
        singleView.style.display = 'block';
        
        const currentStop = data.stop1;
        if (currentStop) {
            if (!data.stop2) { 
                changeBackground('obraz/podklady/podklad-konec.png'); 
            } 
            else { 
                if (data.stopPressed === true) { 
                    changeBackground(`obraz/podklady/podklad-zast-z-stop.png`); 
                } 
                else { 
                    const suffix = (currentStop.type === 'z') ? 'z' : 'n'; 
                    changeBackground(`obraz/podklady/podklad-zast-${suffix}.png`); 
                }
            }
            let zoneText = formatMultiZone(currentStop.zone);
            if(currentStop.type === 'z' && !zoneText) zoneText = "ZZ";
            document.getElementById('single-zone').innerHTML = zoneText;
            const nameEl = document.getElementById('single-name');
            nameEl.textContent = formatStopName(currentStop.name);
            setTimeout(() => { fitBigText(nameEl); }, 10);
        }
    } else {
        listView.style.display = 'block';
        singleView.style.display = 'none';
        
        updateStopRow(1, data.stop1, data.est1);
        updateStopRow(2, data.stop2, data.est2);
        updateStopRow(3, data.stop3, data.est3);
        
        if (data.stop1 && !data.stop2) { 
            changeBackground('obraz/podklady/podklad-k.png'); 
        } 
        else if (data.stop1 && data.stop2 && !data.stop3) { 
            const type = (data.stop1.type === 'z') ? 'z' : 'n'; 
            changeBackground(`obraz/podklady/podklad-${type}-k.png`); 
        } 
        else if (data.stop1 && data.stop2 && data.stop3) {
            const t1 = (data.stop1 && data.stop1.type === 'z') ? 'z' : 'n';
            const t2 = (data.stop2 && data.stop2.type === 'z') ? 'z' : 'n';
            const t3 = (data.stop3 && data.stop3.type === 'z') ? 'z' : 'n';
            changeBackground(`obraz/podklady/podklad-${t1}-${t2}-${t3}.png`);
        } else { 
            changeBackground('obraz/podklady/podklad-v.png'); 
        }
    }
}

window.textScaleCache = window.textScaleCache || {};

function fitDestinationText(element) { 
    const key = 'dest_' + element.textContent;
    if (window.textScaleCache[key]) {
        element.style.fontSize = window.textScaleCache[key] + "vh";
        return;
    }
    let size = 10; 
    element.style.fontSize = size + "vh"; 
    while (element.scrollWidth > element.clientWidth && size > 4) { 
        size -= 0.2; 
        element.style.fontSize = size + "vh"; 
    } 
    window.textScaleCache[key] = size;
}

function fitBigText(element) { 
    const key = 'big_' + element.textContent;
    if (window.textScaleCache[key]) {
        element.style.fontSize = window.textScaleCache[key] + "vh";
        return;
    }
    let size = 16; 
    element.style.fontSize = size + "vh"; 
    while (element.scrollWidth > element.clientWidth && size > 5) { 
        size -= 0.5; 
        element.style.fontSize = size + "vh"; 
    } 
    window.textScaleCache[key] = size;
}

function fitStopText(element, maxVh) { 
    const key = 'stop_' + element.textContent + '_' + maxVh;
    if (window.textScaleCache[key]) {
        element.style.fontSize = window.textScaleCache[key] + "vh";
        return;
    }
    let size = maxVh; 
    element.style.fontSize = size + "vh"; 
    while (element.scrollWidth > element.clientWidth && size > 3) { 
        size -= 0.2; 
        element.style.fontSize = size + "vh"; 
    } 
    window.textScaleCache[key] = size;
}

function updateStopRow(num, stopData, estTime = null) { 
    const nameEl = document.getElementById(`stop-${num}`); 
    const zoneEl = document.getElementById(`zone-${num}`); 
    const timeContainer = document.getElementById(`time-c-${num}`); 
    
    if (stopData) { 
        nameEl.textContent = formatStopName(stopData.name); 
        let zText = formatMultiZone(stopData.zone); 
        if(stopData.type === 'z' && !zText) zText = "ZZ"; 
        zoneEl.innerHTML = zText; 
        
        let timeHtml = "";
        if (stopData.time) {
            timeHtml += `<div class="time-sched" ${!estTime ? 'style="transform: translateY(25%);"' : ''}>${stopData.time}</div>`;
            if (estTime) {
                timeHtml += `<div class="time-delay">${estTime}</div>`;
            }
        }
        timeContainer.innerHTML = timeHtml;

        let defaultSize = (num === 1) ? 7.5 : 6; 
        fitStopText(nameEl, defaultSize); 
    } else { 
        nameEl.textContent = ""; 
        zoneEl.innerHTML = ""; 
        timeContainer.innerHTML = ""; 
    }
}

function formatMultiZone(zoneStr) {
    if (!zoneStr) return "";
    let parts = zoneStr.split(/<br>|,/g).filter(x => x.trim().length > 0);
    if (parts.length <= 1) return parts[0] || "";
    let html = "";
    for (let i = 0; i < parts.length; i++) {
        let shift = i * 1.0; 
        html += `<div style="transform: translateX(-${shift}vw); line-height: 1.05;">${parts[i].trim()}</div>`;
    }
    return html;
}

function formatStopName(rawName) { 
    if(!rawName) return ""; 
    let clean = rawName.replace(/,,/g, ', ').replace(/,/g, ', ').replace(/\s+/g, ' ').trim(); 
    if(clean.startsWith(', ')) clean = clean.substring(2); 
    return clean; 
}