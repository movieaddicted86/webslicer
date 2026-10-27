import { hostRefusal } from '../hostRefusal';
import './HostRefusalScreen.css';

/**
 * The start-up screen of a host-guard refusal (403): the app was opened by a name this server does not
 * answer on, so nothing else can load. Instead of the bare red line it names the address the browser
 * used and the one setting that opens it, for both installs.
 *
 * The address comes from `location.host`, never from the server answer: the panel has to be right even
 * if an intermediary answered the 403. The two lines are selectable as they stand, so a user can copy
 * the `ALLOWED_HOSTS` line without retyping it. Retry reloads the page – nothing here bypasses the
 * guard, which stays exactly as it is.
 */
export function HostRefusalScreen() {
  const refusal = hostRefusal(window.location.host);
  return (
    <div className="splash">
      <h1>WebSlicer</h1>
      <div className="host-refusal" role="alert" data-testid="host-refusal">
        <h2>This address is not allowed</h2>
        <p>
          The server refuses requests for <code data-testid="host-refusal-address">{refusal.address}</code>. This protects the app from DNS
          rebinding: only addresses it knows are answered.
        </p>

        <p className="muted small">Add that name to ALLOWED_HOSTS, then restart the app:</p>
        <div className="host-refusal-block">
          <div className="host-refusal-label">Docker / Unraid – environment variable</div>
          <code data-testid="host-refusal-docker">{refusal.docker}</code>
        </div>
        <div className="host-refusal-block">
          <div className="host-refusal-label">Proxmox – in the container</div>
          <code data-testid="host-refusal-proxmox">{refusal.proxmox}</code>
        </div>

        <p className="muted small">
          Or open the app by this server&apos;s IP address instead – an IP is always answered. The rules are in the{' '}
          <a
            href="https://github.com/movieaddicted86/webslicer/blob/main/docs/installation.md#opening-the-app-by-ip-host-name-or-reverse-proxy"
            target="_blank"
            rel="noreferrer"
            data-testid="host-refusal-docs"
          >
            installation guide
          </a>
          .
        </p>

        <button onClick={() => window.location.reload()} data-testid="host-refusal-retry">
          Retry
        </button>
      </div>
    </div>
  );
}
