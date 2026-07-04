#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/depth-draw-cli.js list-models
  node scripts/depth-draw-cli.js load-model --id <model-id>
  node scripts/depth-draw-cli.js load-sources --color color.png|color.psd --depth depth.png|depth.psd [--label name]
  node scripts/depth-draw-cli.js composite [--out composite.json]
  node scripts/depth-draw-cli.js layer-color --index <n> --out layer-color.png
  node scripts/depth-draw-cli.js layer-depth --index <n> --out layer.png
  node scripts/depth-draw-cli.js layer-mesh --index <n> [--out mesh.json]
  node scripts/depth-draw-cli.js meshes [--out meshes.json]
  node scripts/depth-draw-cli.js set-layer --index <n> [--offset <value>] [--scale <value>]
  node scripts/depth-draw-cli.js set-global --value <scale>
  node scripts/depth-draw-cli.js set-contour --enabled true|false
  node scripts/depth-draw-cli.js set-smooth --enabled true|false
  node scripts/depth-draw-cli.js run-alpha-depth-gap-fill
  node scripts/depth-draw-cli.js save-depth-psd [--filename depth.psd]
  node scripts/depth-draw-cli.js capture-view --yaw 0 --pitch 0 --out view.png
  node scripts/depth-draw-cli.js set-layer-depth-image --index <n> --file layer-depth.png
  node scripts/depth-draw-cli.js set-layer-depth-mesh --index <n> --file layer-mesh.json
  node scripts/depth-draw-cli.js set-layer-display-mesh --index <n> --file layer-mesh.json
  node scripts/depth-draw-cli.js clear-layer-display-mesh --index <n>
  node scripts/depth-draw-cli.js clear-display-meshes

Options:
  --server <url>    Default: http://127.0.0.1:8000
  --timeout <ms>    Default: 60000
`);
}

function parseBoolean(value) {
  if (value === true || value === "true" || value === "1" || value === "on") {
    return true;
  }
  if (value === false || value === "false" || value === "0" || value === "off") {
    return false;
  }
  throw new Error(`Invalid boolean: ${value}`);
}

function writeJsonOrStdout(value, outPath) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), text);
    return;
  }
  process.stdout.write(text);
}

function writeDataUrl(dataUrl, outPath) {
  if (!outPath) {
    throw new Error("--out is required for data URL output.");
  }
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) {
    throw new Error("API did not return a base64 data URL.");
  }
  fs.writeFileSync(path.resolve(outPath), Buffer.from(match[2], "base64"));
}

function readFileAsDataUrl(filePath) {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : (ext === ".webp" ? "image/webp" : (ext === ".psd" ? "application/octet-stream" : "image/png"));
  return `data:${mime};base64,${fs.readFileSync(resolved).toString("base64")}`;
}

async function callApi(serverUrl, action, args, timeoutMs) {
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/app-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, args, timeoutMs }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload.result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const serverUrl = args.server || "http://127.0.0.1:8000";
  const timeoutMs = Number(args.timeout || 60000);

  if (!command || args.help) {
    printUsage();
    return;
  }

  let result;
  switch (command) {
    case "list-models":
      result = await callApi(serverUrl, "listModels", {}, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "load-model":
      result = await callApi(serverUrl, "loadModel", { id: args.id || args._[1] }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "load-sources": {
      if (!args.color || !args.depth) {
        throw new Error("--color and --depth are required.");
      }
      const colorPath = path.resolve(args.color);
      const depthPath = path.resolve(args.depth);
      result = await callApi(serverUrl, "loadSources", {
        colorDataUrl: readFileAsDataUrl(colorPath),
        depthDataUrl: readFileAsDataUrl(depthPath),
        colorName: path.basename(colorPath),
        depthName: path.basename(depthPath),
        label: args.label,
        exportName: args.exportName,
      }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    }
    case "composite":
      result = await callApi(serverUrl, "getCompositeSource", {}, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "layer-color":
      result = await callApi(serverUrl, "getLayerColorImage", { index: Number(args.index ?? args._[1]) }, timeoutMs);
      if (args.out) {
        writeDataUrl(result.dataUrl, args.out);
        delete result.dataUrl;
      }
      writeJsonOrStdout(result, args.metaOut);
      break;
    case "layer-depth":
      result = await callApi(serverUrl, "getLayerDepthImage", { index: Number(args.index ?? args._[1]) }, timeoutMs);
      if (args.out) {
        writeDataUrl(result.dataUrl, args.out);
        delete result.dataUrl;
      }
      writeJsonOrStdout(result, args.metaOut);
      break;
    case "layer-mesh":
      result = await callApi(serverUrl, "getLayerMesh", { index: Number(args.index ?? args._[1]) }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "meshes":
      result = await callApi(serverUrl, "getAllLayerMeshes", {}, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "set-layer":
      result = await callApi(serverUrl, "setLayerDepthTransform", {
        index: Number(args.index ?? args._[1]),
        offset: args.offset == null ? undefined : Number(args.offset),
        scale: args.scale == null ? undefined : Number(args.scale),
      }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "set-global":
      result = await callApi(serverUrl, "setGlobalDepthScale", { value: Number(args.value ?? args._[1]) }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "set-contour":
      result = await callApi(serverUrl, "setContourRepair", { enabled: parseBoolean(args.enabled ?? args._[1]) }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "set-smooth":
      result = await callApi(serverUrl, "setSurfaceSmooth", { enabled: parseBoolean(args.enabled ?? args._[1]) }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "run-alpha-depth-gap-fill":
      result = await callApi(serverUrl, "runAlphaDepthGapFill", {}, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "save-depth-psd":
      result = await callApi(serverUrl, "saveDepthPsd", { filename: args.filename }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "capture-view":
      result = await callApi(serverUrl, "captureView", {
        yaw: args.yaw == null ? undefined : Number(args.yaw),
        pitch: args.pitch == null ? undefined : Number(args.pitch),
        distance: args.distance == null ? undefined : Number(args.distance),
        zoom: args.zoom == null ? undefined : Number(args.zoom),
        width: args.width == null ? undefined : Number(args.width),
        height: args.height == null ? undefined : Number(args.height),
        keepCamera: !!args.keepCamera,
      }, timeoutMs);
      if (args.out) {
        writeDataUrl(result.dataUrl, args.out);
        delete result.dataUrl;
      }
      writeJsonOrStdout(result, args.metaOut);
      break;
    case "set-layer-depth-image":
      result = await callApi(serverUrl, "setLayerDepthImage", {
        index: Number(args.index ?? args._[1]),
        dataUrl: args.dataUrl || readFileAsDataUrl(args.file),
      }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "set-layer-depth-mesh": {
      const mesh = args.file
        ? JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8"))
        : JSON.parse(args.mesh || "{}");
      result = await callApi(serverUrl, "setLayerDepthMesh", {
        index: Number(args.index ?? mesh.layerIndex ?? args._[1]),
        mesh,
      }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    }
    case "set-layer-display-mesh": {
      const mesh = args.file
        ? JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8"))
        : JSON.parse(args.mesh || "{}");
      result = await callApi(serverUrl, "setLayerDisplayMesh", {
        index: Number(args.index ?? mesh.layerIndex ?? args._[1]),
        mesh,
      }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    }
    case "clear-layer-display-mesh":
      result = await callApi(serverUrl, "clearLayerDisplayMesh", {
        index: Number(args.index ?? args._[1]),
      }, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    case "clear-display-meshes":
      result = await callApi(serverUrl, "clearAllDisplayMeshes", {}, timeoutMs);
      writeJsonOrStdout(result, args.out);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
