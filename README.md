# Depth Draw Viewer

Minimal 3D viewer for:

- `data/Midori-color.jpg` + `data/Midori-depth.jpg`
- `data/Midori-color.psd` + `data/Midori-color_depth.psd`

## Setup

Install dependencies once:

```powershell
npm install
```

## Run

Start the local viewer server:

```powershell
npm start
```

Then open:

```text
http://127.0.0.1:8000/
```

You can change the bind address and port with environment variables:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "8123"
npm start
```

`npm run dev` is an alias of `npm start`.

## Notes

- `depth == 0` is treated as invalid and no triangles are created there
- The fragment shader also uses `discard` for invalid depth samples
- Higher `Mesh detail` gives a denser surface but costs more GPU time
- `Source format = PSD pair` loads layered color/depth PSDs and renders each PSD layer as its own depth-displaced surface
