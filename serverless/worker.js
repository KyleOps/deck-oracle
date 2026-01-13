export default {
  async fetch(request, env) {
    // Allowed origins for CORS
    const allowedOrigins = [
      "https://kyleops.github.io",
      "http://localhost:3000", // For local development
      "http://127.0.0.1:3000"  // Alternative localhost
    ];

    const origin = request.headers.get("Origin");
    const isOriginAllowed = allowedOrigins.some(allowed => origin?.startsWith(allowed));

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      if (!isOriginAllowed) {
        return new Response("Origin not allowed", { status: 403 });
      }

      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Validate origin for all requests
    if (!isOriginAllowed) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("Missing 'url' query parameter", { status: 400 });
    }

    // Only allow Moxfield and Archidekt URLs for security
    const allowedDomains = ["moxfield.com", "archidekt.com"];
    const isAllowed = allowedDomains.some(domain => targetUrl.includes(domain));

    if (!isAllowed) {
      return new Response("Only Moxfield and Archidekt URLs are allowed", { status: 403 });
    }

    try {
      // The User Agent is stored in the environment variable MOXFIELD_USER_AGENT
      // This keeps it secure and out of the client-side code.
      const userAgent = env.MOXFIELD_USER_AGENT || "Moxfield-Import-Bot/1.0";

      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "application/json"
        }
      });

      const data = await response.text();

      return new Response(data, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin, // Allow only the requesting origin
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      });
    }
  },
};
