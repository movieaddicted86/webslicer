// ESLint 9 flat config for all three workspaces (T-020).
// Rules: docs/work-packages/CONVENTIONS.md, CODING-GUIDELINES.md.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'library/**', '.ai/**', '.claude/**', 'samples/**', 'proxmox/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
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
