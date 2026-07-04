# Depth Draw REST/CLI API

The API is exposed through `scripts/serve.js` and executed by the active browser app.

Start the server:

```sh
npm run dev
```

Open the viewer once in a browser:

```text
http://127.0.0.1:8000/
```

Then call the CLI:

```sh
npm run depth-api -- list-models
npm run depth-api -- load-model --id "psd:Midori-20260621-color:Midori-20260621-color-psd-depth.png"
npm run depth-api -- composite --out composite.json
npm run depth-api -- layer-color --index 0 --out layer-0-color.png
npm run depth-api -- layer-depth --index 0 --out layer-0-depth.png
npm run depth-api -- layer-mesh --index 0 --out layer-0-mesh.json
npm run depth-api -- meshes --out meshes.json
npm run depth-api -- set-layer --index 0 --offset 12 --scale 1.2
npm run depth-api -- set-global --value 1.3
npm run depth-api -- set-contour --enabled true
npm run depth-api -- set-smooth --enabled true
npm run depth-api -- save-depth-psd --filename exported-depth.psd
npm run depth-api -- capture-view --yaw 30 --pitch 10 --zoom 1.2 --out view.png
npm run depth-api -- set-layer-depth-image --index 0 --file layer-0-depth.png
npm run depth-api -- layer-mesh --index 0 --out layer-0-mesh.json
npm run depth-api -- set-layer-depth-mesh --index 0 --file layer-0-mesh.json
```

The CLI calls `POST /api/app-api`. The browser app polls `/api/app-api/next`, executes the command against `globalThis.__depthDrawApi`, and posts the result to `/api/app-api/result`.

The viewer page must be open because PSD decoding, canvas extraction, Three.js geometry, and PSD export currently use browser runtime APIs.

`layer-color` returns the composed color layer image as a PNG. The metadata includes the layer's local size and document offset.

`set-layer-depth-image` expects a grayscale image. It is resized to the target layer size and written back to the layer's internal depth pixels.

`set-layer-depth-mesh` expects the same JSON shape returned by `layer-mesh`: `positions`, `uvs`, and optional `indices`. It samples vertex `z` through UV coordinates and writes the resulting depth bytes back to the target layer.
