/**
 * Extend the @wordpress/scripts default webpack config so the compiled bundle
 * ships with an explicit GPL-2.0-or-later license header. The default
 * minimizer strips comments other than `translators:`, so we replace it with
 * one whose comment filter also keeps the banner.
 */

const webpack = require( 'webpack' );
const TerserPlugin = require( 'terser-webpack-plugin' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );

const banner = [
	'Block for Strava',
	'Copyright (C) Konstantin Obenland',
	'',
	'License: GPL-2.0-or-later',
	'License URI: https://www.gnu.org/licenses/gpl-2.0.html',
].join( '\n' );

module.exports = {
	...defaultConfig,
	plugins: [
		...( defaultConfig.plugins || [] ),
		new webpack.BannerPlugin( { banner, entryOnly: true } ),
	],
	optimization: {
		...defaultConfig.optimization,
		minimizer: [
			new TerserPlugin( {
				parallel: true,
				terserOptions: {
					output: {
						comments: /translators:|License: GPL/i,
					},
					compress: { passes: 2 },
					mangle: { reserved: [ '__', '_n', '_nx', '_x' ] },
				},
				extractComments: false,
			} ),
		],
	},
};
