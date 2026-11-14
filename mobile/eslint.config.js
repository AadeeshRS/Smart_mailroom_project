const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
// ponytail: React Compiler rules added by eslint-config-expo 58 flag pre-existing ref/clock patterns in reviewed screens; re-enable when those screens are refactored.
const compilerRulesOff = { rules: { 'react-hooks/refs': 'off', 'react-hooks/purity': 'off', 'react-hooks/set-state-in-effect': 'off' } };
module.exports = defineConfig([expoConfig, compilerRulesOff, { ignores: ['dist/*', 'dist-http/**', 'coverage/*', 'test-results/*', 'playwright-report/*', '.expo/*'] }]);
