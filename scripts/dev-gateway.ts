// Simple HTTP gateway that mirrors the Caddyfile routing:
//   ?XTransformPort=<port> → localhost:<port>
//   everything else        → localhost:3000
//
// Used for dev/E2E when the Caddy gateway isn't running. Stays alive as
// long as the parent process is alive; uses http-proxy-less Node stdlib.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 8081;
const APP_PORT = 3000;

function proxyTo(req: IncomingMessage, res: ServerResponse, port: number) {
  const headers = { ...req.headers };
  // Strip content-length so the upstream can recompute it.
  delete headers["content-length"];
  delete headers["host"];
  headers["host"] = `localhost:${port}`;
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port,
    method: req.method,
    path: req.url,
    headers,
  }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 200, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Bad gateway", detail: (err as Error).message }));
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${GATEWAY_PORT}`);
  const xtp = url.searchParams.get("XTransformPort");
  const targetPort = xtp ? Number(xtp) : APP_PORT;
  if (!Number.isFinite(targetPort)) {
    res.writeHead(400);
    res.end("Invalid XTransformPort");
    return;
  }
  proxyTo(req, res, targetPort);
});

server.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(`[gateway] listening on :${GATEWAY_PORT}`);
});

process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT", () => { server.close(); process.exit(0); });
