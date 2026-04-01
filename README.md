# Depth Draw Viewer

Minimal 3D viewer for:

- `data/Midori-color.jpg` + `data/Midori-depth.jpg`
- `data/Midori-color.psd` + `data/Midori-color_depth.psd`

## Run

Install dependencies once:

```powershell
npm install
```

Then start a static server in this directory:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/` in a browser.

## Notes

- `depth == 0` is treated as invalid and no triangles are created there
- The fragment shader also uses `discard` for invalid depth samples
- Higher `Mesh detail` gives a denser surface but costs more GPU time
- `Source format = PSD pair` loads layered color/depth PSDs and renders each PSD layer as its own depth-displaced surface
