# UAT-Protokoll – WebSlicer 1.0.0-rc.1

Durchgeführt: 2026-10-17 · Tester: Claude (automatisiert im eingebauten Browser gegen das finale
Docker-Image `webslicer:latest`, PrusaSlicer 2.9.6) · Druckerprofil: Original Prusa MK4S HF0.4

| Nr | Ergebnis | Beobachtung |
|---|---|---|
| UAT-01 | ✅ bestanden | Dialog „Printers“ beim Erststart, 35 Hersteller, Thumbnails sichtbar. Befund B-2 (siehe unten). |
| UAT-02 | ✅ bestanden | MK4S HF0.4 gewählt → 0.20mm SPEED @MK4S HF0.4, Prusament PLA @MK4S HF0.4, Bett 250×210 mit MK4S-Modell und Textur. Befund B-3. |
| UAT-03 | ✅ bestanden | „UAT Custom 220“ unter User presets, Bett 220×220, Düse 0.4. Befund B-1. |
| UAT-04 | ✅ bestanden | `calibration_cube_20mm.stl` aus Library → samples geladen, Position 125/105/0, „uploaded“. |
| UAT-05 | ✅ bestanden | Rotation X 45° → Z-Position 7,07 (nicht unter dem Bett); Auf Fläche legen → Box 20×20×20; Skalierung 150 % → 30 mm; Arrange hält Objekt im Bett; drei Undo stellen den Zustand vor den Schritten wieder her. Befund B-4. |
| UAT-06 | ✅ bestanden | Slice 15 min 54 s, 4,0 g, 142 Layer; Vorschau mit Legende (External perimeter, Perimeter, Solid/Internal infill); Top-Slider auf Layer 76 → Z 15,00 mm. |
| UAT-07 | ✅ bestanden | Fill density 40 % → Option orange, Tab-Punkt, Preset „(modified)“; Infill-Seite: Simple 4, Advanced 10, Expert 19 Optionen; Suche „seam“ findet Seam position, Staggered inner seams (und Spiral vase über den Tooltip). |
| UAT-08 | ✅ bestanden | „UAT Test“ unter User presets, nach Wechsel hin und zurück bleibt 40 %; Löschen fällt auf 0.20mm SPEED @MK4S HF0.4 zurück. |
| UAT-09 | ✅ bestanden | `bridge_table.stl`, Enforcers only: 0 Support-Abschnitte; Unterseite bemalt (2074 Dreiecke): 50 Support-Abschnitte; Clear all entfernt die Bemalung. |
| UAT-10 | ✅ bestanden | Modifier-Box mit 100 % Infill: 7,38 g statt 3,78 g. |
| UAT-11 | ✅ bestanden | `stepped_pyramid.stl`, Bereich 0–6 mm bei 0,1 mm: 179 Layer, Z-Folge 0,2 / 0,3 / 0,4 … 5,9 / 6,0 / 6,2 / 6,4. |
| UAT-12 | ✅ bestanden | Projekt mit Support-Verstärker und Höhenbereich gespeichert, Delete all, wieder geöffnet: Objekt, Position, Volumen, Bereich und Profile identisch; einziges „modified“ ist die vorher bewusst geänderte Support-Einstellung. |
| UAT-13 | ✅ bestanden | Autosave „saved“, nach Reload Hinweis „Unsaved session found“, Restore stellt Objekt samt Modifier wieder her. |
| UAT-14 | ✅ bestanden | G-Code-Download enthält 16×16/QOI, 313×173/QOI, 480×240/QOI, 380×285/PNG. |
| UAT-15 | ⏸ offen | Kein Drucker im Testnetz. **Mit Hardware nachzuholen.** |
| UAT-16 | ✅ bestanden (eingeschränkt) | Ein von der PrusaSlicer-CLI geschriebenes 3MF mit Modifier (100 % Infill) wird mit Objekt, Modifier und dessen Einstellungen geladen. Ein Desktop-Projekt mit Bemalung stand nicht zur Verfügung. |
| UAT-17 | ✅ bestanden | Zwei parallele Slicing-Clients (API) laufen gleichzeitig durch (MAX_JOBS = 2). Getrennte Browser-Autosaves nicht geprüft (ein Browser). |
| UAT-18 | ⏸ offen | Kein Proxmox-Host im Test. |

## Befunde

| Nr | Schwere | Beschreibung | Status |
|---|---|---|---|
| B-1 | mittel | Nach Anlegen eines Custom-Druckers blieb das inkompatible Prusa-Druckprofil „(incompatible)“ gewählt statt auf „- default FFF -“ zu fallen. | behoben (Fallback auf Standardprofil, wenn kein kompatibles Vendor-Profil existiert) |
| B-2 | gering | Modellnamen mit „&&“ (z. B. „Prusa CORE One && CORE One+“) wurden wörtlich angezeigt; PrusaSlicer zeigt „&“. | behoben |
| B-3 | gering | Nach einem Druckerwechsel mit anderer Bettgröße wurde die Kamera nicht neu ausgerichtet, das größere Bett war abgeschnitten. | behoben (Kamera folgt der Bettform) |
| B-4 | gering | Tastenkürzel (F, L, P, A …) wirken nicht, solange ein Eingabefeld den Fokus hat (z. B. nach Tab aus einem Zahlenfeld). Entspricht PrusaSlicer-Verhalten. | dokumentiert, keine Änderung |
| B-5 | gering | Bei Fenstern unter ≈ 900 px Breite lief die Kopfzeile über und die ganze Seite scrollte horizontal. | behoben (Kopfzeile bricht um) |

## Fazit

Abnahmekriterium für UAT-01 bis UAT-14 erfüllt, keine Blocker. UAT-15 (Druckerupload) und UAT-18
(Proxmox) benötigen Hardware beziehungsweise einen PVE-Host und stehen für den Tester aus.
