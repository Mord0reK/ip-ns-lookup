// --- Map Initialization ---
let map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

let currentMarker = null;

// --- UI Logic ---
const btn = document.getElementById('analyzeBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const input = document.getElementById('targetInput');
const errorMsg = document.getElementById('errorMsg');
const resultsDiv = document.getElementById('results');

btn.addEventListener('click', handleAnalyze);
input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

async function handleAnalyze() {
    const target = input.value.trim();
    if (!target) return;

    // Reset UI
    setLoading(true);
    errorMsg.classList.add('hidden');
    resultsDiv.classList.add('hidden');

    try {
        const response = await fetch(`https://api.ip.mordorek.dev/api/analyze?target=${encodeURIComponent(target)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch data');
        }

        renderData(data);
        resultsDiv.classList.remove('hidden');

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
    renderNetworkInfo(data.ipInfo);
    renderMap(data.ipInfo);
    renderAbuse(data.abuse);
    renderDNS(data.dns);
}

function renderNetworkInfo(info) {
    const container = document.getElementById('networkInfoGrid');
    container.innerHTML = '';

    if (info.error) {
        container.innerHTML = `<div class="col-span-2 text-red-400">Error fetching IP info: ${info.message}</div>`;
        return;
    }

    const fields = [
        { label: 'IP Address', value: info.query, copy: true },
        { label: 'ISP', value: info.isp },
        { label: 'Organization', value: info.org },
        { label: 'AS', value: info.as },
        { label: 'Country', value: `${info.country} (${info.countryCode || '-'})` },
        { label: 'Region/City', value: `${info.regionName}, ${info.city}` },
        { label: 'Hosting', value: info.hosting ? 'Yes' : 'No' },
        { label: 'Proxy', value: info.proxy ? 'Yes' : 'No' },
    ];

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'flex flex-col border-b border-slate-700/50 pb-2 last:border-0';
        div.innerHTML = `
                    <span class="text-slate-500 text-xs uppercase tracking-wider mb-1">${field.label}</span>
                    <span class="text-slate-200 font-medium break-all">${field.value || 'N/A'}</span>
                `;
        container.appendChild(div);
    });
}

function renderMap(info) {
    const overlay = document.getElementById('mapOverlay');

    if (info.status === 'success' && info.lat && info.lon) {
        overlay.classList.add('hidden');

        // Update Map
        const lat = info.lat;
        const lon = info.lon;

        map.setView([lat, lon], 10);

        if (currentMarker) {
            map.removeLayer(currentMarker);
        }

        currentMarker = L.circleMarker([lat, lon], {
            color: '#38bdf8', // sky-400
            fillColor: '#38bdf8',
            fillOpacity: 0.5,
            radius: 10
        }).addTo(map);

        // Force map resize to fix rendering issues if container was hidden
        setTimeout(() => { map.invalidateSize(); }, 100);

    } else {
        overlay.classList.remove('hidden');
    }
}

function renderAbuse(abuse) {
    const container = document.getElementById('abuseInfo');
    const badge = document.getElementById('abuseScoreBadge');
    container.innerHTML = '';

    if (abuse.error || abuse.abuseSkipped) {
        container.innerHTML = `<div class="col-span-3 text-slate-500 italic">${abuse.message || 'No abuse data available'}</div>`;
        badge.classList.add('hidden');
        return;
    }

    // Score Logic
    const score = abuse.abuseConfidenceScore || 0;
    let colorClass = 'bg-green-500/20 text-green-400 border-green-500/50';
    if (score > 20) colorClass = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    if (score > 60) colorClass = 'bg-red-500/20 text-red-400 border-red-500/50';

    badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${colorClass}`;
    badge.textContent = `Risk Score: ${score}%`;
    badge.classList.remove('hidden');

    const items = [
        { label: 'Confidence Score', value: `${score}%` },
        { label: 'Total Reports', value: abuse.totalReports || 0 },
        { label: 'Last Reported', value: abuse.lastReportedAt ? new Date(abuse.lastReportedAt).toLocaleDateString() : 'Never' }
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'bg-slate-900/50 rounded-lg p-4 border border-slate-700';
        div.innerHTML = `
                    <div class="text-2xl font-bold text-slate-100 mb-1">${item.value}</div>
                    <div class="text-xs text-slate-500 uppercase tracking-wider">${item.label}</div>
                `;
        container.appendChild(div);
    });
}

function renderDNS(dns) {
    const container = document.getElementById('dnsContainer');
    container.innerHTML = '';

    const types = Object.keys(dns);
    if (types.length === 0) {
        container.innerHTML = '<div class="text-slate-500">No DNS records found.</div>';
        return;
    }

    types.forEach(type => {
        const records = dns[type];
        if (!records || records.length === 0) return;

        const section = document.createElement('div');
        section.className = 'bg-slate-800 rounded-xl shadow-lg border border-slate-700 overflow-hidden';

        let rows = '';
        records.forEach(record => {
            // Highlight SPF/DMARC in TXT
            let content = record.data;
            if (type === 'TXT') {
                if (content.includes('v=spf1')) {
                    content = `<span class="text-green-400 font-mono">${content}</span>`;
                } else if (content.includes('v=DMARC1')) {
                    content = `<span class="text-blue-400 font-mono">${content}</span>`;
                } else {
                    content = `<span class="font-mono text-slate-300">${content}</span>`;
                }
            }

            rows += `
                        <tr class="hover:bg-slate-700/30 transition-colors">
                            <td class="px-6 py-3 text-sm text-slate-300 font-mono whitespace-nowrap w-32">${record.name}</td>
                            <td class="px-6 py-3 text-sm text-slate-300 font-mono break-all">${content}</td>
                            <td class="px-6 py-3 text-sm text-slate-500 text-right w-24">${record.TTL}s</td>
                        </tr>
                    `;
        });

        section.innerHTML = `
                    <div class="px-6 py-3 border-b border-slate-700 bg-slate-800/50 flex items-center gap-2">
                        <span class="bg-slate-700 text-slate-200 px-2 py-1 rounded text-xs font-bold w-12 text-center">${type}</span>
                        <span class="text-sm text-slate-400">${records.length} record(s)</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <tbody class="divide-y divide-slate-700">
                                ${rows}
                            </tbody>
                        </table>
                    </div>
                `;
        container.appendChild(section);
    });
}