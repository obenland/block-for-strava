<?php
/**
 * Plugin Name: Block for Strava
 * Plugin URI:  https://wordpress.org/plugins/block-for-strava/
 * Description: Embed public Strava activities on your site using a simple block.
 * Version:     1.0.0
 * Author:      Konstantin Obenland
 * Author URI:  https://obenland.it/
 * Text Domain: block-for-strava
 * Requires at least: 6.0
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

require_once BLOCK_FOR_STRAVA_DIR . 'includes/functions.php';
require_once BLOCK_FOR_STRAVA_DIR . 'includes/class-block-for-strava.php';

/**
 * Initializes the plugin.
 */
function block_for_strava_init(): void {
	Block_For_Strava::get_instance();
}
add_action( 'init', 'block_for_strava_init' );
