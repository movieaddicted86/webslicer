/**
 * The start-up 403 of the Host guard, said in words the user can act on.
 *
 * A user who opens the app by a name the server does not answer on (a Tailscale/MagicDNS name, a NAS
 * name, a proxy name) used to get "Could not connect to the server: host not allowed" and a Retry
 * that could never work. The address the browser asked for is in `location.host` – the server's own
 * answer names it too, but the panel must be right even if the 403 came from a proxy in front.
 */

/** What the start-up panel shows for a refused address. */
export interface HostRefusal {
  /** the address the browser used, as it reads in the panel: `webslicer.tail6b34f9.ts.net:8080` */
  address: string;
  /** the `ALLOWED_HOSTS` entry that opens it: the same name without the port */
  allowedHosts: string;
  /** the shell lines of the two installs, already carrying `allowedHosts` */
  docker: string;
  proxmox: string;
}

/** The API status that means the Host/Origin guard refused the request (SEC-2). */
export function isHostRefusal(status: number | undefined): boolean {
  return status === 403;
}

/**
 * The port stripped from a `location.host` value, `[::1]:8080` and `nas:8080` alike.
 *
 * `new URL` does this correctly for every form including bracketed IPv6; a value it cannot parse keeps
 * its port rather than turning into something else.
 */
export function hostNameWithoutPort(host: string): string {
  try {
    return new URL(`http://${host}`).hostname || host;
  } catch {
    return host;
  }
}

/** The panel's content for the address the browser is on. */
export function hostRefusal(host: string): HostRefusal {
  const allowedHosts = hostNameWithoutPort(host);
  return {
    address: host,
    allowedHosts,
    docker: `ALLOWED_HOSTS=${allowedHosts}`,
    proxmox: `echo 'ALLOWED_HOSTS=${allowedHosts}' >> /etc/webslicer/webslicer.env && systemctl restart webslicer`,
  };
}
