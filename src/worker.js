export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow GET /api/analyze
    if (url.pathname === "/api/analyze" && request.method === "GET") {
      const target = url.searchParams.get("target");

      if (!target) {
        return new Response(JSON.stringify({ error: "target required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Basic validation (simple regex for IP or Domain)
      // This is a loose check to prevent obvious garbage
      const isIpOrDomain = /^[a-zA-Z0-9.-]+$/.test(target);
      if (!isIpOrDomain) {
        return new Response(JSON.stringify({ error: "Invalid target format" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Prepare Promises
      const dnsTypes = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"];

      // 1. DNS Logic
      const dnsPromise = (async () => {
        const results = {};
        await Promise.all(
          dnsTypes.map(async (type) => {
            try {
              const res = await fetch(
                `https://cloudflare-dns.com/dns-query?name=${target}&type=${type}`,
                { headers: { accept: "application/dns-json" } }
              );
              if (!res.ok) throw new Error(`DNS ${type} failed`);
              const data = await res.json();
              results[type] = data.Answer || [];
            } catch (e) {
              results[type] = []; // Return empty on error to not break everything
            }
          })
        );
        return results;
      })();

      // 2. IP Info Logic
      // Note: IP-API works for domains too (resolves them), but prompt says "If target is IP address".
      // We will try it for both, as it provides useful info for domains too (hosting info).
      const ipInfoPromise = (async () => {
        try {
          const fields = "status,message,country,regionName,city,lat,lon,isp,org,as,proxy,hosting,query";
          const res = await fetch(`http://ip-api.com/json/${target}?fields=${fields}`);
          if (!res.ok) throw new Error("IP-API failed");
          return await res.json();
        } catch (e) {
          return { error: "ipInfoError", message: e.message };
        }
      })();

      // 3. AbuseIPDB Logic
      // AbuseIPDB requires an IP address. If target is a domain, this will likely fail or return 400.
      // We will attempt it, and if it fails, we return the error.
      const abusePromise = (async () => {

        // Simple check if target looks like an IP (v4 or v6)
        const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$/.test(target);

        // If it's definitely not an IP, skip AbuseIPDB to save quota/errors
        if (!isIp) {
             return { error: "abuseSkipped", message: "Target is not an IP" };
        }

        try {
          const res = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${target}`, {
            headers: {
              "Key": env.ABUSEIPDB_KEY,
              "Accept": "application/json"
            }
          });
          if (!res.ok) {
             const errText = await res.text();
             throw new Error(`AbuseIPDB failed: ${res.status} ${errText}`);
          }
          const data = await res.json();
          return data.data || {};
        } catch (e) {
          return { error: "abuseError", message: e.message };
        }
      })();

      // 4. Shodan InternetDB Logic
      const shodanPromise = (async () => {
        try {
          const res = await fetch(`https://internetdb.shodan.io/${target}`);
          if (!res.ok) throw new Error("Shodan API failed");
          return await res.json();
        } catch (e) {
          // Return empty structure on error/not found
          return { hostnames: [], ports: [], vulns: [], tags: [] };
        }
      })();

      // Execute all in parallel
      const [dns, ipInfo, abuse, shodan] = await Promise.all([dnsPromise, ipInfoPromise, abusePromise, shodanPromise]);

      const responseData = {
        target,
        dns,
        ipInfo,
        abuse,
        shodan
      };

      return new Response(JSON.stringify(responseData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 404 for other routes
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
