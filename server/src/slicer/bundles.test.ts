/**
 * "Newer wins": a bundle installed into `<dataDir>/vendor` replaces the engine's copy of the same
 * vendor only when its `config_version` is higher.
 *
 * The image's bundles stay the fallback – an install into the data dir is one file per vendor, and the
 * loader has to survive a stale file there (a data dir from an older server, or a downgraded image)
 * without hiding the profiles the engine ships.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-bundles-'));
const ENGINE = path.join(DATA_DIR, 'engine-profiles');
process.env.DATA_DIR = DATA_DIR;
process.env.PRUSASLICER_PROFILES = ENGINE;
delete process.env.PRUSASLICER_RESOURCES;

const { config } = await import('../config.js');
const { loadBundles, parseBundle, resolveModelAsset, vendorDataDir } = await import('./bundles.js');

const bundle = (version: string, preset: string) =>
  ['[vendor]', 'name = Test Vendor', `config_version = ${version}`, '', `[print:${preset}]`, 'layer_height = 0.2', ''].join('\n');

const VENDOR_DIR = vendorDataDir();
const ENGINE_FILE = path.join(ENGINE, 'TestVendor.ini');
const DATA_FILE = path.join(VENDOR_DIR, 'TestVendor.ini');

/** The single preset name the loader currently serves for the test vendor. */
function servedPreset(): string | undefined {
  return loadBundles(true).presets.print.find((p) => p.vendorId === 'TestVendor')?.name;
}

function installedVersion(): string | undefined {
  return loadBundles(true).vendors.find((v) => v.id === 'TestVendor')?.configVersion;
}

before(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(ENGINE, { recursive: true });
  // the image's copy, as the Docker build ships it
  fs.writeFileSync(ENGINE_FILE, bundle('1.0.0', 'Engine preset'));
});

after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('without a data-dir bundle the engine copy is used', () => {
  assert.equal(installedVersion(), '1.0.0');
  assert.equal(servedPreset(), 'Engine preset');
});

test('an older data-dir bundle is ignored', () => {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, bundle('0.9.0', 'Stale preset'));
  assert.equal(installedVersion(), '1.0.0');
  assert.equal(servedPreset(), 'Engine preset');
});

test('the same version keeps the engine copy', () => {
  fs.writeFileSync(DATA_FILE, bundle('1.0.0', 'Same preset'));
  assert.equal(installedVersion(), '1.0.0');
  assert.equal(servedPreset(), 'Engine preset');
});

test('a newer data-dir bundle wins and brings its presets', () => {
  fs.writeFileSync(DATA_FILE, bundle('1.1.0', 'Updated preset'));
  assert.equal(installedVersion(), '1.1.0');
  assert.equal(servedPreset(), 'Updated preset');
  // the file of the chosen bundle points into the data dir
  assert.equal(loadBundles(true).vendors.find((v) => v.id === 'TestVendor')?.file, DATA_FILE);
});

test('a vendor only in the data dir is loaded too', () => {
  fs.writeFileSync(path.join(VENDOR_DIR, 'Extra.ini'), bundle('2.0.0', 'Extra preset').replace(/Test Vendor/, 'Extra Vendor'));
  // `parseBundle` names a vendor after its file, so the vendor id is `Extra`
  const extra = loadBundles(true).presets.print.find((p) => p.vendorId === 'Extra');
  assert.equal(extra?.name, 'Extra preset');
});

test('a broken data-dir bundle does not hide the engine copy', () => {
  fs.writeFileSync(DATA_FILE, 'this is not an ini with a version');
  assert.equal(installedVersion(), '1.0.0');
  assert.equal(servedPreset(), 'Engine preset');
  fs.writeFileSync(DATA_FILE, bundle('1.1.0', 'Updated preset'));
});

test('a model asset is looked up in the data dir first, then in the engine profiles', () => {
  const engineAsset = path.join(ENGINE, 'TestVendor', 'bed.stl');
  const dataAsset = path.join(VENDOR_DIR, 'TestVendor', 'bed.stl');
  fs.mkdirSync(path.dirname(engineAsset), { recursive: true });
  fs.writeFileSync(engineAsset, 'engine');
  assert.equal(resolveModelAsset('TestVendor', 'bed.stl'), engineAsset);
  fs.mkdirSync(path.dirname(dataAsset), { recursive: true });
  fs.writeFileSync(dataAsset, 'data');
  assert.equal(resolveModelAsset('TestVendor', 'bed.stl'), dataAsset);
  assert.equal(resolveModelAsset('TestVendor', 'nothing.svg'), undefined);
});

test('the bundle file name decides the vendor id, not the vendor section', () => {
  const parsed = parseBundle(path.join(DATA_DIR, 'Whatever.ini'), bundle('1.0.0', 'x'));
  assert.equal(parsed.vendor.id, 'Whatever');
  assert.equal(parsed.vendor.name, 'Test Vendor');
  // the install path is `<dataDir>/vendor`
  assert.equal(VENDOR_DIR, path.join(config.dataDir, 'vendor'));
});
