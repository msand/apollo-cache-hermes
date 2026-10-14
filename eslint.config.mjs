import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import jest from 'eslint-plugin-jest';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '.claude/', 'apollo-client/', 'dist/', 'output/', '**/*.js', '**/*.d.ts'],
  },

  js.configs.recommended,
  tseslint.configs.eslintRecommended,
  comments.recommended,

  {
    files: ['**/*.{ts,tsx}'],

    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin,
      // Registered as `import` so existing `eslint-disable import/...` directives keep working.
      import: importX,
      jest,
    },

    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },

    rules: {
      // https://eslint.org/docs/latest/rules/

      // Possible Errors

      'for-direction': 'error',
      'getter-return': 'error',
      'no-prototype-builtins': 'error',
      'no-undef': 'off', // enforced by TypeScript
      'no-unused-vars': 'off', // enforced by TypeScript
      'no-redeclare': 'off', // enforced by TypeScript
      // TODO: Newly recommended in ESLint 10; not yet enforced.
      'no-useless-assignment': 'off',
      'no-unassigned-vars': 'off',
      'preserve-caught-error': 'off',

      // Best Practices

      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'allow-null'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-labels': 'error',
      'no-new-func': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-return-await': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-with': 'error',
      radix: ['error', 'as-needed'],
      yoda: 'error',

      // Variables

      'no-label-var': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef-init': 'error',

      // Node.js and CommonJS

      'handle-callback-err': ['error', '^.*(e|E)rr(or)?'],
      'no-mixed-requires': 'error',
      'no-new-require': 'error',
      'no-path-concat': 'error',

      // Stylistic Issues (formatting is left to Prettier)

      'no-lonely-if': 'error',
      'no-object-constructor': 'error',
      'no-unneeded-ternary': 'error',
      'operator-assignment': 'error',
      'unicode-bom': 'error',

      // ES2015+

      'no-dupe-class-members': 'off', // Enforced by TypeScript
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-const': 'error',
      'prefer-destructuring': ['error', { array: false }],
      'prefer-numeric-literals': 'error',
      'prefer-rest-params': 'off', // Enabled by tseslint.configs.eslintRecommended
      'prefer-spread': 'error',
      'prefer-template': 'error',

      // https://github.com/un-ts/eslint-plugin-import-x#rules

      // Static Analysis:
      'import/no-unresolved': ['error', { caseSensitive: true, commonjs: true, amd: true }],
      // TODO: Figure out why some types aren't being treated as exports
      // 'import/named': 'error',
      'import/default': 'error',
      'import/namespace': 'error',
      'import/no-absolute-path': 'error',
      'import/no-dynamic-require': 'error',
      'import/no-self-import': 'error',

      // Helpful Warnings
      'import/no-extraneous-dependencies': ['error', { devDependencies: false }],
      'import/no-mutable-exports': 'error',
      'import/no-useless-path-segments': 'error',

      // Module Systems
      'import/no-commonjs': 'error',
      'import/no-amd': 'error',
      'import/no-nodejs-modules': 'error',

      // Style Guide
      'import/no-duplicates': 'error',
      'import/extensions': ['error', 'never'],
      'import/order': [
        'error',
        {
          groups: [['builtin', 'external'], ['internal'], ['parent'], ['sibling', 'index']],
          'newlines-between': 'always',
        },
      ],

      // https://typescript-eslint.io/rules/

      '@typescript-eslint/adjacent-overload-signatures': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase', 'camelCase'] },
        { selector: 'objectLiteralProperty', format: null, leadingUnderscore: 'allowDouble' },
        { selector: 'memberLike', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'interface', format: ['PascalCase', 'camelCase'] },
      ],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/triple-slash-reference': ['error', { path: 'never', types: 'never', lib: 'never' }],

      // https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/

      '@eslint-community/eslint-comments/no-use': [
        'error',
        { allow: ['eslint-disable-line', 'eslint-disable-next-line'] },
      ],

      // https://github.com/jest-community/eslint-plugin-jest#rules

      'jest/consistent-test-it': ['error', { fn: 'it' }],
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/no-test-prefixes': 'error',
    },
  },

  {
    files: ['test/**/*.{ts,tsx}'],

    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },

    rules: {
      'no-unused-expressions': 'off',
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      'import/no-nodejs-modules': 'off',
    },
  },

  {
    // The release scripts: plain Node scripts.
    files: ['scripts/**/*.mjs'],

    languageOptions: {
      globals: { ...globals.node },
    },
  },

  prettier,
);
