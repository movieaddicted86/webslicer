/**
 * The start-up screen of a host-guard refusal (T-090).
 *
 * The app was opened by a name the server does not answer on – Robert hit it with a Tailscale name –
 * and every `/api` call came back 403. The old screen said "Could not connect to the server: host not
 * allowed" with a Retry that could never work. The panel now names the address the browser used
 * (`location.host`, not a server answer), gives the `ALLOWED_HOSTS` line in both installs' wording and
 * links the installation guide.
 *
 * The 403 is mocked at the network edge: the real guard refuses by `Host`, and a spec cannot put the
 * browser on a foreign name against the fixture stack. Everything the panel *shows* comes from the
 * real app – only the answer is the one a refused host gets.
 */
import { expect, test } from '../helpers/fixtures';

test.describe('a refused host says what to change (T-090)', () => {
  test('the panel names the refused address, the ALLOWED_HOSTS line and the docs', async ({ page }) => {
    // every API call is refused as if by the Host guard – the app cannot load
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'host not allowed', hint: 'This server does not answer to the name "…".' }),
      }),
    );

    await page.goto('/');

    const panel = page.getByTestId('host-refusal');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('This address is not allowed');

    // the address is the one the browser is on – the port stays on screen, the ALLOWED_HOSTS line has none
    const host = new URL(page.url()).host;
    const name = new URL(page.url()).hostname;
    await expect(page.getByTestId('host-refusal-address')).toHaveText(host);

    // the two fix recipes, copyable as they stand
    await expect(page.getByTestId('host-refusal-docker')).toHaveText(`ALLOWED_HOSTS=${name}`);
    await expect(page.getByTestId('host-refusal-proxmox')).toContainText(`ALLOWED_HOSTS=${name}`);
    await expect(page.getByTestId('host-refusal-proxmox')).toContainText('/etc/webslicer/webslicer.env');
    await expect(page.getByTestId('host-refusal-proxmox')).toContainText('systemctl restart webslicer');

    // the IP hint and the guide
    await expect(panel).toContainText('IP address');
    const docs = page.getByTestId('host-refusal-docs');
    await expect(docs).toHaveAttribute('href', /docs\/installation\.md#opening-the-app-by-ip-host-name-or-reverse-proxy/);

    // Retry stays, and it reloads rather than pretending to bypass the guard
    await expect(page.getByTestId('host-refusal-retry')).toBeVisible();

    // the bare "host not allowed" line of the old screen is gone – the panel replaced it
    await expect(panel).not.toContainText('Could not connect to the server');
  });

  test('another start-up failure keeps the old text and the plain Retry', async ({ page }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal error' }) }),
    );

    await page.goto('/');

    await expect(page.getByText('Could not connect to the server: Internal error')).toBeVisible();
    await expect(page.getByTestId('host-refusal')).toHaveCount(0);
  });
});
