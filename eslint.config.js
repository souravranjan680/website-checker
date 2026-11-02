// ESLint finds likely bugs and bad patterns without running the code.
// Run: npm run lint
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-test/**',
      '**/dist-keyed/**',
      'apps/extension/release/**',
      '**/coverage/**',
      'packages/db/src/generated/**',
      'packages/db/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Security (docs/05-security.md): raw SQL built from strings enables SQL injection.
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use the $queryRaw`...` tagged template instead.' },
        {
          property: '$executeRawUnsafe',
          message: 'Use the $executeRaw`...` tagged template instead.',
        },
      ],
      // Security: scanned websites' HTML must only ever be shown as text.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render text instead; scanned HTML is untrusted.',
        },
      ],
    },
  },
  {
    // The test-database reset truncates tables whose names come from Postgres itself.
    files: ['packages/db/test/**', 'apps/api/test/**', 'apps/scanner/test/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
