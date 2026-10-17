# Funktionsabgleich PrusaSlicer 2.9 ↔ WebSlicer

Stand: 2026-10-17 (WebSlicer 1.0.0-rc.2, Engine PrusaSlicer 2.9.6)

Legende: ✅ vorhanden · 🟡 teilweise · ❌ fehlt · ➖ im Web nicht sinnvoll / nicht geplant
Priorität: **P1** für Version 1.0 nötig · **P2** wichtig danach · **P3** Komfort · **P4** später oder nie

## 1. Dateien und Projekte

| Funktion in PrusaSlicer | WebSlicer | Prio | Anmerkung |
|---|---|---|---|
| Import STL / OBJ / 3MF / AMF | ✅ | – | Drag & Drop, Import-Button, Bibliothek |
| Import STEP | ❌ | P2 | Die CLI kann STEP lesen (`--export-stl`), Server kann konvertieren |
| Import SVG (Emboss) | ❌ | P3 | zusammen mit Text-Embossing |
| Projekt speichern / laden (3MF mit allen Daten) | ✅ | – | Bibliothek + Autosave; PrusaSlicer-Projekte werden gelesen |
| Zuletzt verwendete Projekte | 🟡 | P3 | Bibliothek zeigt Datum; keine „Recent“-Liste |
| Import Config aus G-Code / 3MF / INI | 🟡 | P2 | 3MF ja; G-Code-Header und INI-Bundle fehlen |
| Export Config / Config-Bundle | 🟡 | P2 | Export INI vorhanden; Bundle-Export aller Presets fehlt |
| Export Plate als STL/OBJ (inkl. Supports) | ❌ | P3 | CLI `--export-stl` kann das |
| Export G-Code / Send to printer | ✅ | – | |
| Export Toolpaths als OBJ | ❌ | P4 | |
| Binary G-Code (.bgcode) | 🟡 | P2 | Erzeugen ja; Konvertierung ASCII↔Binary und Thumbnails in bgcode fehlen |
| G-Code-Viewer (externe G-Code-Datei laden) | ❌ | P2 | Parser vorhanden, nur Laden aus Datei/Bibliothek fehlt |
| Printables / URL-Protokoll | ➖ | P4 | |

## 2. Plater und Objekte

| Funktion | WebSlicer | Prio | Anmerkung |
|---|---|---|---|
| Objektliste mit Volumen, Einstellungen, Bereichen | ✅ | – | Baum Objekt → Volumen; Bereiche im Panel |
| Instanzen (Anzahl setzen, Bett füllen, Instanzliste) | ❌ | **P1** | derzeit nur Duplikate (eigene Objekte) |
| Verschieben / Drehen / Skalieren (Gizmo + Zahlen) | ✅ | – | |
| Spiegeln (X/Y/Z) | ❌ | **P1** | trivial, fehlt im Panel |
| Welt-/Lokal-Koordinaten im Gizmo | 🟡 | P3 | nur Welt |
| Auf Fläche legen | ✅ | – | |
| Arrange (mit Einstellungen: Abstand, Rotation, Ausrichtung) | 🟡 | P2 | einfaches Shelf-Packing ohne Einstellungen; „Arrange selection“ fehlt |
| Auswahl: Rechteckauswahl, Alle, Invertieren | 🟡 | P3 | Klick/Strg+Klick/Strg+A; Rechteckauswahl fehlt |
| Undo / Redo mit Verlauf | 🟡 | P3 | Undo/Redo ja; Verlaufsliste fehlt |
| Kopieren / Einfügen | ❌ | P3 | Duplizieren vorhanden |
| Umbenennen, Objekt-Info (Größe, Volumen, Dreiecke, Fehler) | 🟡 | P2 | Dreiecke ja; Volumen, Manifold-Prüfung, Umbenennen fehlen |
| Reload from disk / Replace with STL | ❌ | P3 | über Bibliothek lösbar |
| Split to objects / Split to parts | ❌ | **P1** | Zerlegen in zusammenhängende Shells |
| Merge (Objekte zusammenführen) | ❌ | P2 | |
| Einheiten umrechnen (Zoll / Meter) | ❌ | P3 | Skalierung ×25,4 als Helfer |
| Simplify model (Dreiecksreduktion) | ❌ | P3 | three.js SimplifyModifier |
| Repair (Netfabb / Microsoft) | ➖ | P4 | nur Windows-Desktop |
| Extruder je Objekt / Volumen | ✅ | – | |
| Pro-Objekt-Einstellungen | ✅ | – | |
| Modifier (Box/Zylinder/Kugel/Slab/Mesh) | ✅ | – | |
| Shape Gallery (mitgelieferte Formen) | ❌ | P3 | `resources/shapes` wieder ins Image aufnehmen |
| Support-Verstärker / Blocker (Volumen) | ✅ | – | |
| Negativ-Volumen | ✅ | – | |
| Höhenbereiche (Layer-Range-Modifier) | ✅ | – | |
| Variable Layerhöhe (Profil, Glättung, adaptiv) | 🟡 | P2 | nur Bereiche; stufenloses Profil fehlt |
| Cut (Schnittebene, Verbinder) | ❌ | P2 | |
| Measure (Messwerkzeug) | ❌ | P3 | |
| Text-Embossing | ❌ | P3 | |
| SVG-Embossing | ❌ | P3 | |
| Paint-on Supports | ✅ | – | Kugelpinsel; Smart Fill / Bucket Fill fehlen (P3) |
| Seam Painting | ✅ | – | |
| MMU-Painting | ✅ | – | |
| Pinsel-Optionen (Höhenbereich, Rückseite ignorieren, Füllwinkel) | ❌ | P3 | |
| Bettform-Editor, Herstellerbett mit Textur | ✅ | – | |
| Mehrere Betten (2.9) | ❌ | P3 | |
| Sequentieller Druck: Gantry-Darstellung | ❌ | P4 | Einstellung vorhanden |
| Sichtbarkeit (Objekt aus-/einblenden) | ✅ | – | Checkbox = druckbar |

## 3. Presets und Einstellungen

| Funktion | WebSlicer | Prio | Anmerkung |
|---|---|---|---|
| System-Presets aller Hersteller, Kompatibilität, Alias | ✅ | – | |
| User-Presets speichern / löschen | ✅ | – | |
| Preset umbenennen | ❌ | P2 | |
| Detach from system preset | ❌ | P3 | |
| Unsaved-Changes-Dialog (Transfer / Save / Discard) | 🟡 | **P1** | nur Discard-Bestätigung; Transfer der Änderungen auf das neue Preset fehlt |
| Compare Presets | ❌ | P3 | |
| Modus Simple / Advanced / Expert | ✅ | – | Settings-Tabs und Plater |
| Suche in Einstellungen (Strg+F) | 🟡 | P3 | Suchfeld je Tab; globale Suche fehlt |
| Tooltips mit Beschreibung und Optionsname | ✅ | – | |
| Einstellungen pro Extruder (Printer-Tab, Extruder-Anzahl) | ✅ | – | |
| Filament-Overrides | ✅ | – | |
| Dependencies / Compatible printers | ✅ | – | als Text; Mehrfachauswahl-Dialog fehlt (P4) |
| Konfigurationsassistent (Wizard) | 🟡 | P2 | Drucker-Dialog + Custom Printer; Filamentauswahl je Hersteller und Temperatur-Assistent fehlen |
| Profil-Updates online (Vendor-Bundles aktualisieren) | ❌ | P2 | Bundles aus dem AppImage; Update aus PrusaSlicer-settings-Repo wäre serverseitig möglich |
| Configuration Snapshots | ❌ | P4 | Daten liegen als Dateien im Volume |
| Physische Drucker mit Preset-Verknüpfung | 🟡 | P3 | Feld vorhanden, nicht ausgewertet |
| Preferences (Einheiten, Kamera, Verhalten) | 🟡 | P3 | nur Modus und Anzeigeoptionen |
| Sprache (Deutsch u. a.) | ❌ | P2 | Oberfläche englisch |
| Tastaturkürzel-Übersicht | 🟡 | P3 | im About-Dialog, unvollständig |

## 4. Slicing und Vorschau

| Funktion | WebSlicer | Prio | Anmerkung |
|---|---|---|---|
| Slicen (FFF) mit vollständiger Engine, Fortschritt | ✅ | – | |
| Slicen (SLA) | 🟡 | P3 | Export `.sl1` funktioniert; keine Vorschau, kein Support-Point-Editor |
| Vorschau nach Feature-Typ, Legende, Layer-Slider | ✅ | – | |
| Vorschau-Farbschemata: Höhe, Breite, Geschwindigkeit, Lüfter, Temperatur, Volumenstrom, Layerzeit, Extruder, Farbdruck | ❌ | **P1** | Parser liefert die Daten noch nicht (Breite/Höhe/Geschwindigkeit aus `;WIDTH`, `;HEIGHT`, F) |
| Horizontaler Slider (Bewegungen innerhalb eines Layers) | ❌ | P2 | |
| Anzeigeoptionen: Travel, Retractions, Seams, Wipe, Tool changes, Color changes, Shells, Tool-Marker | 🟡 | P2 | nur Travel |
| Legende mit Zeit/Länge je Feature | 🟡 | P2 | Länge ja; Zeit je Feature fehlt |
| Farbwechsel / Pause / Custom G-Code am Layer (M600 über Slider) | ❌ | **P1** | sehr häufig genutzt; `colorprint_heights`/Custom-G-Code-per-Layer im 3MF |
| Sliced Info (Zeit, Filament, Kosten, Layer) | ✅ | – | Stealth-Zeit fehlt (P3) |
| G-Code-Textfenster an aktueller Position | ❌ | P3 | |
| Wipe-Tower-Darstellung und Purging-Volumes-Dialog | 🟡 | P3 | Wipe-Tower wird geslict; Dialog fehlt |
| Thumbnails im G-Code | ✅ | – | |
| Warnungen aus dem Slicer (Validierung, Hinweise) | 🟡 | P2 | Fehler ja; Warnungen/Hints werden nicht angezeigt |

## 5. Drucker und Druckhosts

| Funktion | WebSlicer | Prio | Anmerkung |
|---|---|---|---|
| PrusaLink, OctoPrint, Klipper/Moonraker | ✅ | – | Hardware-Test offen |
| Prusa Connect, Duet, Repetier, FlashAir, AstroBox, MKS, Obico | ❌ | P3 | |
| Upload-Warteschlange / Druckerstatus | ❌ | P2 | |
| Firmware-Flasher | ➖ | P4 | |

## 6. Oberfläche und Betrieb

| Funktion | WebSlicer | Prio | Anmerkung |
|---|---|---|---|
| Kamera: Perspektive/Ortho, Ansichten (Iso, Oben, Vorn …), Zoom auf Auswahl | 🟡 | P2 | nur Reset-View |
| Sidebar einklappen | ❌ | P3 | |
| Benachrichtigungen / Hinweise | 🟡 | P3 | Toasts |
| Mehrbenutzer, Bibliothek auf NAS, Autosave | ✅ | – | WebSlicer-Spezifika |
| Docker / Proxmox-Installation | ✅ | – | |

## Zusammenfassung

Abgedeckt sind der komplette Slicing-Kern, Profile, Pro-Objekt-Einstellungen, Volumen, Painting,
Höhenbereiche, Bibliothek und Druckhosts. Die größten verbleibenden Lücken liegen in der **Vorschau**
(Farbschemata, Farbwechsel am Layer, Anzeigeoptionen) und bei **Objektwerkzeugen** (Instanzen,
Spiegeln, Split, Cut, Measure, Emboss) sowie beim **Unsaved-Changes-Transfer** und bei **STEP-Import**.
