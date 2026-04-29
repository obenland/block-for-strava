<?php
/**
 * Plugin Name: Block for Strava
 * Plugin URI:  https://wordpress.org/plugins/block-for-strava/
 * Description: Embed public Strava activities, routes, and segments via a core/embed block variation.
 * Version:     1.0.0
 * Author:      Konstantin Obenland
 * Author URI:  https://obenland.it/
 * Text Domain: block-for-strava
 * Requires at least: 6.6
 * Requires PHP: 8.1
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 *
 * Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.
 *
 * @package BlockForStrava
 */

defined( 'ABSPATH' ) || exit;

define( 'BLOCK_FOR_STRAVA_VERSION', '1.0.0' );
define( 'BLOCK_FOR_STRAVA_DIR', plugin_dir_path( __FILE__ ) );

require_once BLOCK_FOR_STRAVA_DIR . 'includes/class-strava-embed.php';

/**
 * Initializes the plugin: registers the oEmbed hijack so Strava URLs flow
 * through the standard core/embed pipeline server-side.
 */
function block_for_strava_init(): void {
	Block_For_Strava_Embed::init();
}
add_action( 'init', 'block_for_strava_init' );

/**
 * Enqueues the editor-side bundle that registers the `core/embed` variation
 * for Strava and the paragraph→embed transform.
 */
function block_for_strava_enqueue_editor_assets(): void {
	$asset_file = BLOCK_FOR_STRAVA_DIR . 'build/index.asset.php';
	if ( ! file_exists( $asset_file ) ) {
		return;
	}
	$asset = require $asset_file;
	wp_enqueue_script(
		'block-for-strava-variation',
		plugins_url( 'build/index.js', __FILE__ ),
		$asset['dependencies'],
		$asset['version'],
		true
	);

	wp_set_script_translations( 'block-for-strava-variation', 'block-for-strava' );
}
add_action( 'enqueue_block_editor_assets', 'block_for_strava_enqueue_editor_assets' );
