// ESLint 9 flat config for all three workspaces (T-020, Q1: `defineConfig` + `projectService`).
// Rules: docs/work-packages/CONVENTIONS.md, CODING-GUIDELINES.md.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'library/**', '.ai/**', '.claude/**', 'samples/**', 'proxmox/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Type-aware linting (W7). `projectService` finds the nearest tsconfig per file instead of a
    // hand-kept `project` list; every workspace's `tsconfig.json` therefore includes its `*.test.ts`
    // files and the emit settings live in `tsconfig.build.json`.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
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
    languageOptions: { parserOptions: { projectService: false } },
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
    // q3-server-routes: a route validates, calls one service and answers. The queue (`jobs`) and the
    // PrusaSlicer layer (`slicer`) are reached through `services/`, never directly.
    files: ['server/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../slicer', '../slicer/*', '../slicer/**'],
              message: 'Routes call services only (q3-server-routes): import the use case from services/.',
            },
            {
              group: ['../jobs', '../jobs.js', '../jobs/*', '../jobs/**'],
              message: 'Routes call services only (q3-server-routes): use services/jobs.',
            },
          ],
        },
      ],
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
