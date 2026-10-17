# WebSlicer – ToDo / Roadmap

Grundlage: [docs/Funktionsabgleich.md](docs/Funktionsabgleich.md) (PrusaSlicer 2.9 ↔ WebSlicer).
Priorität nach Nutzungshäufigkeit im Druckalltag und PrusaSlicer-Parität.

## P1 – für Version 1.0 (in dieser Reihenfolge)
1. [ ] **Farbwechsel / Pause / Custom G-Code am Layer** über den Vorschau-Slider (M600, Farbdruck-Vorschau)
2. [ ] **Vorschau-Farbschemata**: Höhe, Breite, Geschwindigkeit, Lüfter, Temperatur, Volumenstrom, Layerzeit,
       Extruder; Legende mit Wertebereich (Parser um `;WIDTH`, `;HEIGHT`, F, Fan, Temp erweitern)
3. [ ] **Instanzen**: Anzahl setzen, Bett füllen, Instanzen in der Objektliste (gleiche Geometrie, eigene Transform)
4. [ ] **Spiegeln** X/Y/Z im Manipulationspanel
5. [ ] **Split to objects / parts** (zusammenhängende Shells trennen)
6. [ ] **Unsaved-Changes-Dialog** beim Presetwechsel: Transfer / Save / Discard

## P2 – wichtig danach
- [ ] Vorschau: horizontaler Slider, Anzeigeoptionen (Retractions, Seams, Wipe, Tool-/Farbwechsel, Shells), Zeit je Feature, Slicer-Warnungen
- [ ] STEP-Import über die CLI (`--export-stl`)
- [ ] Merge von Objekten; Objekt-Info (Volumen, Manifold-Prüfung), Umbenennen
- [ ] Arrange mit Einstellungen (Abstand, Rotation) und „Arrange selection“
- [ ] Cut-Tool (Schnittebene; Verbinder später)
- [ ] Stufenloses Layerhöhen-Profil (Glättung, adaptiv)
- [ ] Preset umbenennen; Config-Bundle Import/Export; Config aus G-Code importieren
- [ ] Vendor-Profile online aktualisieren (PrusaSlicer-settings)
- [ ] Konfigurationsassistent erweitern (Filamente je Hersteller, Temperaturen)
- [ ] Kamera: Ansichten (Iso/Oben/Vorn/…), Ortho, Zoom auf Auswahl
- [ ] Druckerstatus / Upload-Warteschlange (braucht Hardware-Test)
- [ ] Deutsche Oberfläche (i18n)
- [ ] G-Code-Viewer für Dateien aus der Bibliothek; bgcode-Konvertierung und Thumbnails in bgcode

## P3 – Komfort
- [ ] Measure-Tool, Text-/SVG-Embossing, Shape Gallery (resources/shapes zurück ins Image)
- [ ] Pinsel-Optionen (Smart Fill, Bucket Fill, Höhenbereich), Welt-/Lokal-Gizmo, Rechteckauswahl, Kopieren/Einfügen
- [ ] Compare Presets, Detach from system, globale Suche, Undo-Verlauf, Preferences
- [ ] Simplify model, Einheiten umrechnen, Reload from disk, Recent projects
- [ ] Mehrere Betten, Purging-Volumes-Dialog, Stealth-Zeit, G-Code-Textfenster, Sidebar einklappen
- [ ] Weitere Druckhosts (Prusa Connect, Duet, Repetier, Obico), physische Drucker mit Preset-Verknüpfung
- [ ] SLA: Support-Point-Editor, Hollowing-Editor, SLA-Vorschau
- [ ] Docker-Image Stufe 2: eigener PrusaSlicer-Build ohne GUI (≈ 300–400 MB)
- [ ] Bibliothek: Vorschaubilder, Suche, Sortierung

## P4 – später oder nicht geplant
- Netfabb/Microsoft-Repair, Firmware-Flasher, Printables-Integration, Toolpaths als OBJ, Gantry-Darstellung, Configuration Snapshots

## Erledigt
- [x] Slicing-Kern, Profile, Settings-Tabs (Modi), Schnelleinstellungen, Vorschau nach Feature-Typ, Thumbnails
- [x] Volumen (Modifier, Support-Verstärker/Blocker, Negativ, Teile), Höhenbereiche, Support-/Seam-/MMU-Painting
- [x] Auf Fläche legen, Undo/Redo, Herstellerbett, Bibliothek, Autosave, Projekt speichern/laden
- [x] Druckhosts PrusaLink/OctoPrint/Moonraker mit TLS-Option, Docker, Proxmox, UAT 1.0.0-rc.2

## Braucht dich (Robert)
- [ ] Upload an einen echten Drucker testen (PrusaLink / Klipper / OctoPrint) – Typ und Adresse nennen
- [ ] Proxmox-Helper auf einem echten PVE-Host testen
- [ ] MCP-Integration gemäß docs/MCP-Konzept.md freigeben
