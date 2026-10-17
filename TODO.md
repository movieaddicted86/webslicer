# WebSlicer – ToDo / Roadmap

Priorität nach Nutzen im Druckalltag und PrusaSlicer-Parität. Die Engine (PrusaSlicer-CLI) verarbeitet
alle Daten, sobald sie im 3MF stehen; es fehlen jeweils Editor im Browser und 3MF-Writer-Erweiterung.

## Erledigt
- [x] Modifier-Volumen, Support-Verstärker/-Blocker, Negativ-Volumen, Zusatzteile (Box/Zylinder/Kugel/Slab/Mesh), 3MF-Roundtrip
- [x] Vorschaubilder (PNG/JPG/QOI) im G-Code in Filamentfarbe; TLS-Schalter für Druckhosts
- [x] Dateibibliothek `/library` (Browsen, Öffnen, Upload, Projekt-3MF und G-Code ablegen), Autosave mit Wiederherstellung
- [x] Auf Fläche legen (Taste F); Schnelleinstellungen Supports/Infill/Brim im Plater

## Jetzt (in dieser Reihenfolge)
1. [x] **Docker-Image verkleinern, Stufe 1**: GUI-Ressourcen entfernt (1,36 GB → 1,2 GB)
2. [x] **Undo/Redo** im Plater (Strg+Z / Strg+Y, Toolbar)
3. [x] **Herstellerbett**: `bed_model` (STL) und `bed_texture` (SVG/PNG) des Druckerprofils im Viewer
4. [x] **Support- und Seam-Painting**: Pinsel (Kugel, Radius), Enforcer/Blocker/Radierer, Speicherung als
       `slic3rpe:custom_supports` / `slic3rpe:custom_seam` je Dreieck, Mesh-Unterteilung für feine Pinsel,
       Import aus PrusaSlicer-3MF (unterteilte Dreiecke werden auf den Mehrheitszustand reduziert)
   - [ ] Pinsel-Varianten: Smart Fill / Bucket Fill, Höhenbereich, nur Flächen zur Kamera
5. [ ] **Variable Layerhöhe**: Profil-Editor (Glättung, adaptiv), `layer_height_profile` im 3MF
6. [ ] **Druckerstatus** nach dem Upload (Fortschritt, Temperaturen, Dateiliste) – braucht Hardware-Test
7. [ ] **MMU-Painting** (`slic3rpe:mmu_segmentation`), Extruder je Dreieck

## Später
- [ ] Cut-Tool (Schnittebene, Mesh-Boolean, optional Verbinder)
- [ ] Text-/SVG-Embossing
- [ ] Hollowing-Editor für SLA (Ablauflöcher); Hollowing-Parameter sind bereits Einstellungen
- [ ] Docker-Image Stufe 2: eigener PrusaSlicer-Build ohne GUI (`-DSLIC3R_GUI=OFF`) → ≈ 300–400 MB
- [ ] Thumbnails auch in `.bgcode` und als `Metadata/thumbnail.png` im 3MF
- [ ] Druckhosts: PrusaLink Digest-Login, Prusa Connect, Duet/RepRapFirmware, Repetier, Obico; mDNS-Hinweis
- [ ] Bibliothek: Vorschaubilder für STL/3MF, Suche, Sortierung, Mehrfachauswahl
- [ ] Objekt-Instanzen statt Duplikate; Volumen per Drag & Drop zwischen Objekten; Volumen-Sichtbarkeit
- [ ] Mehrsprachige Oberfläche (Deutsch)

## Braucht dich (Robert)
- [ ] Upload an einen echten Drucker testen (PrusaLink / Klipper / OctoPrint) – Typ und Adresse nennen
- [ ] Proxmox-Helper auf einem echten PVE-Host testen; Repo-URL-Platzhalter in Skripten/README ersetzen
