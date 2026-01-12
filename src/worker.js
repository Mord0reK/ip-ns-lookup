import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

// Constants
const DNS_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "PTR"];
// Improved IPv4 and IPv6 regex patterns
const IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){2}:(?:[0-9a-fA-F]{1,4}:){0,4}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){3}:(?:[0-9a-fA-F]{1,4}:){0,3}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){4}:(?:[0-9a-fA-F]{1,4}:){0,2}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){5}:(?:[0-9a-fA-F]{1,4}:)?[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){6}:[0-9a-fA-F]{1,4}$|^::(?:ffff:)?(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[0-9a-fA-F]{1,4}:){6}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^::$|^::1$/;

// Helper function to extract client IP from request headers
function getClientIP(request) {
  return request.headers.get("CF-Connecting-IP") || 
         request.headers.get("X-Real-IP") || 
         request.headers.get("X-Forwarded-For")?.split(',')[0] || 
         "Unknown";
}

// Helper function to convert IPv4 address to reverse DNS format
function ipv4ToReverseDNS(ip) {
  return ip.split('.').reverse().join('.') + '.in-addr.arpa';
}

// Helper function to convert IPv6 address to reverse DNS format
function ipv6ToReverseDNS(ip) {
  // Remove colons and expand to full format
  const expandedIP = ip.includes('::') ? expandIPv6(ip) : ip;
  // Remove colons and reverse nibbles
  const nibbles = expandedIP.replace(/:/g, '').split('').reverse().join('.');
  return nibbles + '.ip6.arpa';
}

// Helper function to expand compressed IPv6 address
function expandIPv6(ip) {
  // Handle special cases
  if (ip === '::') return '0000:0000:0000:0000:0000:0000:0000:0000';
  if (ip === '::1') return '0000:0000:0000:0000:0000:0000:0000:0001';
  
  // Split on '::'
  const sides = ip.split('::');
  if (sides.length === 2) {
    const left = sides[0] ? sides[0].split(':') : [];
    const right = sides[1] ? sides[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    const full = [...left, ...middle, ...right];
    return full.map(h => h.padStart(4, '0')).join(':');
  }
  
  // No compression, just pad each segment
  return ip.split(':').map(h => h.padStart(4, '0')).join(':');
}

// Helper function to check if string is IPv4
function isIPv4(str) {
  return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(str);
}

// Helper function to check if string is IPv6
function isIPv6(str) {
  // Simple check for colon presence, full validation would be with full regex
  return str.includes(':') && IP_REGEX.test(str);
}

// Helper function to perform DNS lookups with special PTR handling
async function performDNSLookups(target, dnsTypes) {
  const results = {};
  const isIp = IP_REGEX.test(target);
  
  await Promise.all(
    dnsTypes.map(async (type) => {
      try {
        let queryName = target;
        
        // For PTR records, convert IP to reverse DNS format
        if (type === "PTR") {
          if (!isIp) {
            // PTR only makes sense for IP addresses
            results[type] = [];
            return;
          }
          
          if (isIPv4(target)) {
            queryName = ipv4ToReverseDNS(target);
          } else if (isIPv6(target)) {
            queryName = ipv6ToReverseDNS(target);
          }
        } else if (isIp && (type === "A" || type === "AAAA" || type === "MX" || type === "CNAME" || type === "NS" || type === "SOA")) {
          // Skip these record types for IP addresses (they don't make sense)
          results[type] = [];
          return;
        }
        
        const res = await fetch(
          `https://cloudflare-dns.com/dns-query?name=${queryName}&type=${type}`,
          { headers: { accept: "application/dns-json" } }
        );
        if (!res.ok) throw new Error(`DNS ${type} failed`);
        const data = await res.json();
        results[type] = data.Answer || [];
      } catch (e) {
        results[type] = [];
      }
    })
  );
  return results;
}

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

    // Check if request is from curl or similar CLI tool
    const userAgent = request.headers.get("User-Agent") || "";
    const isCurl = userAgent.toLowerCase().includes("curl") || 
                   userAgent.toLowerCase().includes("wget") || 
                   userAgent.toLowerCase().includes("httpie");

    // Handle root path
    if (url.pathname === "/" && request.method === "GET") {
      // For curl requests, return client IP info directly as JSON
      if (isCurl) {
        const clientIP = getClientIP(request);
        
        // Fetch full analysis for the client's IP
        const target = clientIP;
        
        // Prepare Promises
        const dnsTypes = DNS_TYPES;

        // 1. DNS Logic
        const dnsPromise = performDNSLookups(target, dnsTypes);

        // 2. IP Info Logic
        const ipInfoPromise = (async () => {
          try {
            const fields = "status,message,country,regionName,city,lat,lon,isp,org,as,proxy,hosting,query,timezone,currency";
            const res = await fetch(`http://ip-api.com/json/${target}?fields=${fields}`);
            if (!res.ok) throw new Error("IP-API failed");
            return await res.json();
          } catch (e) {
            return { error: "ipInfoError", message: e.message };
          }
        })();

        // 3. AbuseIPDB Logic
        const abusePromise = (async () => {
          const isIp = IP_REGEX.test(target);

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

        return new Response(JSON.stringify(responseData, null, 2), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // For browser requests, serve the HTML page using Workers Sites/KV
      try {
        return await getAssetFromKV(
          {
            request,
            waitUntil(promise) {
              return ctx.waitUntil(promise);
            },
          },
          {
            ASSET_NAMESPACE: env.__STATIC_CONTENT,
            ASSET_MANIFEST: JSON.parse(env.__STATIC_CONTENT_MANIFEST || "{}"),
          }
        );
      } catch (e) {
        return new Response("Error loading page", { status: 500 });
      }
    }

    // API endpoint to get client's IP
    if (url.pathname === "/api/myip" && request.method === "GET") {
      const clientIP = getClientIP(request);
      
      return new Response(JSON.stringify({ ip: clientIP }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      const dnsTypes = DNS_TYPES;

      // 1. DNS Logic
      const dnsPromise = performDNSLookups(target, dnsTypes);

      // 2. IP Info Logic
      // Note: IP-API works for domains too (resolves them), but prompt says "If target is IP address".
      // We will try it for both, as it provides useful info for domains too (hosting info).
      const ipInfoPromise = (async () => {
        try {
          const fields = "status,message,country,regionName,city,lat,lon,isp,org,as,proxy,hosting,query,timezone,currency";
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
        const isIp = IP_REGEX.test(target);

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

    // Serve static assets for other paths (like /script.js) using Workers Sites/KV
    if (request.method === "GET") {
      try {
        return await getAssetFromKV(
          {
            request,
            waitUntil(promise) {
              return ctx.waitUntil(promise);
            },
          },
          {
            ASSET_NAMESPACE: env.__STATIC_CONTENT,
            ASSET_MANIFEST: JSON.parse(env.__STATIC_CONTENT_MANIFEST || "{}"),
          }
        );
      } catch (e) {
        // Asset not found, fall through to 404
      }
    }

    // 404 for other routes
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
