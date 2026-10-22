/**
 * The shape of a slicer config key (SEC-2, T-033).
 *
 * PrusaSlicer configs are flat `key = value` files and the server writes the key unescaped
 * (`server/src/slicer/ini.ts`). SEC-1 dropped the server-only keys (`post_process`, …) by an exact
 * match on the raw client key, so a key such as `"x\npost_process = echo pwned"` slipped past the
 * filter and wrote an extra `post_process` line into the `config.ini` that the slicer loads with
 * `--load` – i.e. it ran a shell command as the service user.
 *
 * Every option PrusaSlicer knows is lower snake case, so one pattern rejects everything that could
 * change the meaning of the file: newlines, `=`, `;`, `#`, `[`, spaces (leading or trailing too) and
 * upper-case. The function lives in `shared` because the server validates with it (REST, MCP, the
 * merge, the INI writer) and the tests pin it once.
 */

/**
 * Keys a config may carry: lower snake case, starting with a letter, optionally with one numeric
 * index (`dynamic_overhang_speeds[0]` – a vector element key of the shipped Sovol profiles).
 *
 * The index is the one deliberate widening of the task's `^[a-z][a-z0-9_]*$`: the required sweep over
 * the bundled system presets found exactly one key that the strict form rejected, and dropping it
 * would have silently changed what a Sovol preset puts into the slicer config. It keeps the security
 * property, because everything that can change the meaning of the file (`\n`, `\r`, `=`, `;`, `#`,
 * spaces, a leading `[`) is still outside the pattern.
 */
export const CONFIG_KEY_PATTERN = /^[a-z][a-z0-9_]*(\[\d+\])?$/;

/** Whether `key` is a well-formed slicer config key (`^[a-z][a-z0-9_]*$`). */
export function isValidConfigKey(key: string): boolean {
  return typeof key === 'string' && CONFIG_KEY_PATTERN.test(key);
}

/** The error a writer throws for a key it must not put into a config file (the key quoted, escaped). */
export function invalidConfigKeyMessage(key: string): string {
  return `invalid config key ${JSON.stringify(key)}`;
}

/** Throw for a key that is not a well-formed slicer config key – the INI writer's last guard. */
export function assertValidConfigKey(key: string): void {
  if (!isValidConfigKey(key)) throw new Error(invalidConfigKeyMessage(key));
}
