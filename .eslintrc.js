module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname
  },
  plugins: ['node', 'prettier', '@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:prettier/recommended',
    'plugin:@typescript-eslint/recommended',
    // We need to enable this and fix all the errors
    // 'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier'
  ],
  env: {
    node: true
  },
  rules: {
    'prettier/prettier': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    curly: 1,
    eqeqeq: 1,

    // fix the any types at some point
    '@typescript-eslint/no-explicit-any': 'off',

    'no-duplicate-imports': 'error',
    '@typescript-eslint/switch-exhaustiveness-check': 'warn'
  },
  settings: {
    node: {
      tryExtensions: ['.js', '.json', '.node', '.ts', '.d.ts']
    }
  },
  ignorePatterns: ['.eslintrc.js', '*.config.js', 'config*', 'build/**', 'node_modules/**']
};
