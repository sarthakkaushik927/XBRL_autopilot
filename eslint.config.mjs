import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        __XAP_TEST_BUILD__: 'readonly',
        React: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/triple-slash-reference': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-console': 'off',
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'warn',
      'prefer-const': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['engine/test/legacy/**', 'engine/compiler/**'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.venv/**',
      '**/release/**',
      '**/build/**',
      '**/.pytest_cache/**',
      '**/.ruff_cache/**',
      '**/data/**',
      '**/knowledge_base/**',
      '**/output/**',
      '**/notebooks/**',
      '**/sidecar-dist/**',
      '**/authority/**',
      'lagacy_js/**',
      'engine/test/legacy/**',
    ],
  }
);
