const defaultConfig = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...defaultConfig,
	moduleNameMapper: {
		'\\.(scss|css)$': require.resolve(
			'@wordpress/jest-preset-default/scripts/style-mock.js'
		),
		'^@wordpress/blocks$':
			'<rootDir>/tests/js/__mocks__/wordpress-blocks.ts',
		'^@wordpress/block-editor$':
			'<rootDir>/tests/js/__mocks__/wordpress-block-editor.tsx',
		'^@wordpress/components$':
			'<rootDir>/tests/js/__mocks__/wordpress-components.tsx',
		'^@wordpress/api-fetch$':
			'<rootDir>/tests/js/__mocks__/wordpress-api-fetch.ts',
	},
	setupFilesAfterEnv: [ '<rootDir>/tests/js/setup.ts' ],
	collectCoverageFrom: [ 'src/**/*.{ts,tsx}', '!src/**/*.d.ts' ],
	coverageDirectory: '<rootDir>/coverage/js',
	coverageReporters: [ 'text', 'lcov', 'json-summary' ],
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
};
