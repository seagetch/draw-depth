const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "8000", 10);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".psd", "application/octet-stream"],
  [".map", "application/json; charset=utf-8"],
]);

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function resolveRequestPath(urlString) {
  const requestUrl = new URL(urlString, `http://${host}:${port}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedPath = path.resolve(rootDir, relativePath);
  if (!resolvedPath.startsWith(rootDir)) {
    return null;
  }
  return resolvedPath;
}

const server = http.createServer((request, response) => {
  const resolvedPath = resolveRequestPath(request.url || "/");
  if (!resolvedPath) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.stat(resolvedPath, (statError, stats) => {
    if (statError) {
      send(response, 404, "Not found");
      return;
    }

    const filePath = stats.isDirectory() ? path.join(resolvedPath, "index.html") : resolvedPath;
    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        send(response, 404, "Not found");
        return;
      }
      const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
      send(response, 200, data, contentType);
    });
  });
});

server.listen(port, host, () => {
  console.log(`Depth Draw Viewer: http://${host}:${port}/`);
});
