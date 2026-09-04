const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const PORT = 5173;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const values of Object.values(interfaces)) {
    for (const item of values || []) {
      if (item.family === "IPv4" && !item.internal) ips.push(item.address);
    }
  }
  return ips;
}

function resolveSafePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const relative = cleanPath === "/" ? "/index.html" : cleanPath;
  const resolved = path.resolve(ROOT, `.${relative}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = resolveSafePath(req.url || "/");
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const stat = await fs.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const ext = path.extname(finalPath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(finalPath);
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch (error) {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`手机端已启动: http://localhost:${PORT}`);
  for (const ip of getLocalIps()) {
    console.log(`同一Wi-Fi手机访问: http://${ip}:${PORT}`);
  }
});
