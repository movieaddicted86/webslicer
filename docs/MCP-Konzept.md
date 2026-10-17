# Konzept: MCP-Integration für WebSlicer

Stand: 2026-10-17 · Status: **Konzept und Planung, nicht implementiert**

## 1. Ziel und Nutzen

Ein MCP-Server (Model Context Protocol) macht WebSlicer für LLM-Agenten steuerbar: Claude, ChatGPT-Clients,
Home-Assistant-Assistenten oder eigene Agenten können Modelle aus der Bibliothek laden, Profile wählen,
Einstellungen ändern, slicen, Ergebnisse auswerten und G-Code an Drucker senden. Typische Anwendungen:

- „Slice `bracket_v3.stl` für den MK4S mit 0.15 mm, 40 % Infill, Supports überall, und schick es an den Drucker.“
- „Wie lange dauert das Benchy mit 0.2 statt 0.1 mm und wie viel Filament spart das?“ (Variantenvergleich)
- Automatisierung: Watch-Folder, nächtliche Batch-Slices, Druckwarteschlangen, Kostenkalkulation.
- Assistenz im UI: Ein Chat-Panel in WebSlicer, das den aktuellen Plater kennt („mach mir die Wände dicker“).

Das Fundament ist bereits vorhanden: Die gesamte Funktionalität läuft über die REST-API des Servers
(`/api/...`), und das Slicing ist headless. Nur die Mesh-Verarbeitung (Import, Normalisierung, Volumen,
Thumbnails) findet heute im Browser statt.

## 2. Architekturoptionen

| Option | Beschreibung | Bewertung |
|---|---|---|
| **A. MCP-Endpunkt im WebSlicer-Server** (`/mcp`, Streamable HTTP) | `@modelcontextprotocol/sdk` im Express-Server; Tools rufen die internen Funktionen direkt auf (jobs.ts, presets.ts, library.ts). | **Empfohlen.** Keine zweite Komponente, nutzt Job-Queue, Bibliothek und Presets direkt, ein Docker-Image. Für Clients im LAN (Claude Desktop, Home Assistant) ideal. |
| B. Separater MCP-Server (stdio) als npm-Paket | Kleiner Prozess auf dem Client-Rechner, spricht die REST-API von WebSlicer. | Gut für Claude Desktop / Claude Code per stdio ohne Netzwerkfreigabe des MCP-Endpunkts. Kann später aus A abgeleitet werden (gleiche Tool-Definitionen, anderer Transport). |
| C. Nur REST + OpenAPI | Agenten nutzen die REST-API über generische HTTP-Tools. | Kein MCP-Mehrwert (Discovery, Schemas, Prompts, Ressourcen). Nur als Fallback. |

Entscheidung: **A implementieren, B als dünne stdio-Hülle nachziehen** (gemeinsame Tool-Definitionen in
`server/src/mcp/tools.ts`, Transport austauschbar).

## 3. Voraussetzung: Headless-Modellimport

Damit ein Agent ohne Browser arbeiten kann, muss der Server Modelle selbst lesen und aufbereiten:

1. **STL** – vorhanden (`threemf.ts: parseStl`).
2. **3MF** – Projekt-Metadaten werden bereits gelesen; fehlt: Mesh-Extraktion aus `3D/3dmodel.model`
   (Vertices/Triangles je Objekt, Build-Item-Transform) → kleiner XML-Parser, kein Browser nötig.
3. **OBJ/AMF** – optional, geringe Priorität (OBJ-Parser ist trivial).
4. **Normalisierung** wie im Browser (XY-Zentrum, min Z = 0) und Platzierung/Arrange serverseitig
   (der Arrange-Algorithmus aus `store.ts` wird nach `server/src/plater.ts` portiert).
5. **Thumbnails** – ohne Browser kein WebGL. Optionen: (a) ohne Thumbnails slicen, (b) softwaregerendert
   per `three` + `headless-gl` oder eine einfache Z-Buffer-Rasterisierung in TypeScript (reicht für
   16×16 bis 480×240 Vorschauen). Empfehlung: (b) einfache Rasterisierung, da reine Node-Lösung.

Ergebnis: ein serverseitiges „Plater-Modell“ (Objekte, Transformationen, Volumen, Presets), das sowohl
die UI als auch MCP-Tools erzeugen und slicen können. Das Format ist bereits der `SliceRequest`.

## 4. Tool-Katalog (Entwurf)

Namenskonvention `webslicer.<verb>_<objekt>`; alle Eingaben als JSON-Schema (zod).

**Entdecken**
- `list_printers()` → installierte Druckerprofile (+ physische Drucker)
- `list_presets(type, printer?)` → kompatible Druck-/Filamentprofile mit Alias
- `get_option_schema(query?)` → Optionen mit Label, Typ, Default, Tooltip (gefiltert)
- `list_library(path?)` / `search_library(text)` → Modelle, Projekte, G-Code

**Projekt aufbauen**
- `create_project(printer, print_preset, filaments[])` → `project_id` (serverseitiger Zustand, TTL)
- `add_model(project_id, library_path | upload_id, {position?, rotation?, scale?, copies?})`
- `arrange(project_id)`, `transform_object(project_id, object_id, …)`, `place_on_face` (Normale)
- `set_settings(project_id, {key: value}, scope: print|filament[i]|printer)` – validiert gegen das Schema
- `set_object_settings(project_id, object_id, {…})`, `add_modifier(...)`, `add_height_range(...)`
- `quick_settings(project_id, {supports, infill, brim})` – die drei Plater-Schnelleinstellungen

**Slicen und auswerten**
- `slice(project_id, {binary_gcode?, thumbnails?})` → `job_id`; Fortschritt per MCP-Notification
- `get_job(job_id)` → Status, Zeit, Filament (mm/g/Kosten), Layer, Warnungen aus dem Slicer-Log
- `compare(project_id, variants[])` → Tabelle Zeit/Filament je Variante (nutzt die Job-Queue parallel)
- `export_project(project_id, library_path)`, `export_gcode(job_id, library_path)`

**Drucker**
- `list_print_hosts()`, `test_print_host(id)`
- `send_to_printer(job_id, host_id, {start: boolean})` – **start=true nur mit explizitem Benutzer-OK**
- später: `printer_status(host_id)` (Roadmap: Druckerstatus)

**Ressourcen (MCP resources)** – lesend: `webslicer://presets/{type}/{name}`, `webslicer://jobs/{id}/log`,
`webslicer://library/{path}` (3MF/G-Code als Binärressource), `webslicer://schema`.

**Prompts** – vordefinierte Abläufe: `slice-and-print`, `optimize-for-time`, `compare-layer-heights`.

## 5. Sicherheit

- **Authentifizierung**: Bearer-Token (`MCP_TOKEN` in der Umgebung); ohne Token ist `/mcp` deaktiviert.
  Optional OAuth-Resource-Server nach MCP-Spezifikation für Cloud-Clients.
- **Netz**: MCP nur im LAN oder hinter Reverse-Proxy mit TLS; CORS/Origin-Prüfung gegen DNS-Rebinding.
- **Gefährliche Aktionen**: Druckstart, Löschen in der Bibliothek, Preset-Löschen → Tool-Annotation
  `destructiveHint`/`openWorldHint`, zusätzlich serverseitige Bestätigungspflicht (`confirm: true`)
  und Audit-Log (`/data/audit.log`: wer, wann, welches Tool, welche Parameter).
- **Ressourcenlimits**: Projekte je Client begrenzt, Jobs über die vorhandene Queue (MAX_JOBS),
  Upload-Größen wie heute; Pfade über `resolveLibraryPath` (kein Verlassen der Bibliothek).
- **Keine Geheimnisse an das LLM**: API-Keys der Drucker werden nie zurückgegeben (wie in der REST-API).

## 6. Umsetzung in Phasen

| Phase | Inhalt | Aufwand |
|---|---|---|
| 0 | Headless-Import (3MF-Mesh-Reader, Normalisierung, Arrange serverseitig), Projekt-Store mit TTL | 2–3 Tage |
| 1 | MCP-Endpunkt (`@modelcontextprotocol/sdk`, Streamable HTTP, Token-Auth), Tools „Entdecken“ + „Slicen“ (list_*, create_project, add_model, set_settings, slice, get_job) | 2 Tage |
| 2 | Objekt-Tools (Transform, Modifier, Höhenbereiche, Quick-Settings), Ressourcen, Prompts, Audit-Log | 2 Tage |
| 3 | `send_to_printer` mit Bestätigung, Variantenvergleich, Thumbnail-Rasterizer | 2 Tage |
| 4 | stdio-Variante als npm-Paket (`webslicer-mcp`), Doku, Beispiele für Claude Desktop / Claude Code / Home Assistant | 1 Tag |

Tests: Unit-Tests der Tool-Handler gegen die bestehende Logik, Integrationstest mit dem MCP Inspector
(`npx @modelcontextprotocol/inspector`) und ein E2E-Skript, das einen kompletten Agenten-Workflow
(Bibliothek → Projekt → Slice → Auswertung) gegen den Container fährt.

## 7. Offene Fragen

- Soll das Chat-Panel in der WebSlicer-UI Teil des Projekts werden (eigener LLM-Zugang im Server) oder
  bleiben Agenten extern?
- Mehrbenutzer: Projekte je Token oder global sichtbar?
- Thumbnails im headless Betrieb: einfacher Rasterizer akzeptabel oder Browser-Qualität nötig?

## 8. Empfehlung

Mit Phase 0 und 1 beginnen: Sie liefern den größten Nutzen (Agent kann aus der Bibliothek slicen und
auswerten) bei überschaubarem Risiko, da nur lesende Tools und die vorhandene Job-Queue beteiligt sind.
Druckstart per Agent erst in Phase 3 nach dem Hardware-Test der Upload-Funktion.
