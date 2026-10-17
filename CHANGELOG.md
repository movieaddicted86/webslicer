# Changelog

## 1.0.0-rc.2 – 2026-10-17

UAT-Durchlauf (docs/UAT-Protokoll.md): UAT-01 bis 14, 16 und 17 bestanden. Behobene Befunde:
- Custom-Drucker: fällt auf „- default FFF -“ zurück statt ein inkompatibles Vendor-Druckprofil zu behalten
- Kamera folgt der Bettgröße beim Druckerwechsel
- Modellnamen mit „&&“ werden als „&“ angezeigt
- Kopfzeile bricht bei schmalen Fenstern um, kein horizontales Seitenscrollen

## 1.0.0-rc.1 – 2026-10-17

Erster Release-Kandidat für den User Acceptance Test.

### Slicing
- PrusaSlicer-Engine 2.9.6 (CLI) im Container, alle Druck-/Filament-/Druckeroptionen aus der installierten Version
- Herstellerprofile aller mitgelieferten Bundles mit Vererbung, Kompatibilitätsbedingungen und Alias-Auflösung
- Eigene Presets als PrusaSlicer-kompatible INI, Standardprofile des Druckers werden automatisch gewählt
- Pro-Objekt-Einstellungen, Modifier, Support-Verstärker/-Blocker, Negativ-Volumen, Zusatzteile
- Support-, Seam- und MMU-Painting; Höhenbereiche mit eigener Layerhöhe
- G-Code mit Vorschaubildern (PNG/JPG/QOI) in Filamentfarbe

### Oberfläche
- 3D-Plater mit Gizmo, Zahleneingabe, Auf-Fläche-legen, Arrange, Undo/Redo, Herstellerbett
- Settings-Tabs wie PrusaSlicer (Simple/Advanced/Expert, Suche, Änderungsmarkierung)
- Schnelleinstellungen Supports/Infill/Brim, G-Code-Vorschau mit Layer-Slider und Legende
- Dateibibliothek (gemountetes Verzeichnis), Projekt speichern/laden, Autosave mit Wiederherstellung
- Upload an PrusaLink, OctoPrint, Klipper/Moonraker, optional mit selbstsigniertem Zertifikat

### Betrieb
- Docker-Image (≈ 1,2 GB) mit Compose-Datei, Volumes `/data` und `/library`
- Proxmox-LXC-Helper und Debian-Installer mit systemd-Dienst
- Beispielmodelle werden beim ersten Start in die Bibliothek kopiert
