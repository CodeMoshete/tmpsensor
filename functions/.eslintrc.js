module.exports = {
  env: {
    es6: true,
    node: true
  },
  extends: 'airbnb-base',
  parserOptions: {
    ecmaVersion: 2020
  },
  rules: {
    'max-len': ['error', { code: 120 }],
    'comma-dangle': ['error', { functions: 'never' }],
    'no-console': 'off',
    // eslint-plugin-import's resolver doesn't understand the "exports" map that
    // firebase-functions/firebase-admin use for their subpath exports (e.g.
    // 'firebase-functions/v2/https') -- these all resolve fine at runtime.
    'import/no-unresolved': 'off'
  }
};
