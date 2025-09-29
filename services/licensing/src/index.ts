export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // TODO: route other endpoints
    // e.g. if path.startsWith("/billing") → billing handler
    // else if path.startsWith("/license") → license handler
    // else if path.startsWith("/trial") → trial handler
    // else return 404

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
