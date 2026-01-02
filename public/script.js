// --- Map Initialization ---
let map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'map-tiles'
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
    renderNetworkInfo(data.ipInfo, data.shodan);
    renderMap(data.ipInfo);
    renderAbuse(data.abuse);
    renderDNS(data.dns);
}

function renderNetworkInfo(info, shodan) {
    const container = document.getElementById('networkInfoGrid');
    container.innerHTML = '';

    if (info.error) {
        container.innerHTML = `<div class="col-span-2 text-red-400">Error fetching IP info: ${info.message}</div>`;
        return;
    }

    const fields = [
        { label: 'Adres IP', value: info.query, copy: true },
        { label: 'ISP (Dostawca)', value: info.isp },
        { label: 'Organizacja', value: info.org },
        { label: 'AS', value: info.as },
        { label: 'Kraj', value: `${info.country} (${info.countryCode || '-'})` },
        { label: 'Miasto', value: `${info.regionName}, ${info.city}` },
        { label: 'Czy hosting?', value: info.hosting ? 'Tak' : 'Nie' },
        { label: 'Czy proxy?', value: info.proxy ? 'Tak' : 'Nie' },
    ];

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'flex flex-col border-b border-zinc-800 pb-2 last:border-0';
        div.innerHTML = `
                    <span class="text-zinc-500 text-xs uppercase tracking-wider mb-1">${field.label}</span>
                    <span class="text-zinc-200 font-medium break-all">${field.value || 'N/A'}</span>
                `;
        container.appendChild(div);
    });

    // Shodan Data Integration
    if (shodan) {
        // Hosted Domains
        if (shodan.hostnames && shodan.hostnames.length > 0) {
            const div = document.createElement('div');
            div.className = 'flex flex-col border-b border-zinc-800 pb-2 last:border-0 pt-2';
            div.innerHTML = `
                <span class="text-zinc-500 text-xs uppercase tracking-wider mb-2">Domeny hostowane</span>
                <div class="flex flex-wrap gap-2">
                    ${shodan.hostnames.map(h => `<span class="bg-zinc-800 text-zinc-300 px-2 py-1 rounded text-xs border border-zinc-700 break-all">${h}</span>`).join('')}
                </div>
            `;
            container.appendChild(div);
        }

        // Open Ports
        if (shodan.ports && shodan.ports.length > 0) {
            const div = document.createElement('div');
            div.className = 'flex flex-col border-b border-zinc-800 pb-2 last:border-0 pt-2';
            div.innerHTML = `
                <span class="text-zinc-500 text-xs uppercase tracking-wider mb-2">Otwarte porty</span>
                <div class="flex flex-wrap gap-2">
                    ${shodan.ports.map(p => `<span class="bg-sky-900/30 text-sky-400 px-2 py-1 rounded text-xs border border-sky-800/50 font-mono">${p}</span>`).join('')}
                </div>
            `;
            container.appendChild(div);
        }

        // Vulnerabilities
        if (shodan.vulns && shodan.vulns.length > 0) {
            const div = document.createElement('div');
            div.className = 'flex flex-col border-b border-zinc-800 pb-2 last:border-0 pt-2';
            div.innerHTML = `
                <span class="text-zinc-500 text-xs uppercase tracking-wider mb-2">Vulnerabilities (CVE)</span>
                <div class="flex flex-wrap gap-2">
                    ${shodan.vulns.map(v => `<a href="https://nvd.nist.gov/vuln/detail/${v}" target="_blank" class="bg-red-900/20 text-red-400 hover:text-red-300 px-2 py-1 rounded text-xs border border-red-900/50 font-mono transition-colors">${v}</a>`).join('')}
                </div>
            `;
            container.appendChild(div);
        }
    }
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
        container.innerHTML = `<div class="col-span-3 text-zinc-500 italic">${abuse.message || 'Brak dostępnych informacji z AbuseIPDB'}</div>`;
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
        { label: 'Pewność', value: `${score}%` },
        { label: 'Łącznie zgłoszeń', value: abuse.totalReports || 0 },
        { label: 'Ostatnio zgłoszono', value: abuse.lastReportedAt ? new Date(abuse.lastReportedAt).toLocaleDateString() : 'Nigdy' }
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'bg-zinc-900/50 rounded-lg p-4 border border-zinc-800';
        div.innerHTML = `
                    <div class="text-2xl font-bold text-zinc-100 mb-1">${item.value}</div>
                    <div class="text-xs text-zinc-500 uppercase tracking-wider">${item.label}</div>
                `;
        container.appendChild(div);
    });
}

function renderDNS(dns) {
    const container = document.getElementById('dnsContainer');
    container.innerHTML = '';

    const types = Object.keys(dns);
    if (types.length === 0) {
        container.innerHTML = '<div class="text-zinc-500">No DNS records found.</div>';
        return;
    }

    types.forEach(type => {
        const records = dns[type];
        if (!records || records.length === 0) return;

        const section = document.createElement('div');
        section.className = 'bg-zinc-900 rounded-xl shadow-lg border border-zinc-800 overflow-hidden';

        let rows = '';
        records.forEach(record => {
            // Highlight SPF/DMARC in TXT
            let content = record.data;
            let logosHtml = '';

            if (type === 'TXT') {
                const services = detectServices(content);
                if (services.length > 0) {
                    logosHtml = `<div class="flex flex-wrap gap-2 mt-2 items-center">
                        ${services.map(domain => `
                            <div class="flex items-center gap-1 bg-zinc-800 px-2 py-1 rounded border border-zinc-700" title="${domain}">
                                <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" 
                                     alt="${domain}" 
                                     class="w-4 h-4 rounded-sm" />
                                <span class="text-xs text-zinc-300">${domain}</span>
                            </div>
                        `).join('')}
                    </div>`;
                }

                if (content.includes('v=spf1')) {
                    content = `<span class="text-green-400 font-mono break-all">${content}</span>`;
                } else if (content.includes('v=DMARC1')) {
                    content = `<span class="text-blue-400 font-mono break-all">${content}</span>`;
                } else {
                    content = `<span class="font-mono text-zinc-300 break-all">${content}</span>`;
                }
            }

            rows += `
                        <tr class="hover:bg-zinc-800/50 transition-colors">
                            <td class="px-6 py-3 text-sm text-zinc-300 font-mono whitespace-nowrap w-32 align-top">${record.name}</td>
                            <td class="px-6 py-3 text-sm text-zinc-300 font-mono align-top">
                                <div>${content}</div>
                                ${logosHtml}
                            </td>
                            <td class="px-6 py-3 text-sm text-zinc-500 text-right w-24 align-top">${record.TTL}s</td>
                        </tr>
                    `;
        });

        section.innerHTML = `
                    <div class="px-6 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-2">
                        <span class="bg-zinc-800 text-zinc-200 px-2 py-1 rounded text-xs font-bold w-12 text-center">${type}</span>
                        <span class="text-sm text-zinc-400">${records.length} record(s)</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <tbody class="divide-y divide-zinc-800">
                                ${rows}
                            </tbody>
                        </table>
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
