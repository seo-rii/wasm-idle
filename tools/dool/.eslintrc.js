module.exports = {
    env: {
        browser: true,
        node: true,
        es6: true,
    },
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'react'],
    extends: ['react-app', 'prettier'],
    globals: {
        __PATH_PREFIX__: true,
        Atomics: `readonly`,
        SharedArrayBuffer: `readonly`,
    },
    parserOptions: {
        ecmaFeatures: {
            jsx: true,
        },
        ecmaVersion: 2018,
        sourceType: `module`,
    },
    settings: {
        react: {
            version: 'detect',
        },
    },
    ignorePatterns: ['node_modules/', 'build/'],
}
