# Third-party notices

WebSlicer itself is licensed under the GNU Affero General Public License, version 3 or later
(see `LICENSE`). It bundles and depends on the work of others:

## PrusaSlicer (the slicing engine)

WebSlicer runs the unmodified PrusaSlicer command-line engine. PrusaSlicer is free software by
Prusa Research a.s. and contributors, licensed under the **GNU Affero General Public License v3**
(AGPL-3.0). The Docker image and the native installer use community-built AppImages of the
unmodified PrusaSlicer sources:

- x86_64: <https://github.com/gneiss15/PrusaSlicer.AppImage> (PrusaSlicer 2.9.6)
- arm64: <https://github.com/davidk/PrusaSlicer-ARM.AppImage> (PrusaSlicer 2.9.6)

Corresponding source: <https://github.com/prusa3d/PrusaSlicer> (tag `version_2.9.6` of the shipped
release). PrusaSlicer is invoked as a separate program; the licence text is in the extracted
AppImage under `usr/share/doc/prusaslicer/` and at <https://www.gnu.org/licenses/agpl-3.0.html>.

## JavaScript dependencies

Generated from the production dependency tree (`npm ls --omit=dev --all`). Each package ships its
own licence text in `node_modules/<package>/LICENSE`.

| Package                     | Version | Licence                   | Source                                                   |
| --------------------------- | ------- | ------------------------- | -------------------------------------------------------- |
| `@hono/node-server`         | 2.1.5   | MIT                       | https://github.com/honojs/node-server                    |
| `@modelcontextprotocol/sdk` | 1.32.1  | MIT                       | https://github.com/modelcontextprotocol/typescript-sdk   |
| `@types/react`              | 19.3.0  | MIT                       | https://github.com/DefinitelyTyped/DefinitelyTyped       |
| `accepts`                   | 2.0.0   | MIT                       | jshttp/accepts                                           |
| `ajv`                       | 8.20.0  | MIT                       | ajv-validator/ajv                                        |
| `ajv-formats`               | 3.0.1   | MIT                       | https://github.com/ajv-validator/ajv-formats             |
| `body-parser`               | 2.3.0   | MIT                       | expressjs/body-parser                                    |
| `bytes`                     | 3.1.2   | MIT                       | visionmedia/bytes.js                                     |
| `call-bind-apply-helpers`   | 1.0.2   | MIT                       | https://github.com/ljharb/call-bind-apply-helpers        |
| `call-bound`                | 1.0.4   | MIT                       | https://github.com/ljharb/call-bound                     |
| `content-disposition`       | 2.0.1   | MIT                       | jshttp/content-disposition                               |
| `content-type`              | 2.1.0   | MIT                       | jshttp/content-type                                      |
| `cookie`                    | 0.7.2   | MIT                       | jshttp/cookie                                            |
| `cookie-signature`          | 1.2.2   | MIT                       | https://github.com/visionmedia/node-cookie-signature     |
| `core-util-is`              | 1.0.3   | MIT                       | https://github.com/isaacs/core-util-is                   |
| `cors`                      | 2.8.6   | MIT                       | expressjs/cors                                           |
| `cross-spawn`               | 7.0.6   | MIT                       | git@github.com:moxystudio/node-cross-spawn               |
| `csstype`                   | 3.2.3   | MIT                       | https://github.com/frenic/csstype                        |
| `debug`                     | 4.4.3   | MIT                       | https://github.com/debug-js/debug                        |
| `depd`                      | 2.0.0   | MIT                       | dougwilson/nodejs-depd                                   |
| `dunder-proto`              | 1.0.1   | MIT                       | https://github.com/es-shims/dunder-proto                 |
| `ee-first`                  | 1.1.1   | MIT                       | jonathanong/ee-first                                     |
| `encodeurl`                 | 2.0.0   | MIT                       | pillarjs/encodeurl                                       |
| `es-define-property`        | 1.0.1   | MIT                       | https://github.com/ljharb/es-define-property             |
| `es-errors`                 | 1.3.0   | MIT                       | https://github.com/ljharb/es-errors                      |
| `es-object-atoms`           | 1.1.2   | MIT                       | https://github.com/ljharb/es-object-atoms                |
| `escape-html`               | 1.0.3   | MIT                       | component/escape-html                                    |
| `etag`                      | 1.8.1   | MIT                       | jshttp/etag                                              |
| `eventsource`               | 3.0.7   | MIT                       | https://git@github.com/EventSource/eventsource           |
| `eventsource-parser`        | 3.1.1   | MIT                       | ssh://git@github.com/rexxars/eventsource-parser          |
| `express`                   | 5.3.0   | MIT                       | expressjs/express                                        |
| `express-rate-limit`        | 8.7.1   | MIT                       | https://github.com/express-rate-limit/express-rate-limit |
| `fast-deep-equal`           | 3.1.3   | MIT                       | https://github.com/epoberezkin/fast-deep-equal           |
| `fast-uri`                  | 3.1.9   | BSD-3-Clause              | https://github.com/fastify/fast-uri                      |
| `finalhandler`              | 2.1.1   | MIT                       | pillarjs/finalhandler                                    |
| `forwarded`                 | 0.2.0   | MIT                       | jshttp/forwarded                                         |
| `fresh`                     | 2.0.0   | MIT                       | jshttp/fresh                                             |
| `function-bind`             | 1.1.2   | MIT                       | https://github.com/Raynos/function-bind                  |
| `get-intrinsic`             | 1.3.0   | MIT                       | https://github.com/ljharb/get-intrinsic                  |
| `get-proto`                 | 1.0.1   | MIT                       | https://github.com/ljharb/get-proto                      |
| `gopd`                      | 1.2.0   | MIT                       | https://github.com/ljharb/gopd                           |
| `has-symbols`               | 1.1.0   | MIT                       | https://github.com/inspect-js/has-symbols                |
| `hasown`                    | 2.0.4   | MIT                       | https://github.com/inspect-js/hasOwn                     |
| `hono`                      | 4.13.13 | MIT                       | https://github.com/honojs/hono                           |
| `http-errors`               | 2.0.1   | MIT                       | jshttp/http-errors                                       |
| `iconv-lite`                | 0.7.3   | MIT                       | https://github.com/pillarjs/iconv-lite                   |
| `immediate`                 | 3.0.6   | MIT                       | https://github.com/calvinmetcalf/immediate               |
| `inherits`                  | 2.0.4   | ISC                       | https://github.com/isaacs/inherits                       |
| `ip-address`                | 10.7.4  | MIT                       | https://github.com/beaugunderson/ip-address              |
| `ipaddr.js`                 | 1.9.1   | MIT                       | https://github.com/whitequark/ipaddr.js                  |
| `is-promise`                | 4.0.0   | MIT                       | https://github.com/then/is-promise                       |
| `isarray`                   | 1.0.0   | MIT                       | https://github.com/juliangruber/isarray                  |
| `isexe`                     | 2.0.0   | ISC                       | https://github.com/isaacs/isexe                          |
| `jose`                      | 6.2.13  | MIT                       | panva/jose                                               |
| `json-schema-traverse`      | 1.0.0   | MIT                       | https://github.com/epoberezkin/json-schema-traverse      |
| `json-schema-typed`         | 8.0.2   | BSD-2-Clause              | https://github.com/RemyRylan/json-schema-typed           |
| `jszip`                     | 3.10.2  | (MIT OR GPL-3.0-or-later) | https://github.com/Stuk/jszip                            |
| `lie`                       | 3.3.0   | MIT                       | https://github.com/calvinmetcalf/lie                     |
| `lucide-react`              | 1.61.0  | ISC                       | https://github.com/lucide-icons/lucide                   |
| `math-intrinsics`           | 1.1.0   | MIT                       | https://github.com/es-shims/math-intrinsics              |
| `media-typer`               | 1.1.1   | MIT                       | jshttp/media-typer                                       |
| `merge-descriptors`         | 2.0.0   | MIT                       | sindresorhus/merge-descriptors                           |
| `mime-db`                   | 1.54.0  | MIT                       | jshttp/mime-db                                           |
| `mime-types`                | 3.0.2   | MIT                       | jshttp/mime-types                                        |
| `ms`                        | 2.1.3   | MIT                       | vercel/ms                                                |
| `negotiator`                | 1.1.0   | MIT                       | jshttp/negotiator                                        |
| `object-assign`             | 4.1.1   | MIT                       | sindresorhus/object-assign                               |
| `object-inspect`            | 1.13.4  | MIT                       | https://github.com/inspect-js/object-inspect             |
| `on-finished`               | 2.4.1   | MIT                       | jshttp/on-finished                                       |
| `once`                      | 1.4.0   | ISC                       | https://github.com/isaacs/once                           |
| `pako`                      | 1.0.11  | (MIT AND Zlib)            | nodeca/pako                                              |
| `parseurl`                  | 1.3.3   | MIT                       | pillarjs/parseurl                                        |
| `path-key`                  | 3.1.1   | MIT                       | sindresorhus/path-key                                    |
| `path-to-regexp`            | 8.4.2   | MIT                       | https://github.com/pillarjs/path-to-regexp               |
| `pkce-challenge`            | 5.0.1   | MIT                       | https://github.com/crouchcd/pkce-challenge               |
| `process-nextick-args`      | 2.0.1   | MIT                       | https://github.com/calvinmetcalf/process-nextick-args    |
| `proxy-addr`                | 2.0.8   | MIT                       | jshttp/proxy-addr                                        |
| `qs`                        | 6.16.1  | BSD-3-Clause              | https://github.com/ljharb/qs                             |
| `range-parser`              | 1.2.1   | MIT                       | jshttp/range-parser                                      |
| `raw-body`                  | 3.0.2   | MIT                       | stream-utils/raw-body                                    |
| `react`                     | 19.3.1  | MIT                       | https://github.com/react/react                           |
| `react-dom`                 | 19.3.1  | MIT                       | https://github.com/react/react                           |
| `readable-stream`           | 2.3.8   | MIT                       | https://github.com/nodejs/readable-stream                |
| `require-from-string`       | 2.0.2   | MIT                       | floatdrop/require-from-string                            |
| `router`                    | 2.2.0   | MIT                       | pillarjs/router                                          |
| `safe-buffer`               | 5.1.2   | MIT                       | https://github.com/feross/safe-buffer                    |
| `safer-buffer`              | 2.1.2   | MIT                       | https://github.com/ChALkeR/safer-buffer                  |
| `scheduler`                 | 0.28.0  | MIT                       | https://github.com/react/react                           |
| `send`                      | 1.2.1   | MIT                       | pillarjs/send                                            |
| `serve-static`              | 2.2.1   | MIT                       | expressjs/serve-static                                   |
| `setimmediate`              | 1.0.5   | MIT                       | YuzuJS/setImmediate                                      |
| `setprototypeof`            | 1.2.0   | ISC                       | https://github.com/wesleytodd/setprototypeof             |
| `shebang-command`           | 2.0.0   | MIT                       | kevva/shebang-command                                    |
| `shebang-regex`             | 3.0.0   | MIT                       | sindresorhus/shebang-regex                               |
| `side-channel`              | 1.1.1   | MIT                       | https://github.com/ljharb/side-channel                   |
| `side-channel-list`         | 1.0.1   | MIT                       | https://github.com/ljharb/side-channel-list              |
| `side-channel-map`          | 1.0.1   | MIT                       | https://github.com/ljharb/side-channel-map               |
| `side-channel-weakmap`      | 1.0.2   | MIT                       | https://github.com/ljharb/side-channel-weakmap           |
| `statuses`                  | 2.0.2   | MIT                       | jshttp/statuses                                          |
| `string_decoder`            | 1.1.1   | MIT                       | https://github.com/nodejs/string_decoder                 |
| `three`                     | 0.171.0 | MIT                       | https://github.com/mrdoob/three.js                       |
| `toidentifier`              | 1.0.1   | MIT                       | component/toidentifier                                   |
| `type-is`                   | 2.1.0   | MIT                       | jshttp/type-is                                           |
| `undici`                    | 7.30.1  | MIT                       | https://github.com/nodejs/undici                         |
| `unpipe`                    | 1.0.0   | MIT                       | stream-utils/unpipe                                      |
| `util-deprecate`            | 1.0.2   | MIT                       | https://github.com/TooTallNate/util-deprecate            |
| `vary`                      | 1.1.2   | MIT                       | jshttp/vary                                              |
| `which`                     | 2.0.2   | ISC                       | https://github.com/isaacs/node-which                     |
| `wrappy`                    | 1.0.2   | ISC                       | https://github.com/npm/wrappy                            |
| `zod`                       | 4.6.7   | MIT                       | https://github.com/colinhacks/zod                        |
| `zod-to-json-schema`        | 3.25.2  | ISC                       | https://github.com/StefanTerdell/zod-to-json-schema      |
| `zustand`                   | 5.0.15  | MIT                       | https://github.com/pmndrs/zustand                        |
