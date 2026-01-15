// --- Map Initialization ---
let map, currentMarker;

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

        // Check if domain exists (no DNS records and ip-api failed)
        const hasDnsRecords = data.dns ? Object.values(data.dns).some(records => records && records.length > 0) : false;
        const ipInfoFailed = data.ipInfo && data.ipInfo.status === 'fail';

        if (ipInfoFailed && !hasDnsRecords) {
            throw new Error('Podana domena nie istnieje lub nie posiada rekordów DNS.');
        }

        renderData(data);
        resultsDiv.classList.remove('hidden');
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
    renderNetworkCard(data.ipInfo);
    renderInfrastructureCard(data.shodan);
    renderVulns(data.shodan);
    renderGeoCard(data.ipInfo);
    renderMap(data.ipInfo);
    renderAbuseCard(data.abuse);
    renderDNS(data.dns);
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

function renderNetworkCard(info) {
    const container = document.getElementById('networkInfoGrid');
    container.innerHTML = '';

    if (info.error) {
        container.innerHTML = `<div class="text-red-400 text-sm">Błąd: ${info.message}</div>`;
        return;
    }

    const fields = [
        { label: 'Adres IP', value: info.query, copy: true },
        { label: 'Dostawca (ISP)', value: info.isp },
        { label: 'ASN', value: info.as, isASN: true },
        { label: 'Organizacja', value: info.org },
        { label: 'Hosting', value: info.hosting ? 'Tak' : 'Nie' },
        { label: 'Proxy/VPN', value: info.proxy ? 'Tak' : 'Nie' },
    ];

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center border-b border-zinc-800 pb-2 last:border-0';

        let valueContent = `<span class="text-zinc-200 font-medium text-sm text-right truncate max-w-[60%]">${field.value || 'N/A'}</span>`;

        if (field.isASN && field.value) {
            const asnMatch = field.value.match(/AS(\d+)/i);
            if (asnMatch) {
                const asnNumber = asnMatch[1];
                valueContent = `
                    <button onclick="handleASNClick('${asnNumber}')" class="text-sky-400 hover:text-sky-300 font-medium text-sm text-right truncate max-w-[60%] transition-colors flex items-center gap-1 ml-auto">
                        ${field.value}
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                    </button>
                `;
            }
        } else if (field.copy && field.value) {
             valueContent = `
                <button onclick="copyToClipboard('${field.value}')" class="text-zinc-200 hover:text-sky-400 font-medium text-sm text-right truncate max-w-[60%] transition-colors flex items-center gap-1 ml-auto group">
                    ${field.value}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
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

function renderInfrastructureCard(shodan) {
    const container = document.getElementById('infrastructureGrid');
    container.innerHTML = '';

    if (!shodan || (!shodan.ports?.length && !shodan.hostnames?.length)) {
        container.innerHTML = '<div class="text-zinc-600 text-sm italic text-center py-4">Brak danych o infrastrukturze.</div>';
        return;
    }

    // Ports
    if (shodan.ports && shodan.ports.length > 0) {
        const div = document.createElement('div');
        div.innerHTML = `
            <span class="text-zinc-500 text-xs uppercase tracking-wider block mb-2">Otwarte porty</span>
            <div class="flex flex-wrap gap-2">
                ${shodan.ports.map(p => `<span class="bg-zinc-800 text-sky-400 px-2 py-1 rounded text-xs border border-zinc-700 font-mono">${p}</span>`).join('')}
            </div>
        `;
        container.appendChild(div);
    }

    // Hostnames
    if (shodan.hostnames && shodan.hostnames.length > 0) {
        const div = document.createElement('div');
        div.innerHTML = `
            <span class="text-zinc-500 text-xs uppercase tracking-wider block mb-2">Nazwy hostów</span>
            <div class="flex flex-wrap gap-2">
                ${shodan.hostnames.slice(0, 5).map(h => `<span class="bg-zinc-800 text-zinc-300 px-2 py-1 rounded text-xs border border-zinc-700 truncate max-w-full">${h}</span>`).join('')}
                ${shodan.hostnames.length > 5 ? `<span class="text-zinc-500 text-xs self-center">+${shodan.hostnames.length - 5} więcej</span>` : ''}
            </div>
        `;
        container.appendChild(div);
    }
}

function renderVulns(shodan) {
    const container = document.getElementById('vulnsContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!shodan || !shodan.vulns || shodan.vulns.length === 0) {
        container.innerHTML = '<div class="text-zinc-600 text-sm italic text-center py-2">Brak wykrytych podatności (CVE).</div>';
        return;
    }

    const div = document.createElement('div');
    div.innerHTML = `
        <span class="text-zinc-500 text-xs uppercase tracking-wider block mb-2">Podatności (CVE)</span>
        <div class="flex flex-wrap gap-2">
            ${shodan.vulns.slice(0, 5).map(v => `<a href="https://nvd.nist.gov/vuln/detail/${v}" target="_blank" class="bg-red-900/20 text-red-400 hover:text-red-300 px-2 py-1 rounded text-xs border border-red-900/50 font-mono transition-colors">${v}</a>`).join('')}
             ${shodan.vulns.length > 5 ? `<span class="text-zinc-500 text-xs self-center">+${shodan.vulns.length - 5} więcej</span>` : ''}
        </div>
    `;
    container.appendChild(div);
}

function renderGeoCard(info) {
    const container = document.getElementById('geoDetailsGrid');
    container.innerHTML = '';

    if (info.error) {
        container.innerHTML = `<div class="text-red-400 text-sm">Błąd: ${info.message}</div>`;
        return;
    }

    const fields = [
        { label: 'Kraj', value: `${info.country} (${info.countryCode || '-'})` },
        { label: 'Region', value: info.regionName },
        { label: 'Miasto', value: info.city },
        { label: 'Współrzędne', value: `${info.lat}, ${info.lon}` },
        { label: 'Strefa czasowa', value: info.timezone },
        { label: 'Waluta', value: info.currency },
    ];

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center border-b border-zinc-800 pb-2 last:border-0';
        div.innerHTML = `
            <span class="text-zinc-500 text-xs uppercase tracking-wider">${field.label}</span>
            <span class="text-zinc-200 font-medium text-sm text-right truncate max-w-[60%]">${field.value || 'N/A'}</span>
        `;
        container.appendChild(div);
    });
}

function renderMap(info) {
    const overlay = document.getElementById('mapOverlay');

    if (!map) {
        // Map not available, show overlay
        overlay.classList.remove('hidden');
        return;
    }

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

function renderAbuseCard(abuse) {
    const container = document.getElementById('abuseCardContent');
    container.innerHTML = '';

    if (abuse.error || abuse.abuseSkipped) {
        container.innerHTML = `<div class="text-zinc-500 italic text-sm">Brak danych z AbuseIPDB</div>`;
        return;
    }

    const score = abuse.abuseConfidenceScore || 0;
    let colorClass = 'text-green-400';
    if (score > 20) colorClass = 'text-yellow-400';
    if (score > 60) colorClass = 'text-red-500';

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center mb-4">
            <span class="text-6xl font-bold ${colorClass}">${score}%</span>
            <span class="text-zinc-400 text-xs uppercase tracking-widest mt-2">Wskaźnik pewności</span>
        </div>
        
        <div class="grid grid-cols-2 gap-4 w-full mt-2">
            <div class="bg-zinc-800/50 rounded-xl p-3 flex flex-col items-center">
                <span class="text-xl font-bold text-zinc-200">${abuse.totalReports || 0}</span>
                <span class="text-[10px] text-zinc-500 uppercase">Łącznie zgłoszeń</span>
            </div>
            <div class="bg-zinc-800/50 rounded-xl p-3 flex flex-col items-center">
                <span class="text-sm font-bold text-zinc-200 truncate w-full text-center">${abuse.lastReportedAt ? new Date(abuse.lastReportedAt).toLocaleDateString() : '-'}</span>
                <span class="text-[10px] text-zinc-500 uppercase">Ostatnie zgłoszenie</span>
            </div>
        </div>
    `;
}

function renderDNS(dns) {
    const container = document.getElementById('dnsContainer');
    container.innerHTML = '';

    const types = Object.keys(dns);

    // Sort types: A, AAAA first, then PTR, then others
    const priority = ['A', 'AAAA', 'PTR', 'MX', 'NS', 'CNAME', 'TXT', 'SOA'];
    types.sort((a, b) => {
        const idxA = priority.indexOf(a);
        const idxB = priority.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    if (types.length === 0) {
        container.innerHTML = '<div class="text-zinc-500 col-span-full text-center py-8">Nie znaleziono rekordów DNS.</div>';
        return;
    }

    types.forEach(type => {
        const records = dns[type];
        if (!records || records.length === 0) return;

        const section = document.createElement('div');
        section.className = 'bg-zinc-800/50 rounded-xl border border-zinc-700/50 overflow-hidden flex flex-col';

        let rows = '';
        records.forEach(record => {
            // Highlight SPF/DMARC in TXT
            let content = record.data;
            let logosHtml = '';

            if (type === 'TXT') {
                const services = detectServices(content);
                if (services.length > 0) {
                    logosHtml = `<div class="flex flex-wrap gap-2 mt-1 items-center">
                        ${services.map(domain => `
                            <div class="flex items-center gap-1 bg-zinc-900/50 px-1.5 py-0.5 rounded border border-zinc-700/50" title="${domain}">
                                <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" 
                                     alt="${domain}" 
                                     class="w-3 h-3 rounded-sm" />
                                <span class="text-[10px] text-zinc-400">${domain}</span>
                            </div>
                        `).join('')}
                    </div>`;
                }

                if (content.includes('v=spf1')) {
                    content = `<span class="text-green-400 font-mono break-all text-xs">${content}</span>`;
                } else if (content.includes('v=DMARC1')) {
                    content = `<span class="text-blue-400 font-mono break-all text-xs">${content}</span>`;
                } else {
                    content = `<span class="font-mono text-zinc-300 break-all text-xs">${content}</span>`;
                }
            } else if (type === 'PTR') {
                // Highlight PTR records (reverse DNS) with a special color
                content = `<span class="text-purple-400 font-mono break-all text-xs">${content}</span>`;
            } else {
                 content = `<span class="font-mono text-zinc-300 break-all text-xs">${content}</span>`;
            }

            rows += `
                        <div class="px-4 py-2 border-b border-zinc-700/30 last:border-0 hover:bg-zinc-700/20 transition-colors">
                            <div class="flex justify-between items-start gap-4">
                                <div class="flex-1 min-w-0">
                                    <div class="text-xs text-zinc-500 font-mono mb-0.5">${record.name}</div>
                                    <div>${content}</div>
                                    ${logosHtml}
                                </div>
                                <div class="text-xs text-zinc-600 font-mono whitespace-nowrap">${record.TTL}s</div>
                            </div>
                        </div>
                    `;
        });

        section.innerHTML = `
                    <div class="px-4 py-2 border-b border-zinc-700/50 bg-zinc-800 flex items-center justify-between">
                        <span class="text-zinc-200 font-bold text-sm">${type}</span>
                        <span class="bg-zinc-900 text-zinc-500 px-2 py-0.5 rounded text-[10px] font-mono">${records.length}</span>
                    </div>
                    <div class="flex-1 overflow-y-auto max-h-[300px]">
                        ${rows}
                    </div>
                `;
        container.appendChild(section);
    });
}

function detectServices(txt) {
    const domains = new Set();
    const lowerTxt = txt.toLowerCase();

    // 1. Explicit Verification Tokens
    const verificationPatterns = [
        { regex: /google-site-verification/, domain: 'google.com' },
        { regex: /facebook-domain-verification/, domain: 'facebook.com' },
        { regex: /apple-domain-verification/, domain: 'apple.com' },
        { regex: /atlassian-domain-verification/, domain: 'atlassian.com' },
        { regex: /docker-verification/, domain: 'docker.com' },
        { regex: /dropbox-domain-verification/, domain: 'dropbox.com' },
        { regex: /github-verification/, domain: 'github.com' },
        { regex: /gitlab-verification/, domain: 'gitlab.com' },
        { regex: /heroku-verification/, domain: 'heroku.com' },
        { regex: /mailgun-domain-verification/, domain: 'mailgun.com' },
        { regex: /okta-verification/, domain: 'okta.com' },
        { regex: /stripe-verification/, domain: 'stripe.com' },
        { regex: /yandex-verification/, domain: 'yandex.com' },
        { regex: /zoho-verification/, domain: 'zoho.com' },
        { regex: /_globalsign-domain-verification/, domain: 'globalsign.com' },
        { regex: /amazon-domain-verification/, domain: 'amazon.com' },
        { regex: /adobe-idp-site-verification/, domain: 'adobe.com' },
        { regex: /^ms=/, domain: 'microsoft.com' },
        { regex: /have-i-been-pwned-verification/, domain: 'haveibeenpwned.com' },
        { regex: /cisco-ci-domain-verification/, domain: 'cisco.com' },
    ];

    verificationPatterns.forEach(p => {
        if (p.regex.test(lowerTxt)) domains.add(p.domain);
    });

    // 2. Generic Verification Regex
    // e.g. "some-service-verification=..."
    // Use lazy matching for the service name to allow the optional -site/-domain part to be consumed by the specific group if present
    const genericMatch = lowerTxt.match(/([a-z0-9-]+?)(?:-site|-domain)?-verification=/);
    if (genericMatch) {
         const name = genericMatch[1];
         // Basic validation to avoid junk
         if (name && name.length > 1 && !name.includes('--')) {
             domains.add(name + '.com');
         }
    }

    // 3. SPF Includes
    if (lowerTxt.includes('v=spf1')) {
        const includes = lowerTxt.match(/include:([^\s"';]+)/g);
        if (includes) {
            includes.forEach(inc => {
                let d = inc.replace('include:', '');
                // Map known SPF domains to main service domains
                if (d.includes('google.com')) d = 'google.com';
                else if (d.includes('outlook.com') || d.includes('protection.outlook.com')) d = 'microsoft.com';
                else if (d.includes('amazonses.com')) d = 'amazon.com';
                else if (d.includes('mailgun.org')) d = 'mailgun.com';
                else if (d.includes('sendgrid.net')) d = 'sendgrid.com';
                else if (d.includes('mandrillapp.com') || d.includes('mcsv.net')) d = 'mailchimp.com';
                else if (d.includes('zendesk.com')) d = 'zendesk.com';
                else if (d.includes('salesforce.com')) d = 'salesforce.com';
                else if (d.includes('shopify.com')) d = 'shopify.com';
                else if (d.includes('atlassian.net')) d = 'atlassian.com';
                else {
                    // Try to get root domain
                    const parts = d.split('.');
                    if (parts.length > 2) {
                        d = parts.slice(-2).join('.');
                    }
                }
                domains.add(d);
            });
        }
    }

    return Array.from(domains);
}

// --- ASN Logic ---
async function handleASNClick(asn) {
    const section = document.getElementById('asnSection');
    const content = document.getElementById('asnContent');

    // Show section and show loading state
    section.classList.remove('hidden');
    section.scrollIntoView({ behavior: 'smooth' });
    content.innerHTML = `
        <div class="col-span-full flex flex-col items-center py-12 text-zinc-500">
            <svg class="animate-spin h-8 w-8 mb-4 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p>Pobieranie szczegółów ASN ${asn}...</p>
        </div>
    `;

    try {
        const response = await fetch(`https://api.ip.mordorek.dev/api/asn?asn=${asn}`);
        if (!response.ok) throw new Error('Nie udało się pobrać danych o ASN');
        const data = await response.json();
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

    // Group basic info
    const fields = [
        { label: 'Numer ASN', value: `AS${data.asn}` },
        { label: 'Nazwa', value: data.name },
        { label: 'Pełna nazwa', value: data.description_short },
        { label: 'Kraj', value: data.country_code },
        { label: 'Strona WWW', value: data.website, isLink: true },
        { label: 'Data rejestracji', value: data.iana_assignment?.date_assigned },
        { label: 'Status', value: data.iana_assignment?.registration_status },
        { label: 'Serwer WHOIS', value: data.iana_assignment?.whois_server },
    ];

    let html = `
        <div class="bg-zinc-800/30 rounded-2xl p-5 border border-zinc-700/30 space-y-3">
             <h3 class="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-4">Podstawowe informacje</h3>
             ${fields.map(f => `
                <div class="flex justify-between items-center border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                    <span class="text-zinc-500 text-xs">${f.label}</span>
                    ${f.isLink && f.value ? 
                        `<a href="${f.value}" target="_blank" class="text-purple-400 hover:underline text-sm truncate max-w-[60%]">${f.value}</a>` :
                        `<span class="text-zinc-200 font-medium text-sm truncate max-w-[60%]">${f.value || 'N/A'}</span>`
                    }
                </div>
             `).join('')}
        </div>
    `;

    // Add address info if available
    if (data.owner_address && data.owner_address.length > 0) {
        html += `
            <div class="bg-zinc-800/30 rounded-2xl p-5 border border-zinc-700/30">
                <h3 class="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-4">Adres rejestrowy</h3>
                <div class="text-zinc-300 text-sm space-y-1">
                    ${data.owner_address.map(line => `<p>${line}</p>`).join('')}
                </div>
            </div>
        `;
    }

    // Add summary info
    html += `
        <div class="bg-zinc-800/30 rounded-2xl p-5 border border-zinc-700/30 flex flex-col justify-center items-center text-center">
             <div class="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-4 text-purple-500">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
             </div>
             <div class="text-zinc-200 font-bold text-xl mb-1">${data.name}</div>
             <div class="text-zinc-500 text-xs uppercase tracking-widest">${data.country_code} &bull; ${data.iana_assignment?.registration_status}</div>
             <a href="https://bgpview.io/asn/${data.asn}" target="_blank" class="mt-6 text-xs text-purple-400 border border-purple-500/30 px-4 py-2 rounded-full hover:bg-purple-500/10 transition-colors">
                Zobacz pełny raport w BGPView
             </a>
        </div>
    `;

    content.innerHTML = html;
}

