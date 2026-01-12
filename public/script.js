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
window.addEventListener('DOMContentLoaded', loadUserIP);

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
        { label: 'ASN', value: info.as },
        { label: 'Organizacja', value: info.org },
        { label: 'Hosting', value: info.hosting ? 'Tak' : 'Nie' },
        { label: 'Proxy/VPN', value: info.proxy ? 'Tak' : 'Nie' },
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

    // Sort types: A, AAAA first, then others
    const priority = ['A', 'AAAA', 'MX', 'NS', 'CNAME', 'TXT', 'SOA'];
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
