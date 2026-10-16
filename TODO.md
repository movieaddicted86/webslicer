# WebSlicer – ToDo / Roadmap

Die PrusaSlicer-Engine verarbeitet alle unten genannten Daten bereits, sobald sie im 3MF stehen.
Es fehlen jeweils der Editor im Browser und die Erweiterung des 3MF-Writers im Server.

## 1. Modifier-Volumen, Support-Verstärker und -Blocker (höchster Nutzen, geringer–mittlerer Aufwand)
- [ ] 3MF-Writer: mehrere Volumen pro Objekt mit `volume_type` (`ModelPart`, `ParameterModifier`,
      `SupportEnforcer`, `SupportBlocker`) in `Metadata/Slic3r_PE_model.config`
- [ ] Frontend: Hilfskörper (Box, Zylinder, Kugel, geladenes Mesh) als Kind-Volumen eines Objekts
      platzieren, transformieren, mit eigenem Config-Override (gleicher Dialog wie Pro-Objekt-Settings)
- [ ] Objektliste als Baum (Objekt → Volumen), Sichtbarkeit und Farben je Volumentyp
- [ ] 3MF-Import: vorhandene Volumen aus Projekten übernehmen

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
