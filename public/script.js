// --- Map Initialization ---
let map, currentMarker;

// Fix Leaflet marker icon paths (common issue with CDNs and bundlers)
if (typeof L !== 'undefined') {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
}

// Initialize map only if Leaflet is available
try {
    if (typeof L !== 'undefined') {
        map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([20, 0], 2);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            className: 'map-tiles'
        }).addTo(map);

        currentMarker = null;
    }
} catch (e) {
    console.warn('Failed to initialize map:', e);
}

// --- UI Logic ---
const btn = document.getElementById('analyzeBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const input = document.getElementById('targetInput');
const errorMsg = document.getElementById('errorMsg');
const resultsDiv = document.getElementById('results');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

const HISTORY_KEY = 'ip_lookup_history';

btn.addEventListener('click', handleAnalyze);
input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

// Auto-load user's IP on page load
async function loadUserIP() {
    try {
        const response = await fetch('https://api.ip.mordorek.dev/api/myip');
        const data = await response.json();
        if (data.ip && data.ip !== 'Unknown') {
            input.value = data.ip;
            // Automatically trigger analysis
            handleAnalyze();
        }
    } catch (err) {
        console.error('Failed to load user IP:', err);
        // Silently fail - user can still manually enter IP
    }
}

// Load user's IP when page loads
window.addEventListener('DOMContentLoaded', () => {
    loadUserIP();
    renderHistory();
});

async function handleAnalyze() {
    let target = input.value.trim();
    if (!target) return;

    // Parse URL if provided
    try {
        // Check if it looks like a URL or has a dot (domain/IP)
        if (target.includes('://') || target.includes('.')) {
            let urlToParse = target;
            if (!target.includes('://')) {
                urlToParse = 'http://' + target;
            }
            const url = new URL(urlToParse);
            target = url.hostname;
        }
    } catch (e) {
        // If URL parsing fails, keep original target
    }

    // Update input field with extracted domain/IP
    input.value = target;

    // Reset UI
    setLoading(true);
    errorMsg.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    document.getElementById('asnSection').classList.add('hidden');

    try {
        const response = await fetch(`https://api.ip.mordorek.dev/api/analyze?target=${encodeURIComponent(target)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Nie udało się pobrać danych');
        }

        // Check if domain exists (no DNS records and ipapi failed)
        const hasDnsRecords = data.dns ? Object.values(data.dns).some(records => records && records.length > 0) : false;
        const ipapiFailed = !data.ipapi || data.ipapi.error;

        if (ipapiFailed && !hasDnsRecords) {
            throw new Error('Podana domena nie istnieje lub nie posiada rekordów DNS.');
        }

        resultsDiv.classList.remove('hidden');
        renderData(data);

        // Fix for Leaflet map tiles not loading correctly in hidden containers
        if (map) {
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
        }

        saveToHistory(target);

    } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.classList.remove('hidden');
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    btn.disabled = isLoading;
    if (isLoading) {
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
    } else {
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    }
}

function renderData(data) {
    renderNetworkCard(data.ipapi);
    renderInfrastructureCard(data.ipapi);
    renderGeoCard(data.ipapi);
    renderMap(data.ipapi);
    renderAbuseCard(data.ipapi);
    renderDNS(data.dns);

    // Automatically trigger ASN details if available
    if (data.ipapi?.asn?.asn) {
        handleASNClick(data.ipapi.asn.asn, false);
    } else {
        document.getElementById('asnSection').classList.add('hidden');
    }
}

function getHistory() {
    try {
        const history = localStorage.getItem(HISTORY_KEY);
        return history ? JSON.parse(history) : [];
    } catch (e) {
        return [];
    }
}

function saveToHistory(query) {
    if (!query) return;
    let history = getHistory();
    // Remove if already exists to move it to top
    history = history.filter(item => item !== query);
    history.unshift(query);
    // Keep last 20 searches
    history = history.slice(0, 20);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    if (!historyList) return;
    const history = getHistory();

    if (history.length === 0) {
        historyList.innerHTML = '<p class="text-zinc-600 text-xs px-2 italic">Brak historii...</p>';
        return;
    }

    historyList.innerHTML = history.map(item => `
        <button class="history-item w-full text-left px-2 py-1.5 rounded text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-all flex items-center justify-between group" data-query="${item}">
            <span class="truncate">${item}</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
        </button>
    `).join('');

    // Add event listeners to history items
    document.querySelectorAll('.history-item').forEach(btn => {
        btn.addEventListener('click', () => {
            input.value = btn.dataset.query;
            handleAnalyze();
        });
    });
}

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
    });
}

function renderNetworkCard(ipapi) {
    const container = document.getElementById('networkInfoGrid');
    container.innerHTML = '';

    if (!ipapi || ipapi.error) {
        container.innerHTML = `<div class="text-red-400 text-sm italic">Brak danych o sieci.</div>`;
        return;
    }

    const fields = [
        { label: 'Adres IP', value: ipapi.ip, copy: true },
        { label: 'Dostawca (ISP)', value: ipapi.asn?.org || ipapi.company?.name },
        { label: 'ASN', value: ipapi.asn?.asn ? `AS${ipapi.asn.asn}` : 'N/A', isASN: true },
        { label: 'Organizacja', value: ipapi.company?.name },
        { label: 'Typ firmy', value: ipapi.company?.type },
        { label: 'Hosting/DC', value: ipapi.is_datacenter ? 'Tak' : 'Nie' },
        { label: 'Proxy/VPN/Tor', value: (ipapi.is_proxy || ipapi.is_vpn || ipapi.is_tor) ? 'Tak' : 'Nie' },
    ];

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center border-b border-zinc-800 pb-2 last:border-0';

        let valueContent = `<span class="text-zinc-200 font-medium text-sm text-right truncate max-w-[60%]">${field.value || 'N/A'}</span>`;

        if (field.isASN && field.value && field.value !== 'N/A') {
            const asnNumber = ipapi.asn.asn;
            valueContent = `
                <button onclick="handleASNClick('${asnNumber}')" class="text-sky-400 hover:text-sky-300 font-medium text-sm text-right truncate max-w-[60%] transition-colors flex items-center gap-1 ml-auto">
                    ${field.value}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                </button>
            `;
        } else if (field.copy && field.value) {
             valueContent = `
                <button onclick="copyToClipboard('${field.value}')" class="text-zinc-200 hover:text-sky-400 font-medium text-sm text-right truncate max-w-[60%] transition-colors flex items-center gap-1 ml-auto group">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                    ${field.value}
                </button>
            `;
        }

        div.innerHTML = `
            <span class="text-zinc-500 text-xs uppercase tracking-wider">${field.label}</span>
            ${valueContent}
        `;
        container.appendChild(div);
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Optional: show a toast or feedback
    });
}

function renderInfrastructureCard(ipapi) {
    const container = document.getElementById('infrastructureGrid');
    container.innerHTML = '';

    if (!ipapi || (!ipapi.datacenter && !ipapi.asn?.route)) {
        return;
    }

    // Datacenter
    if (ipapi.datacenter) {
        const div = document.createElement('div');
        div.className = 'border-t border-zinc-800 pt-3 mt-1';
        div.innerHTML = `
            <span class="text-zinc-500 text-xs uppercase tracking-wider block mb-2">Centrum Danych</span>
            <div class="space-y-1">
                <div class="flex justify-between text-xs"><span class="text-zinc-500">Nazwa:</span> <span class="text-zinc-300">${ipapi.datacenter.datacenter}</span></div>
                <div class="flex justify-between text-xs"><span class="text-zinc-500">Usługa:</span> <span class="text-zinc-300">${ipapi.datacenter.service}</span></div>
                <div class="flex justify-between text-xs"><span class="text-zinc-500">Zakres:</span> <span class="text-zinc-300">${ipapi.datacenter.network}</span></div>
            </div>
        `;
        container.appendChild(div);
    }

    // Route
    if (ipapi.asn?.route) {
        const div = document.createElement('div');
        // If datacenter exists, add border between them. 
        // If not, add border-t to separate from Network Card section
        div.className = "flex justify-between items-center py-2 border-t border-zinc-800 mt-1";
        div.innerHTML = `
            <span class="text-zinc-500 text-xs uppercase tracking-wider">Trasa (Route)</span>
            <div class="bg-zinc-800 text-sky-400 px-2 py-0.5 rounded text-xs border border-zinc-700 font-mono">
                ${ipapi.asn.route}
            </div>
        `;
        container.appendChild(div);
    }
}

function renderVulns(ipapi) {
    const container = document.getElementById('vulnsContainer');
    if (!container) return;
    container.innerHTML = '';

    // ipapi.is doesn't provide CVEs, but it provides abuser score
    if (!ipapi || !ipapi.is_abuser) {
        container.innerHTML = '<div class="text-zinc-600 text-sm italic text-center py-2">Brak wykrytych zagrożeń.</div>';
        return;
    }

    container.innerHTML = `
        <div class="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div class="text-xs font-semibold uppercase tracking-wider">Wykryto jako nadużycie!</div>
        </div>
    `;
}

function renderGeoCard(ipapi) {
    const container = document.getElementById('geoDetailsGrid');
    container.innerHTML = '';

    if (!ipapi || !ipapi.location) {
        container.innerHTML = '<div class="text-zinc-600 text-sm italic col-span-full">Brak danych geograficznych.</div>';
        return;
    }

    // Helper to format local time
    const formatLocalTime = (timeString) => {
        if (!timeString) return 'N/A';
        try {
            // ipapi.is format is usually YYYY-MM-DD HH:MM
            // We can try to make it more readable using Intl
            const date = new Date(timeString.replace(' ', 'T'));
            if (isNaN(date.getTime())) return timeString; // Fallback to raw string

            return new Intl.DateTimeFormat('pl-PL', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        } catch (e) {
            return timeString;
        }
    };

    const fields = [
        { label: 'Kraj', value: `${ipapi.location.country} (${ipapi.location.country_code})` },
        { label: 'Region/Stan', value: ipapi.location.state },
        { label: 'Miasto', value: ipapi.location.city },
        { label: 'Kod pocztowy', value: ipapi.location.zip },
        { label: 'Strefa czasowa', value: ipapi.location.timezone },
        { label: 'Lokalny czas', value: formatLocalTime(ipapi.location.local_time) },
        { label: 'Współrzędne', value: `${ipapi.location.latitude}, ${ipapi.location.longitude}` },
        { label: 'Waluta', value: ipapi.location.currency_code },
        { label: 'Numer kierunkowy', value: `+${ipapi.location.calling_code}` },
        { label: 'Członek UE', value: ipapi.location.is_eu_member ? 'Tak' : 'Nie' },
    ];

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center border-b border-zinc-800/50 py-2 last:border-0';
        div.innerHTML = `
            <span class="text-zinc-500 text-xs">${field.label}</span>
            <span class="text-zinc-200 font-medium text-sm truncate max-w-[60%]">${field.value || 'N/A'}</span>
        `;
        container.appendChild(div);
    });
}

function renderMap(ipapi) {
    const mapOverlay = document.getElementById('mapOverlay');

    // Always clear existing marker before checking for new location
    if (currentMarker && map) {
        map.removeLayer(currentMarker);
        currentMarker = null;
    }

    if (!ipapi || !ipapi.location || !ipapi.location.latitude) {
        mapOverlay.classList.remove('hidden');
        return;
    }

    mapOverlay.classList.add('hidden');
    const { latitude, longitude, city, country } = ipapi.location;

    if (map) {
        // Ensure map is correctly sized especially when hidden container became visible
        map.invalidateSize();
        map.setView([latitude, longitude], 11);


        currentMarker = L.marker([latitude, longitude]).addTo(map);
        currentMarker.bindPopup(`<b class="text-zinc-900">${city}, ${country}</b>`).openPopup();
    }
}

function renderAbuseCard(ipapi) {
    const content = document.getElementById('abuseCardContent');
    content.innerHTML = '';

    if (!ipapi) {
        content.innerHTML = '<div class="text-zinc-600 text-sm italic">Brak danych o nadużyciach.</div>';
        return;
    }

    const { is_abuser, company, asn, abuse } = ipapi;

    const abuserScore = is_abuser ? 100 : 0;
    const scoreText = is_abuser ? "Wysokie" : "Niskie";
    const scoreColor = is_abuser ? "text-red-500" : "text-emerald-500";
    const barColor = is_abuser ? "bg-red-500" : "bg-emerald-500";

    content.innerHTML = `
        <div class="space-y-4">
            <div>
                <div class="flex justify-between items-center mb-1">
                    <span class="text-zinc-400 text-xs uppercase tracking-wider font-semibold">Wskaźnik nadużyć</span>
                    <span class="${scoreColor} text-sm font-bold">${scoreText}</span>
                </div>
                <div class="w-full bg-zinc-800 rounded-full h-2">
                    <div class="${barColor} h-2 rounded-full transition-all duration-1000" style="width: ${abuserScore}%"></div>
                </div>
            </div>

            <div class="grid grid-cols-1 gap-3 pt-2">
                <div class="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                    <div class="text-zinc-500 text-[10px] uppercase mb-1">Kontakt Abuse</div>
                    <div class="text-zinc-200 text-xs font-medium">${abuse?.name || 'N/A'}</div>
                    <div class="text-sky-400 text-xs truncate mt-1">${abuse?.email || 'N/A'}</div>
                    <div class="text-zinc-400 text-xs mt-1">${abuse?.phone || ''}</div>
                </div>
                <div class="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                    <div class="text-zinc-500 text-[10px] uppercase mb-1">Abuser Score (ASN/Company)</div>
                    <div class="flex justify-between items-center">
                        <span class="text-zinc-200 text-xs">ASN:</span>
                        <span class="text-xs ${asn?.abuser_score?.includes('Low') ? 'text-emerald-500' : 'text-red-400'} font-mono">${asn?.abuser_score || 'N/A'}</span>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-zinc-200 text-xs">Firma:</span>
                        <span class="text-xs ${company?.abuser_score?.includes('Low') ? 'text-emerald-500' : 'text-red-400'} font-mono">${company?.abuser_score || 'N/A'}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Call renderVulns too as it was part of security section
    renderVulns(ipapi);
}

// --- ASN Logic ---
async function handleASNClick(asnNumber, autoScroll = true) {
    if (!asnNumber) return;

    const section = document.getElementById('asnSection');
    const content = document.getElementById('asnContent');

    // Show section and show loading state
    section.classList.remove('hidden');
    if (autoScroll) {
        section.scrollIntoView({ behavior: 'smooth' });
    }
    content.innerHTML = `
        <div class="col-span-full flex flex-col items-center py-12 text-zinc-500">
            <svg class="animate-spin h-8 w-8 mb-4 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p>Pobieranie szczegółów ASN ${asnNumber}...</p>
        </div>
    `;

    try {
        const response = await fetch(`https://api.ip.mordorek.dev/api/asn?asn=${asnNumber}`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Błąd API');

        renderASNInfo(data);
    } catch (err) {
        content.innerHTML = `
            <div class="col-span-full p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center">
                Błąd: ${err.message}
            </div>
        `;
    }
}

function renderASNInfo(data) {
    const content = document.getElementById('asnContent');

    // ipapi.is ASN response structure (from ?q=AS...)
    const asnData = (data.asn && typeof data.asn === 'object') ? data.asn : data;

    const fields = [
        { label: 'Numer ASN', value: `AS${asnData.asn}` },
        { label: 'Organizacja', value: asnData.org },
        { label: 'Opis', value: asnData.descr },
        { label: 'Kraj', value: asnData.country?.toUpperCase() },
        { label: 'Typ', value: asnData.type },
        { label: 'Data powstania', value: asnData.created },
        { label: 'Ostatnia aktualizacja', value: asnData.updated },
        { label: 'RIR', value: asnData.rir },
        { label: 'Abuse Email', value: asnData.abuse },
        { label: 'Domena', value: asnData.domain, isLink: true },
    ];

    let html = `
        <div class="bg-zinc-800/30 rounded-2xl p-5 border border-zinc-700/30 space-y-3 lg:col-span-2">
             <h3 class="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-4">Podstawowe informacje o ASN</h3>
             <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                 ${fields.map(f => `
                    <div class="flex justify-between items-center border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                        <span class="text-zinc-500 text-xs">${f.label}</span>
                        ${f.isLink && f.value ? 
                            `<a href="http://${f.value}" target="_blank" class="text-sky-400 hover:underline text-sm truncate max-w-[60%]">${f.value}</a>` :
                            `<span class="text-zinc-200 font-medium text-sm truncate max-w-[60%]">${f.value || 'N/A'}</span>`
                        }
                    </div>
                 `).join('')}
             </div>
        </div>
    `;

    // Add summary info
    html += `
        <div class="bg-zinc-800/30 rounded-2xl p-5 border border-zinc-700/30 flex flex-col justify-center items-center text-center">
             <div class="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-4 text-purple-500">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
             </div>
             <div class="text-zinc-200 font-bold text-xl mb-1">${asnData.org}</div>
             <div class="text-zinc-500 text-xs uppercase tracking-widest">${asnData.country} &bull; ${asnData.type}</div>
             <a href="https://api.ipapi.is/?q=AS${asnData.asn}" target="_blank" class="mt-6 text-xs text-sky-400 border border-sky-500/30 px-4 py-2 rounded-full hover:bg-sky-500/10 transition-colors">
                Zobacz WHOIS w ipapi.is
             </a>
        </div>
    `;

    content.innerHTML = html;
}

function renderDNS(dns) {
    const container = document.getElementById('dnsContainer');
    if (!dns || Object.keys(dns).length === 0) {
        container.innerHTML = '<div class="col-span-full text-zinc-500 text-center py-4">Brak rekordów DNS</div>';
        return;
    }

    let html = '';
    const sortedTypes = Object.keys(dns).sort();

    for (const type of sortedTypes) {
        const records = dns[type];
        if (records && records.length > 0) {
            html += `
                <div class="bg-zinc-800/30 rounded-2xl p-4 border border-zinc-700/30">
                    <div class="flex items-center justify-between mb-3">
                        <span class="px-2 py-0.5 bg-sky-500/10 text-sky-400 text-[10px] font-bold rounded uppercase tracking-wider">${type}</span>
                        <span class="text-[10px] text-zinc-500">${records.length} ${records.length === 1 ? 'rekord' : 'rekordy'}</span>
                    </div>
                    <div class="space-y-2">
                        ${records.map(r => `
                            <div class="group">
                                <div class="text-zinc-200 text-sm font-mono break-all bg-black/20 p-2 rounded border border-zinc-800/50 group-hover:border-zinc-700/50 transition-colors">
                                    ${r.data}
                                </div>
                                ${r.name !== r.data && r.name !== (r.data + '.') ? `<div class="text-[10px] text-zinc-600 mt-0.5 ml-1 truncate">Name: ${r.name}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    if (!html) {
        container.innerHTML = '<div class="col-span-full text-zinc-500 text-center py-4">Brak rekordów DNS</div>';
    } else {
        container.innerHTML = html;
    }
}
