// Konfiguracja
// Jeśli Worker jest na innej domenie, wpisz tutaj pełny adres, np. "https://twoj-worker.workers.dev/api/lookup"
const API_URL = "/api/lookup"; 

let map = null;
let marker = null;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    // Sprawdź czy w URL jest adres IP (np. https://strona.com/1.2.3.4)
    const pathIp = window.location.pathname.substring(1); // usuwa pierwszy slash
    
    // Prosta walidacja czy to co jest w ścieżce wygląda jak IP (lub jest puste)
    // Ignorujemy 'index.html' itp.
    if (pathIp && pathIp !== "index.html" && !pathIp.includes("/")) {
        document.getElementById('ip-input').value = pathIp;
        fetchData(pathIp);
    } else {
        // Jeśli brak IP w ścieżce, pobierz dane dla obecnego użytkownika (pusty parametr)
        fetchData();
    }

    // Obsługa przycisku szukaj
    document.getElementById('search-btn').addEventListener('click', () => {
        const ip = document.getElementById('ip-input').value.trim();
        // Aktualizuj URL bez przeładowania (opcjonalne, ale ładne)
        if (ip) {
            window.history.pushState({}, '', '/' + ip);
            fetchData(ip);
        } else {
            window.history.pushState({}, '', '/');
            fetchData();
        }
    });

    // Obsługa entera w polu input
    document.getElementById('ip-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('search-btn').click();
        }
    });
});

function initMap() {
    // Inicjalizacja mapy (domyślnie widok na świat)
    map = L.map('map').setView([20, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);
}

async function fetchData(ip = "") {
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const resultsDiv = document.getElementById('results');

    loading.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    resultsDiv.classList.add('hidden');

    try {
        // Budowanie URL zapytania
        let url = `${API_URL}`;
        if (ip) {
            url += `?ip=${ip}`;
        }

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Błąd sieci: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        displayResults(data);

    } catch (err) {
        console.error(err);
        errorDiv.textContent = `Wystąpił błąd: ${err.message}. Upewnij się, że Worker działa i jest poprawnie skonfigurowany.`;
        errorDiv.classList.remove('hidden');
    } finally {
        loading.classList.add('hidden');
    }
}

function displayResults(data) {
    const resultsDiv = document.getElementById('results');
    
    // Wypełnianie pól
    setText('res-ip', data.ip);
    setText('res-hostname', data.hostname);
    setText('res-city', data.city);
    setText('res-region', data.region);
    setText('res-country', data.country);
    setText('res-org', data.org);
    setText('res-loc', data.loc);
    setText('res-timezone', data.timezone);
    
    // JSON raw
    document.getElementById('res-json').textContent = JSON.stringify(data, null, 2);

    // Aktualizacja mapy
    if (data.loc) {
        const [lat, lon] = data.loc.split(',').map(Number);
        if (!isNaN(lat) && !isNaN(lon)) {
            map.setView([lat, lon], 13);
            
            if (marker) {
                map.removeLayer(marker);
            }
            
            marker = L.marker([lat, lon]).addTo(map)
                .bindPopup(`<b>${data.ip}</b><br>${data.city}, ${data.country}`)
                .openPopup();
        }
    }

    resultsDiv.classList.remove('hidden');
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = text || '-';
    }
}
