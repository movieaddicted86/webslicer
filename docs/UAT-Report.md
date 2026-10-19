# UAT report – WebSlicer 1.0.0-rc.1 → rc.2

Executed: 2026-10-17 · Tester: Claude (automated in the built-in browser against the final Docker
image `webslicer:latest`, PrusaSlicer 2.9.6) · Printer profile: Original Prusa MK4S HF0.4

| No | Result | Observation |
|---|---|---|
| UAT-01 | ✅ passed | "Printers" dialog on first start, 35 vendors, thumbnails visible. Finding F-2 (see below). |
| UAT-02 | ✅ passed | MK4S HF0.4 selected → 0.20mm SPEED @MK4S HF0.4, Prusament PLA @MK4S HF0.4, bed 250×210 with MK4S model and texture. Finding F-3. |
| UAT-03 | ✅ passed | "UAT Custom 220" under user presets, bed 220×220, nozzle 0.4. Finding F-1. |
| UAT-04 | ✅ passed | `calibration_cube_20mm.stl` loaded from Library → samples, position 125/105/0, "uploaded". |
| UAT-05 | ✅ passed | Rotation X 45° → Z position 7.07 (not below the bed); place on face → box 20×20×20; scale 150 % → 30 mm; arrange keeps the object on the bed; three undos restore the state before the steps. Finding F-4. |
| UAT-06 | ✅ passed | Slice 15 min 54 s, 4.0 g, 142 layers; preview with legend (external perimeter, perimeter, solid/internal infill); top slider to layer 76 → Z 15.00 mm. |
| UAT-07 | ✅ passed | Fill density 40 % → option orange, tab dot, preset "(modified)"; infill page: Simple 4, Advanced 10, Expert 19 options; search "seam" finds Seam position, Staggered inner seams (and Spiral vase via its tooltip). |
| UAT-08 | ✅ passed | "UAT Test" under user presets, after switching away and back 40 % remains; deleting falls back to 0.20mm SPEED @MK4S HF0.4. |
| UAT-09 | ✅ passed | `bridge_table.stl`, enforcers only: 0 support sections; underside painted (2074 triangles): 50 support sections; Clear all removes the paint. |
| UAT-10 | ✅ passed | Modifier box with 100 % infill: 7.38 g instead of 3.78 g. |
| UAT-11 | ✅ passed | `stepped_pyramid.stl`, range 0–6 mm at 0.1 mm: 179 layers, Z sequence 0.2 / 0.3 / 0.4 … 5.9 / 6.0 / 6.2 / 6.4. |
| UAT-12 | ✅ passed | Project with support enforcer and height range saved, delete all, reopened: object, position, volume, range and profiles identical; the only "modified" is the deliberately changed support setting. |
| UAT-13 | ✅ passed | Autosave "saved", after reload notice "Unsaved session found", Restore brings the object including its modifier back. |
| UAT-14 | ✅ passed | G-code download contains 16×16/QOI, 313×173/QOI, 480×240/QOI, 380×285/PNG. |
| UAT-15 | ✅ passed (2026-10-19, Robert) | Klipper/Moonraker printer "V-Minion dark" at http://192.168.1.102: test connection "Connected", G-code upload and print start work. PrusaLink and OctoPrint not tested with hardware. |
| UAT-16 | ✅ passed (limited) | A 3MF written by the PrusaSlicer CLI with a modifier (100 % infill) loads with object, modifier and its settings. A desktop project with paint was not available. |
| UAT-17 | ✅ passed | Two parallel slicing clients (API) complete concurrently (MAX_JOBS = 2). Separate browser autosaves not checked (single browser). |
| UAT-18 | ✅ passed (2026-10-19, Robert) | Helper script on PVE host `pve-hp-1`: CT 112 created, WebSlicer running at http://192.168.1.144:8080. Finding F-6 (see below). |

## Findings

| No | Severity | Description | Status |
|---|---|---|---|
| F-1 | medium | After creating a custom printer the incompatible Prusa print profile stayed selected "(incompatible)" instead of falling back to "- default FFF -". | fixed (fallback to the default profile when no compatible vendor profile exists) |
| F-2 | low | Model names containing "&&" (e.g. "Prusa CORE One && CORE One+") were shown literally; PrusaSlicer shows "&". | fixed |
| F-3 | low | After switching to a printer with a different bed size the camera was not refitted, the larger bed was cut off. | fixed (camera follows the bed shape) |
| F-4 | low | Keyboard shortcuts (F, L, P, A …) do not work while an input field has focus (e.g. after Tab out of a number field). Matches PrusaSlicer behaviour. | documented, no change |
| F-5 | low | In windows narrower than ≈ 900 px the top bar overflowed and the whole page scrolled horizontally. | fixed (top bar wraps) |
| F-6 | low | Proxmox helper: noisy raw output (template download, SSH key generation, npm/vite), perl/apt locale warnings in the container, root password printed at the end, little interactivity compared to the community-scripts helpers. | fixed: whiptail Default/Advanced flow, storage picker, step progress with a log file, locale fix, no password output, `update` command in the container |

## Conclusion

Acceptance criterion met: UAT-01 to UAT-14 without blockers, UAT-15 successful with a Klipper printer,
UAT-18 successful on a real Proxmox host.
