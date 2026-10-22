/**
 * SEC-2 (T-033): the Host / Origin allowlist that closes DNS rebinding.
 *
 * The guard is the rule "the `Host` has to name this server", the piece the app lacked: the server
 * listens on `0.0.0.0`, so a rebound name from any website reached the whole API (and the MCP router's
 * old `Origin == Host` check passed, because both were the attacker's name).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedHostNames, hostAllowed, hostNameOf, isIpLiteral, originAllowed } from './hostGuard.js';

const LOCAL = ['192.168.1.42', '[fe80::1]'];

/** The allowlist of an install with one LAN address and no `ALLOWED_HOSTS`. */
const allowed = () => allowedHostNames([], LOCAL);

test('the Host header loses its port, IPv4, IPv6 and names alike', () => {
  assert.equal(hostNameOf('localhost:8080'), 'localhost');
  assert.equal(hostNameOf('LOCALHOST'), 'localhost');
  assert.equal(hostNameOf('192.168.1.42:8080'), '192.168.1.42');
  assert.equal(hostNameOf('[::1]:8080'), '[::1]');
  assert.equal(hostNameOf('[::1]'), '[::1]');
  assert.equal(hostNameOf('fe80::1'), 'fe80::1');
  assert.equal(hostNameOf('nas.lan:80'), 'nas.lan');
  assert.equal(hostNameOf(''), undefined);
  assert.equal(hostNameOf(undefined), undefined);
  assert.equal(hostNameOf('[broken'), undefined);
});

test('loopback names are matched, not "everything that contains localhost"', () => {
  for (const host of ['localhost', 'localhost:8080', '127.0.0.1:8080', '[::1]:8080']) {
    assert.equal(hostAllowed(host, allowed()), true, host);
  }
  assert.equal(hostAllowed(undefined, allowed()), false, 'a request without Host is refused');
});

test('an IP literal is allowed – a rebinding attack needs a name', () => {
  assert.equal(isIpLiteral('192.168.1.42'), true);
  assert.equal(isIpLiteral('[fe80::1]'), true);
  assert.equal(isIpLiteral('evil.example'), false);
  // the LAN address of the host machine, even when the container sees another interface
  assert.equal(hostAllowed('192.168.0.10:8080', allowed()), true);
  assert.equal(hostAllowed('[fd00::5]:8080', allowed()), true);
});

test('a foreign host name is refused, an own address in ALLOWED_HOSTS is accepted', () => {
  assert.equal(hostAllowed('evil.example:8080', allowed()), false);
  assert.equal(hostAllowed('192.168.1.42:8080', allowed()), true);
  assert.equal(hostAllowed('webslicer.lan:8080', allowed()), false);
  const withEnv = allowedHostNames(['webslicer.lan', 'NAS:8080'], LOCAL);
  assert.equal(hostAllowed('webslicer.lan', withEnv), true);
  assert.equal(hostAllowed('nas:8080', withEnv), true);
  assert.equal(hostAllowed('other.lan', withEnv), false);
});

test('Origin has to name an allowed host – but missing Origin still passes (MCP clients)', () => {
  const host = '192.168.1.42:8080';
  assert.equal(originAllowed(undefined, host, allowed()), true);
  assert.equal(originAllowed('http://localhost:8080', host, allowed()), true);
  assert.equal(originAllowed('http://localhost:5173', host, allowed()), true, 'the Vite dev port differs from the API port');
  // the machine's own address, on the app's own port (same name+port as Host)
  assert.equal(originAllowed('http://192.168.1.42:8080', host, allowed()), true);
  assert.equal(originAllowed('http://192.168.0.10:8080', host, allowed()), false, 'a foreign IP is not an own address');
  assert.equal(originAllowed('https://evil.example', host, allowed()), false);
  assert.equal(originAllowed('http://evil.example:8080', host, allowed()), false);
  assert.equal(originAllowed('null', host, allowed()), false, 'a sandboxed page has no origin to trust');
  assert.equal(originAllowed('not a url', host, allowed()), false);
  assert.equal(originAllowed('file:///tmp/x.html', host, allowed()), false, 'only http(s) origins exist for a request');
});

test('a foreign IP-literal Origin is refused even when the Host is the LAN IP', () => {
  // the review's pin: a page from a public IP must not reach the simple-request routes
  const host = '192.168.1.42:8080';
  assert.equal(originAllowed('http://203.0.113.5', host, allowed()), false);
  assert.equal(originAllowed('http://203.0.113.5:8080', host, allowed()), false);
  // the same public IP as a Host is still fine (Docker port mapping), only Origin is strict
  assert.equal(hostAllowed('203.0.113.5:8080', allowed()), true);
});

test('an own address is trusted on any port; a same-name origin on another port is not same-origin', () => {
  // own interface address: the Vite dev server / a second app port on the same box
  assert.equal(originAllowed('http://192.168.1.42:5173', '192.168.1.42:8080', allowed()), true);
  // an IP that is only the request's Host (not an own address) has to match name *and* port
  const host = '203.0.113.5:8080';
  assert.equal(originAllowed('http://203.0.113.5:5173', host, allowed()), false, 'other port');
  assert.equal(originAllowed('http://203.0.113.5:8080', host, allowed()), true);
  // a Host without a port: the origin's scheme default is what it means
  assert.equal(originAllowed('http://203.0.113.5', '203.0.113.5', allowed()), true);
  assert.equal(originAllowed('http://203.0.113.5:8080', '203.0.113.5', allowed()), false);
  assert.equal(originAllowed('https://203.0.113.5', '203.0.113.5', allowed()), true, 'a TLS proxy forwards Host without a port');
});

test('an ALLOWED_HOSTS name is a trusted Origin on any port (reverse proxy, dev server)', () => {
  const withEnv = allowedHostNames(['webslicer.lan', 'proxy.example'], LOCAL);
  assert.equal(originAllowed('https://webslicer.lan', 'localhost:8080', withEnv), true);
  assert.equal(originAllowed('http://proxy.example:8008', 'localhost:8080', withEnv), true);
});

test('a rebinding request (foreign Host with the same Origin) is refused', () => {
  // the Host check is the one that has to catch this: under rebinding Origin == Host, so the Origin
  // check alone can never see the difference – it only has to not *widen* what the Host check allows
  const set = allowed();
  assert.equal(hostAllowed('rebind.evil.example:8080', set), false);
  assert.equal(originAllowed('http://rebind.evil.example', 'rebind.evil.example:8080', set), false);
});
