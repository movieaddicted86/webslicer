# WebSlicer – ToDo / Roadmap

Die PrusaSlicer-Engine verarbeitet alle unten genannten Daten bereits, sobald sie im 3MF stehen.
Es fehlen jeweils der Editor im Browser und die Erweiterung des 3MF-Writers im Server.

## 1. Modifier-Volumen, Support-Verstärker und -Blocker ✅ (umgesetzt)
- [x] 3MF-Writer: mehrere Volumen pro Objekt mit `volume_type` (`ModelPart`, `ParameterModifier`,
      `SupportEnforcer`, `SupportBlocker`, `NegativeVolume`) in `Metadata/Slic3r_PE_model.config`
- [x] Frontend: Hilfskörper (Box, Zylinder, Kugel, Slab, geladenes Mesh) als Kind-Volumen eines Objekts
      platzieren, transformieren, mit eigenem Config-Override (gleicher Dialog wie Pro-Objekt-Settings)
- [x] Objektliste als Baum (Objekt → Volumen), Farben je Volumentyp
- [x] 3MF-Import: vorhandene Volumen aus Projekten übernehmen
- [ ] Volumen per Drag & Drop zwischen Objekten verschieben; Volumen-Sichtbarkeit umschalten

## 2. Support- und Seam-Painting (mittlerer Aufwand)
- [ ] Pinsel-Werkzeug im Viewer (Raycast, Radius, Kugel/Triangle-Modus), Enforcer/Blocker bzw.
      Enforcer/Blocker für Naht
- [ ] Speicherung als Dreiecks-Attribute `slic3rpe:custom_supports` / `slic3rpe:custom_seam`
      (PrusaSlicer-Kodierung der Unterteilung je Dreieck) im 3MF-Mesh
- [ ] MMU-Painting (`slic3rpe:mmu_segmentation`) analog

## 3. Variable Layerhöhe (mittlerer Aufwand)
- [ ] Profil-Editor (Höhe über Z, Glättung, Adaptiv aus Oberflächenqualität)
- [ ] Speicherung als `layer_height_profile` im Objekt-Config des 3MF

## 4. Cut (mittlerer Aufwand, mit Verbindern hoch)
- [ ] Schnittebene im Viewer, Mesh-Boolean (z. B. three-bvh-csg), Teile als neue Objekte
- [ ] Optional: Verbinder (Dübel/Stecker)

## 5. Hollowing-Editor für SLA (gering)
- [ ] Ablauflöcher interaktiv setzen (`slic3rpe:drain_holes`); Hollowing-Parameter selbst sind
      bereits als Einstellungen vorhanden

## 6. Text-/SVG-Embossing (hoher Aufwand)
- [ ] Textgeometrie (Font-Rendering), Platzierung auf Oberflächen, als Volumen (Part/Negativ)

## Weitere kleinere Punkte
- [ ] Undo/Redo im Plater
- [ ] Bed-Modell und -Textur des Druckerherstellers im Viewer anzeigen (API liefert die Assets bereits)
- [ ] Objekt-Instanzen (statt Duplikate) wie in PrusaSlicer
- [ ] Projekt im Browser (localStorage) oder serverseitig speichern/laden
- [ ] Mehrsprachige Oberfläche (Deutsch)
- [ ] Proxmox-Helper auf einem echten PVE-Host testen; Repo-URL-Platzhalter ersetzen
- [ ] Upload an PrusaLink/OctoPrint/Moonraker mit echten Geräten testen

## Druckhosts (Senden an Drucker im Netzwerk)
Vorhanden: PrusaLink (API-Key, v1-API + Legacy-Fallback), OctoPrint, Klipper/Moonraker, Upload mit Druckstart.
- [x] Vorschaubilder (Thumbnails) im G-Code: Browser rendert PNG/JPG/QOI in den Größen aus dem
      Druckerprofil (`thumbnails`), Server fügt sie nach der Kopfzeile ein (nicht für .bgcode)
- [x] TLS-Schalter „Zertifikat nicht prüfen“ für Hosts mit selbstsigniertem HTTPS
- [ ] Thumbnails auch in binärem G-Code (.bgcode) und als `Metadata/thumbnail.png` im 3MF
- [ ] PrusaLink Digest-Auth (Benutzer/Passwort) zusätzlich zum API-Key
- [ ] Weitere Hosts: Prusa Connect, Duet/RepRapFirmware, Repetier-Server, Obico
- [ ] Druckerstatus nach dem Upload (Fortschritt, Temperaturen, Dateiliste)
- [ ] mDNS-Hinweis / Auflösung von `.local`-Namen im Container
- [ ] Test mit echter Hardware (MK4/PrusaLink, Klipper)

## Docker-Image verkleinern (aktuell ≈ 1,36 GB)
1,05 GB davon ist das entpackte PrusaSlicer-AppImage: ≈ 800 MB gebündelte GUI-Bibliotheken (GTK, WebKit,
GStreamer), die die CLI nicht braucht, und ≈ 220 MB Ressourcen.
- [ ] Nicht benötigte Ressourcen im Image löschen (localization, fonts, shapes, icons ≈ 90 MB)
- [ ] Eigener PrusaSlicer-Build ohne GUI (`-DSLIC3R_GUI=OFF`) als Multi-Stage-Build → geschätzt 300–400 MB
      Gesamtgröße; Build dauert allerdings ≈ 30–60 min und muss pro Version gepflegt werden
