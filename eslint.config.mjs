// ESLint 9 flat config for all three workspaces (T-020).
// Rules: docs/work-packages/CONVENTIONS.md, CODING-GUIDELINES.md.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'library/**', '.ai/**', '.claude/**', 'samples/**', 'proxmox/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // W7: type-aware linting. The projects below cover every linted file – `*.test.ts` is excluded
    // from the build configs, so the `tsconfig.test.json` of a workspace is the one that includes it.
    languageOptions: {
      parserOptions: {
        project: ['./shared/tsconfig.test.json', './server/tsconfig.test.json', './web/tsconfig.json', './e2e/tsconfig.json'],
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      // a promise nobody awaits is a lost error or a race: the bug class B9 was made of. `test()`
      // and its siblings return a promise by definition and are the test runner's job to await.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['test', 'it', 'describe', 'before', 'after', 'beforeEach', 'afterEach'],
            },
          ],
        },
      ],
      // CONVENTIONS.md §4: strict TypeScript, no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      // R-12 removes the remaining non-null assertions; until then they are warnings.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // `_x` marks a parameter that a signature requires but the body does not use
      // (Express error handlers, callbacks).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain Node modules (`e2e/run-docker.mjs`, the mock host) are not part of a TypeScript project,
    // so the type-aware parser has nothing to check them against; they keep the non-typed rules.
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { parserOptions: { project: false } },
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    // The E2E suite (T-030): `@playwright/test` specs plus the Node runner script. Both are Node
    // modules with browser code inside `page.evaluate`, so the two global sets meet here.
    files: ['e2e/**/*.{ts,mjs}', 'playwright.config.ts'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // The v7 `recommended` presets switch on a whole React Compiler rule set (static-components, purity,
    // refs, …). T-027 keeps the rule set of v5 – the two rules – so the upgrade changes nothing here;
    // the extra rules are a separate task (R-12).
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
