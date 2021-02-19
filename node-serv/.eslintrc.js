module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  extends: 'airbnb-base',
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 2018,
  },
  rules: {
    'max-len': ['error', { 'code': 120 }],
    'operator-linebreak': ['error', 'after', { 'overrides': {
      '?': 'before',
      ':': 'before',
      '=': 'ignore',
    }}],
    'comma-dangle': ["error", {"functions": "never"}],
  },
};