export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Obsługa CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Sprawdzamy czy to zapytanie do API
    // Endpoint: /api/lookup?ip=1.2.3.4
    if (url.pathname.startsWith("/api/lookup")) {
      const targetIp = url.searchParams.get("ip");
      
      let ipToLookup = targetIp;
      let queryDomain = null;

      // Jeśli nie podano parametru, weź IP użytkownika
      if (!ipToLookup) {
        ipToLookup = request.headers.get("CF-Connecting-IP");
      } else if (!isIpAddress(ipToLookup)) {
        // Jeśli podano coś co nie jest IP, zakładamy że to domena
        queryDomain = ipToLookup;
        const resolvedIp = await resolveDns(ipToLookup);
        
        if (!resolvedIp) {
           return new Response(JSON.stringify({ error: `Nie udało się rozwiązać domeny: ${ipToLookup}` }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        ipToLookup = resolvedIp;
      }

      if (!ipToLookup) {
        return new Response(JSON.stringify({ error: "Nie udało się ustalić adresu IP" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Budowanie URL do ipinfo.io
      // Jeśli użytkownik ustawił zmienną środowiskową IPINFO_TOKEN w wrangler.toml lub dashboardzie CF
      const token = env.IPINFO_TOKEN ? `?token=${env.IPINFO_TOKEN}` : "";
      const ipinfoUrl = `https://ipinfo.io/${ipToLookup}/json${token}`;

      try {
        const response = await fetch(ipinfoUrl);
        
        if (!response.ok) {
            throw new Error(`Błąd ipinfo: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Dodajemy informację o szukanej domenie, jeśli była
        if (queryDomain) {
            data.query_domain = queryDomain;
        }

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Domyślna odpowiedź dla innych ścieżek (np. 404)
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};

function isIpAddress(str) {
    // Proste sprawdzenie IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(str)) return true;
    
    // Proste sprawdzenie IPv6 (musi zawierać dwukropek)
    if (str.includes(':')) return true;
    
    return false;
}

async function resolveDns(domain) {
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`;
    try {
        const response = await fetch(dohUrl, {
            headers: { 'Accept': 'application/dns-json' }
        });
        const data = await response.json();
        if (data.Status === 0 && data.Answer) {
            const record = data.Answer.find(r => r.type === 1); // Type A
            return record ? record.data : null;
        }
    } catch (e) {
        console.error("DNS resolution error:", e);
    }
    return null;
}
