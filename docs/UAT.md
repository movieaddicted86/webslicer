# WebSlicer – User Acceptance Test (UAT)

Version: 1.0.0-rc.2 · Engine: PrusaSlicer 2.9.6 · Stand: 2026-10-17

Ziel: Bestätigen, dass WebSlicer den Alltags-Workflow eines PrusaSlicer-Anwenders im Browser abdeckt.
Jeder Testfall hat Schritte und ein erwartetes Ergebnis. Bitte Abweichungen mit Testfall-Nummer,
Browser und Screenshot notieren.

## Vorbereitung

1. Start per Docker: `docker compose up -d` → http://&lt;host&gt;:8080 (oder Proxmox-LXC, siehe README).
2. Beim ersten Start liegt im Ordner **Library → samples** ein Satz Testmodelle:
   `calibration_cube_20mm.stl`, `bridge_table.stl` (Überhang), `cylinder_with_cube.stl`, `stepped_pyramid.stl`.
3. Browser: aktueller Chrome, Edge, Firefox oder Safari; WebGL muss aktiv sein.
4. Testdrucker: ein vorhandener Drucker im Netz (PrusaLink, OctoPrint oder Klipper/Moonraker) für UAT-11.

## Testfälle

| Nr | Bereich | Schritte | Erwartet |
|---|---|---|---|
| UAT-01 | Erststart | Seite öffnen | Dialog „Printers“ erscheint, Hersteller und Modelle werden gelistet (Thumbnails sichtbar). |
| UAT-02 | Drucker anlegen | Prusa Research → Original Prusa MK4S → HF0.4 anhaken → Apply | Drucker ist ausgewählt; Druck- und Filamentprofil werden automatisch auf Prusa-Standards gesetzt (0.20mm SPEED, Prusament PLA). Bett zeigt das MK4S-Bettmodell mit Textur. |
| UAT-03 | Eigener Drucker | Printers → Custom printer → Bettgröße 220×220, Düse 0.4 → Create | Neuer Drucker erscheint unter „User presets“, Bett im Viewer entspricht 220×220. |
| UAT-04 | Modell laden | Library → samples → `calibration_cube_20mm.stl` → Open | Würfel liegt mittig auf dem Bett, Objektliste zeigt ihn, Upload-Status „uploaded“. Alternativ Datei per Drag & Drop auf die 3D-Ansicht. |
| UAT-05 | Manipulation | Objekt wählen; Rotation X = 45° eingeben; Taste F, Fläche anklicken; Skalierung 150 %; Arrange (A) | Nach Rotation sinkt das Objekt nicht unter das Bett; nach „Auf Fläche legen“ liegt die Fläche plan; Bounding Box zeigt 30 mm; Objekt bleibt im Bett. Strg+Z macht jeden Schritt rückgängig. |
| UAT-06 | Slicen und Vorschau | Slice now | Fortschrittsbalken, danach Vorschau mit farbigen Toolpaths, Layer-Slider funktioniert, Statistik zeigt Zeit, Filament, Layer. |
| UAT-07 | Einstellungen | Print Settings → Infill → Fill density 40 %; Modus Expert → mehr Optionen; Suchfeld „seam“; Modus Simple im Plater | Preset zeigt „(modified)“, orangener Punkt am Tab; Expert zeigt mehr Optionen als Simple; Suche findet „Seam position“; im Plater blendet Simple die Objektliste samt Modifiern/Painting/Höhenbereichen aus (wie PrusaSlicer), Advanced/Expert zeigen sie. |
| UAT-08 | Preset speichern | 💾 neben dem Druckprofil → Name „UAT Test“ → Save; Preset wechseln und zurück; 🗑 löschen | Preset erscheint unter „User presets“, Werte bleiben erhalten, Löschen fällt auf das Standardprofil des Druckers zurück. |
| UAT-09 | Supports/Painting | `bridge_table.stl` laden; Supports = „For support enforcers only“; Slice → keine Stützen; Taste L, Unterseite der Platte bemalen, Done; Slice | Zweiter Slice enthält grünes Stützmaterial nur unter der bemalten Fläche. Clear all entfernt die Bemalung. |
| UAT-10 | Modifier | Würfel laden; „+“ in der Objektzeile → Modifier → box; Modifier-Settings → Fill density 100 %; Slice | Modifier als gelbe Box sichtbar; Filamentverbrauch steigt gegenüber UAT-06; Blocker/Negativ-Volumen analog anlegbar. |
| UAT-11 | Höhenbereiche | `stepped_pyramid.stl`; „+ Range“ 0–6 mm, Layer h. 0.1; Slice | Slab im Viewer; Layerzahl steigt, die ersten Layer sind 0,1 mm hoch (Vorschau-Slider zeigt Z 0.1, 0.2, …). |
| UAT-12 | Projekt | Export → Save project to library → Name; Delete all; Library → Projekt öffnen | Objekte, Positionen, Modifier/Bemalung und Einstellungen sind wiederhergestellt; Presets zeigen keine ungewollten „(modified)“. |
| UAT-13 | Autosave | Objekt laden, 10 s warten, Browser-Tab neu laden | Hinweis „Unsaved session found“ → Restore stellt den Plater wieder her. |
| UAT-14 | G-Code-Export | Vorschau → Export G-code | Datei lädt herunter; Kopf enthält `; thumbnail` Blöcke (PNG/QOI); in PrusaSlicer-G-Code-Viewer oder auf dem Drucker mit Vorschaubild. |
| UAT-15 | Druckerupload | Printers → Add printer (Typ, IP, API-Key) → Test connection; Vorschau → Send to printer | „Connected“ beim Test; Datei erscheint auf dem Drucker (PrusaLink: USB-Liste, Klipper: Dateiliste, OctoPrint: Files); optional Druckstart. |
| UAT-16 | 3MF aus PrusaSlicer | Ein 3MF-Projekt aus dem Desktop-PrusaSlicer (mit Modifier und Bemalung) per Import laden | Objekte, Volumen, Bemalung und Profile werden übernommen; Slice-Ergebnis entspricht dem Desktop (Zeit/Filament ± wenige %). |
| UAT-17 | Mehrbenutzer | Zweiter Browser/Gerät parallel öffnen und slicen | Beide Jobs laufen (MAX_JOBS), keine Vermischung der Objekte; Autosave ist je Browser getrennt. |
| UAT-18 | Proxmox | `proxmox/webslicer-lxc.sh` auf dem PVE-Host ausführen | LXC wird angelegt, Dienst läuft, URL wird ausgegeben; `systemctl status webslicer` ist active. |

## Bekannte Einschränkungen (Stand rc.1)

- Keine Cut-Funktion, kein Text-Embossing, kein stufenloses Layerhöhen-Profil (nur Höhenbereiche).
- Bemalung arbeitet pro Dreieck (Mesh wird dafür fein unterteilt); Smart Fill / Bucket Fill fehlen.
- Thumbnails werden nur in ASCII-G-Code eingebettet, nicht in `.bgcode`.
- Der Druckerupload wurde gegen die API-Dokumentation implementiert und ist mit echter Hardware noch
  nicht verifiziert (UAT-15 ist daher besonders wichtig).
- Die Oberfläche ist englisch.

## Abnahmekriterium

UAT-01 bis UAT-14 ohne Blocker; UAT-15 mit mindestens einem Druckertyp erfolgreich.
