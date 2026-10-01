// Lint rules: ESLint's recommended correctness checks, nothing stylistic
// (formatting is Prettier's job). Run with `npm run lint`.
'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      // The same files run in the browser and in Node (UMD modules, tests, scripts).
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // `catch {}` marks deliberately ignored failures (e.g. an iOS-only API that is missing).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
