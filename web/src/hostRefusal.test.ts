import assert from 'node:assert/strict';
import test from 'node:test';
import { hostNameWithoutPort, hostRefusal, isHostRefusal } from './hostRefusal';

test('the refused name loses its port, IPv6 and names alike', () => {
  assert.equal(hostNameWithoutPort('webslicer-prusa.tail6b34f9.ts.net:8080'), 'webslicer-prusa.tail6b34f9.ts.net');
  assert.equal(hostNameWithoutPort('nas:9000'), 'nas');
  assert.equal(hostNameWithoutPort('nas'), 'nas');
  assert.equal(hostNameWithoutPort('[::1]:8080'), '[::1]');
  assert.equal(hostNameWithoutPort('192.168.1.20:8080'), '192.168.1.20');
  // a value no URL can be built from is kept as it is instead of turning into something else
  assert.equal(hostNameWithoutPort('not a host'), 'not a host');
});

test('the panel names the address and the ALLOWED_HOSTS line that opens it', () => {
  const r = hostRefusal('webslicer-prusa.tail6b34f9.ts.net:8080');
  assert.equal(r.address, 'webslicer-prusa.tail6b34f9.ts.net:8080');
  assert.equal(r.allowedHosts, 'webslicer-prusa.tail6b34f9.ts.net');
  assert.equal(r.docker, 'ALLOWED_HOSTS=webslicer-prusa.tail6b34f9.ts.net');
  assert.match(r.proxmox, /ALLOWED_HOSTS=webslicer-prusa\.tail6b34f9\.ts\.net/);
  assert.match(r.proxmox, /\/etc\/webslicer\/webslicer\.env/);
  assert.match(r.proxmox, /systemctl restart webslicer/);
});

test('only a 403 is the host-guard refusal', () => {
  assert.equal(isHostRefusal(403), true);
  assert.equal(isHostRefusal(500), false);
  assert.equal(isHostRefusal(404), false);
  assert.equal(isHostRefusal(undefined), false);
});
