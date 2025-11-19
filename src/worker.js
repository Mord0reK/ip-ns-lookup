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
      
      // Jeśli podano IP w parametrze, użyj go.
      // Jeśli nie, użyj IP użytkownika z nagłówka Cloudflare.
      const ipToLookup = targetIp || request.headers.get("CF-Connecting-IP");

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
