export default {
  async fetch(request, env) {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("Missing 'url' query parameter", { status: 400 });
    }

    // Only allow Moxfield URLs for security
    if (!targetUrl.includes("moxfield.com")) {
      return new Response("Only Moxfield URLs are allowed", { status: 403 });
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
          "Access-Control-Allow-Origin": "*", // Allow your GitHub Pages site to access this
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
