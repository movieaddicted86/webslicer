/**
 * `node --test` knows TypeScript through tsx but not a `.css` import. A `--import` file only runs
 * code, so it has to install the hooks: `css-hooks.mjs` maps every `.css` import to an empty module.
 */
import { register } from 'node:module';

register(new URL('./css-hooks.mjs', import.meta.url));
