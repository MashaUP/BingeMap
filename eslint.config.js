// Controllo statico (npm run lint): variabili non definite, codice irraggiungibile, errori comuni.
// Introdotto con l'audit 1.3.2: un nome fuori portata nel popup bloccava il collegamento del sito senza che i test se ne accorgessero.
import globals from 'globals';
import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', '_site/**', 'web/vendor/**', '**/*.min.js'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error',
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
    },
  },
  { files: ['src/content/**/*.js'], languageOptions: { sourceType: 'script' } },
];
