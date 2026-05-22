'use strict';

const {FlatCompat} = require('@eslint/eslintrc');
const globals = require('globals');
const path = require('path');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: path.join(__dirname, 'node_modules', 'eslint-config-loopback'),
});

module.exports = [
  {
    ignores: ['coverage/**', 'node_modules/**', 'deps/**', '.yarn/**'],
  },
  ...compat.extends('loopback'),
  {
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      'max-len': ['error', 120, 4, {
        ignoreComments: true,
        ignoreUrls: true,
        ignorePattern: '^\\s*var\\s.+=\\s*(require\\s*\\()|(/)',
      }],
      // eslint-plugin-mocha@11 renamed/removed rules that loopback config still references.
      // Disable to keep lint runnable; Phase 2 migrates off mocha anyway.
      'mocha/handle-done-callback': 'off',
      'mocha/no-exclusive-tests': 'off',
      'mocha/no-identical-title': 'off',
      'mocha/no-nested-tests': 'off',
    },
  },
];
