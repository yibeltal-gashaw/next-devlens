const http = require("http");
const fs = require("fs");
const path = require("path");

function startServer(port = 4321) {
  let activeClients = [];

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

    if (req.url === "/api/ingest" && req.method === "POST") {
      let buf = "";
      req.on("data", c => (buf += c));
      req.on("end", () => {
        try {
          const payload = JSON.parse(buf);
          activeClients.forEach(c => c.write(`data: ${JSON.stringify(payload)}\n\n`));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ received: true }));
        } catch { res.writeHead(400).end(); }
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

  server.listen(port, () => {
    console.log("\x1b[34m%s\x1b[0m", `🔍 [DevLens] Dashboard → http://localhost:${port}`);
  });

  return server;
}

module.exports = { startServer };
