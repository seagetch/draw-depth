# Depth Draw Viewer

Minimal 3D viewer for `data/Midori-color.jpg` and `data/Midori-depth.jpg`.

## Run

You can open `index.html` directly with `file://`.

If the browser blocks local file access, start a static server in this directory instead:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/` in a browser.

## Notes

- `depth == 0` is treated as invalid and no triangles are created there
- The fragment shader also uses `discard` for invalid depth samples
- Higher `Mesh detail` gives a denser surface but costs more GPU time
