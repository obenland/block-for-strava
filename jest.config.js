/**
 * Jest configuration for JS unit tests.
 *
 * Extends the @wordpress/scripts unit preset (jsdom + babel transform for
 * .ts/.tsx) and pins coverage thresholds at 100% so any uncovered branch
 * fails CI rather than silently slipping through.
 */
const wpScriptsConfig = require('@wordpress/scripts/config/jest-unit.config');

module.exports = {
	...wpScriptsConfig,
	rootDir: __dirname,
	setupFilesAfterEnv: [
		...(wpScriptsConfig.setupFilesAfterEnv || []),
		'<rootDir>/tests/js/setup.ts',
	],
	testMatch: ['<rootDir>/tests/js/**/*.test.[jt]s?(x)'],
	moduleNameMapper: {
		...(wpScriptsConfig.moduleNameMapper || {}),
		'^@wordpress/blocks$':
			'<rootDir>/tests/js/__mocks__/wordpress-blocks.ts',
		'^@wordpress/block-editor$':
			'<rootDir>/tests/js/__mocks__/wordpress-block-editor.tsx',
		'^@wordpress/components$':
			'<rootDir>/tests/js/__mocks__/wordpress-components.tsx',
	},
	collectCoverageFrom: ['src/**/*.{ts,tsx,js,jsx}', '!src/**/*.d.ts'],
	coverageDirectory: '<rootDir>/coverage/js',
	coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
};
