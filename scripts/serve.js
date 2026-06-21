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

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const psdExtension = ".psd";

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendJson(response, statusCode, value) {
  send(response, statusCode, JSON.stringify(value), "application/json; charset=utf-8");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function asPublicPath(filePath) {
  return `/${path.relative(rootDir, filePath).split(path.sep).join("/")}`;
}

function basenameWithoutExt(fileName) {
  return fileName.slice(0, -path.extname(fileName).length);
}

function createModelLabel(stem, formatLabel) {
  const label = stem
    .replace(/-color\b/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return `${label} (${formatLabel})`;
}

function findDepthPair(stem, ext, byName, colorName) {
  const candidates = [
    `${stem}-depth${ext}`,
    `${stem}_depth${ext}`,
    `${stem.replace(/-color-/i, "-depth-")}${ext}`,
    `${stem.replace(/-color$/i, "-depth")}${ext}`,
  ].filter((candidate) => (
    candidate.toLowerCase() !== colorName.toLowerCase() &&
    candidate.toLowerCase() !== `${stem}${ext}`.toLowerCase()
  ));
  return candidates
    .map((candidate) => byName.get(candidate.toLowerCase()))
    .find(Boolean);
}

function findDepthImagePair(stem, byName, colorName) {
  for (const ext of imageExtensions) {
    const psdDepthName = byName.get(`${stem}-psd-depth${ext}`.toLowerCase());
    if (psdDepthName) {
      return psdDepthName;
    }
  }

  for (const ext of imageExtensions) {
    const depthName = findDepthPair(stem, ext, byName, colorName);
    if (depthName) {
      return depthName;
    }
  }
  return null;
}

function getExistingNames(candidateNames, byName, excludedName = "") {
  const seen = new Set();
  const excludedLower = excludedName.toLowerCase();
  return candidateNames
    .map((candidate) => byName.get(candidate.toLowerCase()))
    .filter((name) => {
      if (!name || name.toLowerCase() === excludedLower || seen.has(name.toLowerCase())) {
        return false;
      }
      seen.add(name.toLowerCase());
      return true;
    });
}

function createPsdDepthCandidates(stem, colorName, imageByName, psdByName) {
  const candidates = [];

  for (const depthName of getExistingNames([
    `${stem}-psd-depth${psdExtension}`,
  ], psdByName, colorName)) {
    candidates.push({
      kind: "psd",
      fileName: depthName,
      formatLabel: "PSD",
      priority: 0,
    });
  }

  for (const ext of imageExtensions) {
    const imageCandidateNames = [
      `${stem}-psd-depth${ext}`,
      `${stem}-depth${ext}`,
      `${stem}_depth${ext}`,
      `${stem.replace(/-color-/i, "-depth-")}${ext}`,
      `${stem.replace(/-color$/i, "-depth")}${ext}`,
    ].filter((candidate) => candidate.toLowerCase() !== `${stem}${ext}`.toLowerCase());
    for (const depthName of getExistingNames(imageCandidateNames, imageByName, colorName)) {
      candidates.push({
        kind: "image",
        fileName: depthName,
        formatLabel: path.extname(depthName).slice(1).toUpperCase(),
        priority: depthName.toLowerCase() === `${stem}-psd-depth${ext}`.toLowerCase() ? 1 : 2,
      });
    }
  }

  for (const depthName of getExistingNames([
    `${stem}-depth${psdExtension}`,
    `${stem}_depth${psdExtension}`,
    `${stem.replace(/-color-/i, "-depth-")}${psdExtension}`,
    `${stem.replace(/-color$/i, "-depth")}${psdExtension}`,
  ], psdByName, colorName)) {
    candidates.push({
      kind: "psd",
      fileName: depthName,
      formatLabel: "PSD",
      priority: 3,
    });
  }

  return candidates;
}

function createModelCatalog() {
  const dataDir = path.join(rootDir, "data");
  const files = fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith("~"));

  const imageFiles = files.filter((name) => imageExtensions.has(path.extname(name).toLowerCase()));
  const byName = new Map(imageFiles.map((name) => [name.toLowerCase(), name]));
  const psdFiles = files.filter((name) => path.extname(name).toLowerCase() === psdExtension);
  const psdByName = new Map(psdFiles.map((name) => [name.toLowerCase(), name]));

  const rasterModels = imageFiles
    .filter((name) => !/depth|segment|flatten/i.test(basenameWithoutExt(name)))
    .map((colorName) => {
      const ext = path.extname(colorName);
      const stem = basenameWithoutExt(colorName);
      const depthName = findDepthPair(stem, ext, byName, colorName);

      if (!depthName) {
        return null;
      }

      return {
        id: `raster:${stem}`,
        type: "raster",
        label: createModelLabel(stem, path.extname(colorName).slice(1).toUpperCase()),
        colorUrl: asPublicPath(path.join(dataDir, colorName)),
        depthUrl: asPublicPath(path.join(dataDir, depthName)),
      };
    })
    .filter(Boolean);

  const psdModels = psdFiles
    .filter((name) => !/depth/i.test(basenameWithoutExt(name)))
    .flatMap((colorName) => {
      const stem = basenameWithoutExt(colorName);
      return createPsdDepthCandidates(stem, colorName, byName, psdByName)
        .map((candidate) => {
          return {
            id: `psd:${stem}:${candidate.fileName}`,
            type: "psd",
            label: `${createModelLabel(stem, "PSD")} + ${candidate.fileName}`,
            priority: candidate.priority,
            colorUrl: asPublicPath(path.join(dataDir, colorName)),
            depthPsdUrl: candidate.kind === "psd" ? asPublicPath(path.join(dataDir, candidate.fileName)) : null,
            stableDepthUrl: candidate.kind === "image" ? asPublicPath(path.join(dataDir, candidate.fileName)) : null,
          };
        });
    })
    .filter(Boolean);

  return [...rasterModels, ...psdModels]
    .sort((a, b) => {
      const labelOrder = a.label.localeCompare(b.label, "ja");
      if (a.type !== "psd" || b.type !== "psd") {
        return labelOrder;
      }
      const colorOrder = (a.colorUrl || "").localeCompare(b.colorUrl || "", "ja");
      if (colorOrder !== 0) {
        return colorOrder;
      }
      return (a.priority ?? 99) - (b.priority ?? 99) || labelOrder;
    })
    .map(({ priority, ...model }) => model);
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
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  if (requestUrl.pathname === "/api/models") {
    try {
      sendJson(response, 200, { models: createModelCatalog() });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/save-depth-psd") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    readRequestBody(request)
      .then((body) => {
        const rawFilename = requestUrl.searchParams.get("filename") || "depth.psd";
        const filename = path.basename(rawFilename);
        if (!/^[^<>:"/\\|?*\x00-\x1f]+\.psd$/i.test(filename)) {
          throw new Error("Invalid PSD filename.");
        }
        if (!body.length) {
          throw new Error("Empty PSD payload.");
        }

        const dataDir = path.join(rootDir, "data");
        const outputPath = path.resolve(dataDir, filename);
        if (!outputPath.startsWith(dataDir + path.sep)) {
          throw new Error("Invalid output path.");
        }
        fs.writeFileSync(outputPath, body);
        sendJson(response, 200, {
          ok: true,
          filename,
          path: asPublicPath(outputPath),
          bytes: body.length,
        });
      })
      .catch((error) => {
        sendJson(response, 500, { error: error.message });
      });
    return;
  }

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
