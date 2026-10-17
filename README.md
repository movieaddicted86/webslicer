# WebSlicer

Ein vollwertiger 3D-Druck-Slicer als Webanwendung. WebSlicer nutzt die **originale
PrusaSlicer-Engine** (CLI) im Backend und stellt Plater, Einstellungen, Profile,
G-Code-Vorschau und Druckerupload im Browser bereit. Läuft als Docker-Container oder
nativ in einem Proxmox-LXC.

![Stack](https://img.shields.io/badge/engine-PrusaSlicer%202.9.x-orange) ![Node](https://img.shields.io/badge/node-%E2%89%A520-green) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## Funktionen

- **3D-Plater** (Three.js): STL / OBJ / 3MF / AMF importieren (Drag & Drop), mehrere Objekte,
  verschieben / drehen / skalieren (Gizmo + Zahleneingabe), **Auf Fläche legen** (Taste F), Arrange, Duplizieren, Druckraum-Check,
  Extruder-Zuweisung, **Pro-Objekt-Einstellungen** (Overrides wie in PrusaSlicer).
- **Support-, Seam- und MMU-Painting**: Verstärker und Blocker bzw. den Extruder per Pinsel direkt auf das
  Modell malen (Taste L bzw. P, Radius einstellbar, Undo), gespeichert wie in PrusaSlicer als
  Dreiecksattribute im 3MF.
- **Höhenbereiche**: Z-Bereiche eines Objekts mit eigener Layerhöhe und beliebigen weiteren Einstellungen
  (variable Layerhöhe), wie die Höhenbereichs-Modifier in PrusaSlicer.
- **Undo/Redo** im Plater, **Herstellerbett** mit Modell und Textur des gewählten Druckers.
- **Volumen** wie in PrusaSlicer: **Modifier** (Bereich mit eigenen Einstellungen, z. B. 100 % Infill),
  **Support-Verstärker / -Blocker**, **Negativ-Volumen** (Aussparungen) und zusätzliche **Teile** als
  Box, Zylinder, Kugel, Slab oder aus einer Mesh-Datei; werden im 3MF gespeichert und beim Import
  wiederhergestellt.
- **Alle Slicing-Optionen** der installierten PrusaSlicer-Version: Das Optionsschema wird zur
  Laufzeit aus `prusa-slicer --help-fff/--help-sla` erzeugt und in die bekannten Tabs
  *Print / Filament / Printer Settings* mit Seiten und Gruppen einsortiert (Simple / Advanced /
  Expert-Modus, Suche, Änderungsmarkierung, Zurücksetzen).
- **Hersteller-Profile**: Alle Vendor-Bundles von PrusaSlicer (Prusa, Creality, Bambu, Anycubic, …
  >100 Hersteller) inkl. Vererbung, Kompatibilitätsbedingungen (`compatible_printers_condition`),
  Drucker-/Düsen-Varianten, Standard-Filamente. Eigene Presets werden als PrusaSlicer-kompatible
  `.ini` gespeichert.
- **Slicen** über die echte Engine (FFF und SLA), Fortschritt per Server-Sent-Events, Job-Queue
  mit parallelen Jobs.
- **G-Code-Vorschau**: Toolpaths nach Feature-Typ eingefärbt (PrusaSlicer-Farben), Layer-Slider
  (oben/unten), Travel-Moves, Legende mit Längen, Druckzeit / Filamentverbrauch / Kosten.
- **Export**: G-Code (auch binärer `.bgcode`), Projekt als 3MF (mit allen Einstellungen, öffnet
  direkt im Desktop-PrusaSlicer), Config-Bundle `.ini`.
- **Physische Drucker**: Upload (optional mit Druckstart) an **PrusaLink**, **OctoPrint** und
  **Klipper/Moonraker** (Mainsail/Fluidd), auch über HTTPS mit selbstsigniertem Zertifikat.
- **Vorschaubilder im G-Code**: Der Browser rendert die Thumbnails in den Größen und Formaten des
  Druckerprofils (PNG, JPG, QOI für Prusa-Displays), der Server bettet sie in den G-Code ein. Die
  Drucker-Displays und Mainsail/Fluidd/OctoPrint zeigen den Druck damit mit Bild.
- **Multi-Extruder / MMU**: Filament-Preset je Extruder, Wipe-Tower-Einstellungen, Extruder-Anzahl
  im Drucker-Preset.
- **Dateibibliothek**: Ein gemountetes Verzeichnis (`/library`, z. B. NAS-Share) mit STL/OBJ/3MF/AMF,
  Projekten und G-Code. Dateien lassen sich im Browser durchsuchen und direkt öffnen, Projekte als 3MF
  und fertiger G-Code dort ablegen – ohne Upload über den Browser.
- **Autosave**: Der Plater wird automatisch als Projekt gesichert und nach einem Reload oder Absturz
  des Browsers zur Wiederherstellung angeboten.
- Mehrbenutzerfähig im LAN, keine Installation am Client, läuft auch auf Tablets.

> Noch nicht enthalten (siehe TODO.md): Support-/Seam-Painting, Variable Layer Height
> Bearbeitung, Cut-Tool, Hollowing-Editor, Text-/SVG-Embossing. Das Slicing-Ergebnis ist
> ansonsten identisch mit PrusaSlicer, da dieselbe Engine verwendet wird.

## Schnellstart mit Docker

```bash
docker compose up -d
# → http://localhost:8080
```

Oder ohne Compose:

```bash
docker build -t webslicer .
docker run -d --name webslicer -p 8080:8080 -v webslicer-data:/data -v /pfad/zu/modellen:/library webslicer
```

`/data` hält Einstellungen, Profile, Drucker und Jobs; `/library` ist die Dateibibliothek, die du auf
einen Ordner oder NAS-Share mounten kannst (Standard in Compose: `./library`).

Beim ersten Start öffnet sich der Dialog *Printers*: Hersteller und Druckermodell/Düse wählen
(oder einen *Custom printer* anlegen). Danach Modell per Drag & Drop in die 3D-Ansicht ziehen und
**Slice now** klicken.

### Build-Argumente / Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---|---|
| `PRUSASLICER_VERSION` (build arg) | `2.9.6` | PrusaSlicer-Version |
| `PRUSASLICER_URL` (build arg) | – | Eigene AppImage-URL (überschreibt Version/Arch) |
| `PORT` | `8080` | HTTP-Port |
| `DATA_DIR` | `/data` | Presets, Modelle, Jobs, Druckerliste, Autosave |
| `LIBRARY_DIR` | `/library` (Compose) bzw. `$DATA_DIR/library` | Dateibibliothek für STL/3MF/G-Code, zum Mounten gedacht |
| `MAX_JOBS` | `2` | Parallele Slicing-Jobs |
| `MAX_UPLOAD_BYTES` | `524288000` | Max. Upload-Größe pro Modell |
| `JOB_RETENTION` | `50` | Aufbewahrte Jobs (G-Code) |
| `SLICE_TIMEOUT_MS` | `3600000` | Timeout pro Slicing-Job |
| `PRUSASLICER_BIN` | `/opt/prusaslicer/AppRun` | Pfad zur Slicer-Binary |
| `PRUSASLICER_RESOURCES` | auto | Pfad zum `resources`-Verzeichnis (Profile) |

Beispiel: `docker build --build-arg PRUSASLICER_VERSION=2.9.5 -t webslicer .`

### Woher kommt die PrusaSlicer-Binary?

Prusa Research veröffentlicht seit 2.9.0 keine Linux-Binaries mehr (nur Flatpak). Das Image nutzt
daher die gepflegten Community-AppImages aus den unveränderten PrusaSlicer-Quellen:

- x86_64: <https://github.com/gneiss15/PrusaSlicer.AppImage>
- arm64: <https://github.com/davidk/PrusaSlicer-ARM.AppImage>

Mit `PRUSASLICER_URL` kann jedes andere AppImage (z. B. ein eigener Build) verwendet werden; mit
`PRUSASLICER_BIN` auch eine selbst kompilierte Binary, die per Volume eingebunden wird.

## Installation unter Proxmox VE (LXC)

Auf dem Proxmox-Host als root ausführen:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/robert-nwaoko/webslicer/main/proxmox/webslicer-lxc.sh)"
```

Das Skript fragt Container-ID, Hostname, Disk, CPU, RAM, Bridge, IP und Storage ab (whiptail),
lädt das Debian-12-Template, legt einen unprivilegierten LXC an, installiert Node.js 22 und
PrusaSlicer, baut WebSlicer und richtet den systemd-Dienst `webslicer` ein. Am Ende wird die URL
ausgegeben.

Nicht-interaktiv:

```bash
CTID=120 HOSTNAME=webslicer DISK=12 CORES=4 RAM=4096 STORAGE=local-lvm IP=dhcp YES=1 \
  bash proxmox/webslicer-lxc.sh
```

Aus einem lokalen Checkout heraus (z. B. per `scp` auf den Host kopiert) werden die lokalen Quellen
in den Container gepusht statt von GitHub geladen. Das Repo (`WEBSLICER_REPO`) und der Branch sind
über Umgebungsvariablen einstellbar.

Empfohlene Ressourcen: 2–4 Kerne, 3–4 GB RAM (große Modelle brauchen mehr), 10 GB Disk
(PrusaSlicer entpackt ≈ 1 GB).

Nützliche Befehle im Container:

```bash
systemctl status webslicer
journalctl -u webslicer -f
bash /root/webslicer-install.sh      # Update auf den aktuellen Branch / neue PrusaSlicer-Version
```

Der Installer `proxmox/install.sh` funktioniert ebenso auf jedem Debian 12/13 oder Ubuntu 22.04+
(VM, Bare Metal).

### Alternative: Docker im LXC

Wer lieber Docker im LXC nutzt: Container mit `nesting=1` anlegen, Docker installieren und
`docker compose up -d` im Repo ausführen.

## Entwicklung

```bash
npm install
npm run dev          # Vite (5173, Proxy → API) + Server (8080, tsx watch)
npm run build        # web/dist + server/dist
npm test             # Server-Tests
```

Für die lokale Entwicklung muss PrusaSlicer erreichbar sein (`PRUSASLICER_BIN`); unter Windows wird
`prusa-slicer-console.exe` der Desktop-Installation automatisch gefunden.

### Architektur

```
web/      React + Three.js + Zustand (Vite)      → Plater, Settings-UI, G-Code-Vorschau (Web Worker)
server/   Node 22 + Express
  slicer/cli.ts        Aufruf von prusa-slicer
  slicer/schema.ts     Optionsschema aus --help-fff/--help-sla + kuratiertes Tab-Layout
  slicer/bundles.ts    Vendor-Bundles (resources/profiles/*.ini) mit Vererbung
  slicer/condition.ts  Auswertung von compatible_*_condition
  slicer/presets.ts    System-/User-Presets, installierte Drucker
  slicer/threemf.ts    STL-Parser, 3MF-Writer (Transformationen, Pro-Objekt-Config)
  jobs.ts              Job-Queue, Progress (SSE), G-Code-Statistik
  printers.ts          PrusaLink / OctoPrint / Moonraker Upload
proxmox/  LXC-Helper (Host) + Installer (Container)
```

Slicing-Ablauf: Der Browser lädt das Modell, normalisiert die Geometrie und lädt sie als STL hoch.
Beim Slicen erzeugt der Server aus allen Objekten + Transformationen ein 3MF, schreibt die
zusammengeführte Konfiguration (Print + Filament(e) + Printer) als `config.ini` und ruft
`prusa-slicer --export-gcode --load config.ini --dont-arrange model.3mf` auf.

### API (Auszug)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/schema` | Optionsschema + Layout |
| GET | `/api/vendors` | Hersteller & Druckermodelle |
| POST | `/api/presets/:type/list` | Presets (mit Kompatibilität) |
| GET/PUT/DELETE | `/api/presets/:type/:name` | Preset lesen / als User-Preset speichern / löschen |
| POST | `/api/models` | STL hochladen (Body = Binär-STL) |
| POST | `/api/slice` | Job anlegen → `202 {id}` |
| GET | `/api/jobs/:id/events` | Fortschritt (SSE) |
| GET | `/api/jobs/:id/gcode` | Ergebnis (`?download`) |
| POST | `/api/jobs/:id/send` | Upload an physischen Drucker |
| POST | `/api/export/3mf` | Projekt-3MF |

## Lizenz

WebSlicer steht unter der AGPL-3.0, wie PrusaSlicer. PrusaSlicer ist © Prusa Research; WebSlicer
ist ein unabhängiges Projekt und steht in keiner Verbindung zu Prusa Research.
