const http = require("http");
const fs = require("fs");
const path = require("path");

const MAX_BODY    = 1 * 1024 * 1024; // 1 MB — reject oversized ingest payloads
const VALID_LEVELS    = new Set(['info', 'warn', 'error']);
const VALID_SOURCES   = new Set(['server', 'client']);
const VALID_CATEGORIES = new Set(['network', 'auth', 'compiler', 'system', 'warning']);

function startServer(port = parseInt(process.env.DEVLENS_PORT, 10) || 4321) {
  let activeClients = [];

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

    if (req.url === "/api/ingest" && req.method === "POST") {
      let buf = "";
      let bodySize = 0;
      req.on("data", chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          req.destroy();
          res.writeHead(413).end("Payload too large");
          return;
        }
        buf += chunk;
      });
      req.on("end", () => {
        let payload;
        try { payload = JSON.parse(buf); } catch { res.writeHead(400).end("Invalid JSON"); return; }

        // Schema validation — reject malformed or missing required fields
        if (
          typeof payload !== 'object' || payload === null ||
          typeof payload.msg !== 'string' ||
          !VALID_LEVELS.has(payload.level) ||
          !VALID_SOURCES.has(payload.source)
        ) {
          res.writeHead(422).end("Invalid payload schema");
          return;
        }

        // Clamp unknown categories to 'system'
        if (!VALID_CATEGORIES.has(payload.category)) payload.category = 'system';

        // Broadcast to SSE clients; purge any that have closed since last write
        const serialised = `data: ${JSON.stringify(payload)}\n\n`;
        const alive = [];
        for (const client of activeClients) {
          try {
            client.write(serialised);
            alive.push(client);
          } catch (_) { /* client gone — drop it */ }
        }
        activeClients = alive;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
      return;
    }

    if (req.url === "/stream" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      activeClients.push(res);
      req.on("close", () => (activeClients = activeClients.filter(c => c !== res)));
      return;
    }

    if (req.url === "/" && req.method === "GET") {
      try {
        const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        res.writeHead(500).end("Error loading dashboard UI");
      }
      return;
    }

    if (req.url === "/styles.css" && req.method === "GET") {
      try {
        const css = fs.readFileSync(path.join(__dirname, "public/styles.css"), "utf8");
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(css);
      } catch (err) {
        res.writeHead(500).end("Error loading dashboard CSS");
      }
      return;
    }

    if (req.url === "/app.js" && req.method === "GET") {
      try {
        const js = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(js);
      } catch (err) {
        res.writeHead(500).end("Error loading dashboard JS");
      }
      return;
    }

    res.writeHead(404).end();
  });

  server.on("error", (err) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`[DevLens] Port ${port} is already in use. Set DEVLENS_PORT to use a different port.\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });

  server.listen(port, () => {
    process.stdout.write(`\x1b[34m🔍 [DevLens] Dashboard → http://localhost:${port}\x1b[0m\n`);
  });

  return server;
}

module.exports = { startServer };
