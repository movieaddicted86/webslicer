/**
 * The read-only discovery tools – printers, presets, the option schema and the library (concept
 * `docs/MCP-Concept.md` §4, phase 1). Nothing here changes state.
 */
import { z } from 'zod';
import type { OptionDef } from '@webslicer/shared';
import { NotFoundError } from '../errors.js';
import { defaultPresetName, getInstalledPrinters, listPresets, resolvePreset } from '../slicer/presets.js';
import { listLibrary } from '../services/library.js';
import { activeSchema } from '../services/schema.js';
import { SERVER_ONLY_KEYS } from '../services/serverOnly.js';
import { defineTool, type AnyTool } from './toolTypes.js';

const schemaOf = activeSchema;

export const catalogTools: AnyTool[] = [
  defineTool({
    name: 'webslicer.list_printers',
    title: 'List printers',
    description: 'Installed printers of this WebSlicer and the printer presets that can be used for a project.',
    readOnly: true,
    input: z.object({}),
    handler: async () => {
      const schema = await schemaOf();
      const presets = listPresets(schema, 'printer');
      return {
        printers: getInstalledPrinters().map((i) => ({
          vendor: i.vendorId,
          model: i.modelId,
          variant: i.variant,
          presets: presets.filter((p) => p.printerModel === i.modelId && p.printerVariant === i.variant).map((p) => p.name),
        })),
        default_printer: defaultPresetName('printer'),
        default_print: defaultPresetName('print'),
        default_filament: defaultPresetName('filament'),
      };
    },
  }),

  defineTool({
    name: 'webslicer.list_presets',
    title: 'List presets',
    description: 'Print, filament and printer presets. Give a printer (and print) preset to get the compatibility flag.',
    readOnly: true,
    input: z.object({
      type: z.enum(['print', 'filament', 'printer']).describe('preset type'),
      printer: z.string().optional().describe('printer preset name; filament/print compatibility is checked against it'),
      print: z.string().optional().describe('print preset name; used for filament compatibility'),
    }),
    handler: async (args) => {
      const schema = await schemaOf();
      const printerCfg = args.printer === undefined ? undefined : resolvePreset(schema, 'printer', args.printer)?.config;
      if (args.printer !== undefined && !printerCfg) throw new NotFoundError(`Unknown printer preset "${args.printer}"`);
      const printCfg = args.print === undefined ? undefined : resolvePreset(schema, 'print', args.print)?.config;
      if (args.print !== undefined && !printCfg) throw new NotFoundError(`Unknown print preset "${args.print}"`);
      const list = listPresets(schema, args.type, {
        printerName: args.printer,
        printerConfig: printerCfg,
        printName: args.print,
        printConfig: printCfg,
      });
      return {
        type: args.type,
        count: list.length,
        presets: list.map((p) => ({
          name: p.name,
          system: p.system,
          compatible: p.compatible ?? null,
          vendor: p.vendorName ?? null,
          model: p.printerModel ?? null,
          variant: p.printerVariant ?? null,
          technology: p.technology ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: 'webslicer.get_option_schema',
    title: 'Get option schema',
    description:
      'Slicer options with label, type, default and allowed values – the options set_settings accepts. Only print and filament process/material options are listed; anything else (printer options, G-code, text) is refused.',
    readOnly: true,
    input: z.object({
      query: z.string().optional().describe('substring of the key, label, category or tooltip'),
      type: z.enum(['print', 'filament', 'printer']).optional().describe('only options of this preset type'),
      limit: z.number().int().min(1).max(200).optional().describe('maximum number of options (default 50)'),
    }),
    handler: async (args) => {
      const schema = await schemaOf();
      const needle = (args.query || '').trim().toLowerCase();
      const limit = args.limit ?? 50;
      // the key is what set_settings needs, so a key match ranks before a tooltip that only mentions it
      const rank = (o: OptionDef): number => {
        const key = o.key.toLowerCase();
        if (key === needle) return 0;
        if (key.includes(needle)) return 1;
        if (
          String(o.label || '')
            .toLowerCase()
            .includes(needle)
        )
          return 2;
        return 3;
      };
      const all = Object.values(schema.options).filter((o) => {
        // the server-only keys are not settable through set_settings, so not offered here either
        if (SERVER_ONLY_KEYS.has(o.key)) return false;
        if (args.type && !o.presetTypes.includes(args.type)) return false;
        if (!needle) return true;
        return [o.key, o.label, o.category, o.tooltip].some((f) =>
          String(f || '')
            .toLowerCase()
            .includes(needle),
        );
      });
      if (needle) all.sort((a, b) => rank(a) - rank(b));
      return {
        count: Math.min(all.length, limit),
        total_matches: all.length,
        options: all.slice(0, limit).map((o) => ({
          key: o.key,
          label: o.label,
          type: o.type,
          default: o.default,
          enum_values: o.enumValues ?? null,
          category: o.category,
          preset_types: o.presetTypes,
          per_extruder: !!o.perExtruder,
          tooltip: o.tooltip.length > 300 ? `${o.tooltip.slice(0, 300)}…` : o.tooltip,
        })),
      };
    },
  }),

  defineTool({
    name: 'webslicer.list_library',
    title: 'List library',
    description: 'Files and folders of the model library (models, 3MF projects, G-code).',
    readOnly: true,
    input: z.object({ path: z.string().optional().describe('folder relative to the library root (default: root)') }),
    handler: async (args) => {
      const listing = await listLibrary(args.path || '');
      return {
        path: listing.path,
        entries: listing.entries.map((e) => ({
          name: e.name,
          path: e.path,
          dir: e.dir,
          kind: e.kind ?? null,
          size_bytes: e.size ?? null,
          modified: e.mtime ?? null,
        })),
      };
    },
  }),
];
