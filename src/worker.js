import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

// Constants
const DNS_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "PTR"];
// Comprehensive IPv4 and IPv6 regex pattern
// Validates: standard IPv4, all IPv6 formats (full, compressed, loopback, IPv4-mapped, etc.)
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
  return str.includes(':') && !isIPv4(str) && IP_REGEX.test(str);
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
        if (!res.ok) {
          results[type] = [];
          return;
        }
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
        const target = getClientIP(request);

        // 1. DNS Logic
        const dnsPromise = performDNSLookups(target, DNS_TYPES);

        // 2. ipapi.is Logic
        const ipapiPromise = (async () => {
          try {
            const res = await fetch(`https://api.ipapi.is/?q=${target}`);
            if (!res.ok) return { error: "ipapiError", message: "ipapi.is failed" };
            return await res.json();
          } catch (e) {
            return { error: "ipapiError", message: e.message };
          }
        })();

        // Execute parallel
        const [dns, ipapi] = await Promise.all([dnsPromise, ipapiPromise]);

        return new Response(JSON.stringify({ target, dns, ipapi }, null, 2), {
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

    // API endpoint to get ASN info
    if (url.pathname === "/api/asn" && request.method === "GET") {
      const asn = url.searchParams.get("asn");
      if (!asn) {
        return new Response(JSON.stringify({ error: "asn required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const asnNumber = asn.replace(/\D/g, "");

      try {
        const res = await fetch(`https://api.ipapi.is/?q=AS${asnNumber}`);
        if (!res.ok) {
           return new Response(JSON.stringify({ error: "asnInfoError", message: "ipapi.is API failed" }), {
             status: 500,
             headers: { ...corsHeaders, "Content-Type": "application/json" },
           });
        }
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "asnInfoError", message: e.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

      // Basic validation
      const isIpOrDomain = /^[a-zA-Z0-9.:-]+$/.test(target);
      if (!isIpOrDomain) {
        return new Response(JSON.stringify({ error: "Invalid target format" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isIp = IP_REGEX.test(target);
      let dns, ipapi;

      if (isIp) {
        // For IP, we can do both in parallel
        [dns, ipapi] = await Promise.all([
          performDNSLookups(target, DNS_TYPES),
          fetch(`https://api.ipapi.is/?q=${target}`)
            .then(res => res.json())
            .catch(e => ({ error: "ipapiError", message: e.message }))
        ]);
      } else {
        // For domain, we need DNS first to find the IP
        dns = await performDNSLookups(target, DNS_TYPES);

        // Find first A or AAAA record
        const resolvedIp = dns.A?.[0]?.data || dns.AAAA?.[0]?.data;
        // If we found an IP, use it for ipapi.is. Otherwise, fallback to domain (though it won't give geo)
        const ipapiTarget = resolvedIp || target;

        ipapi = await fetch(`https://api.ipapi.is/?q=${ipapiTarget}`)
          .then(res => res.json())
          .catch(e => ({ error: "ipapiError", message: e.message }));
      }

      return new Response(JSON.stringify({ target, dns, ipapi }), {
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
