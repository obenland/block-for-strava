<?php
/**
 * Main plugin class for Block for Strava.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Main plugin class.
 */
class Block_For_Strava {

	/**
	 * Singleton instance.
	 *
	 * @var Block_For_Strava|null
	 */
	private static ?Block_For_Strava $instance = null;

	/**
	 * Returns the singleton instance.
	 *
	 * @return Block_For_Strava
	 */
	public static function get_instance(): Block_For_Strava {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		$this->register_block();
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Registers the block type.
	 */
	private function register_block(): void {
		register_block_type(
			BLOCK_FOR_STRAVA_DIR . 'build',
			array(
				'render_callback' => array( $this, 'render_block' ),
			)
		);
	}

	/**
	 * Registers the REST API routes.
	 */
	public function register_rest_routes(): void {
		register_rest_route(
			'block-for-strava/v1',
			'/resolve',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_resolve_url' ),
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
				'args'                => array(
					'url' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_url',
						'validate_callback' => function ( $value ) {
							return ! empty( $value ) && filter_var( $value, FILTER_VALIDATE_URL ) !== false;
						},
					),
				),
			)
		);
	}

	/**
	 * Handles the REST request to resolve a Strava URL.
	 *
	 * @param  WP_REST_Request $request The REST request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_resolve_url( WP_REST_Request $request ) {
		$url = $request->get_param( 'url' );

		$activity_id = block_for_strava_parse_activity_id( $url );

		if ( false === $activity_id ) {
			$resolved = block_for_strava_resolve_strava_url( $url );
			if ( is_wp_error( $resolved ) ) {
				return $resolved;
			}
			$activity_id = block_for_strava_parse_activity_id( $resolved );
		}

		if ( false === $activity_id ) {
			return new WP_Error(
				'invalid_strava_url',
				__( 'Could not extract a Strava activity ID from the provided URL.', 'block-for-strava' ),
				array( 'status' => 400 )
			);
		}

		$token = block_for_strava_fetch_activity_token( $activity_id );

		return new WP_REST_Response(
			array_filter(
				array(
					'activityId' => $activity_id,
					'token'      => $token,
				)
			)
		);
	}

	/**
	 * Renders the block on the frontend.
	 *
	 * @param  array $attributes The block attributes.
	 * @return string The rendered HTML.
	 */
	public function render_block( array $attributes ): string {
		$activity_id = sanitize_text_field( $attributes['activityId'] ?? '' );
		if ( ! $activity_id ) {
			$url = sanitize_url( $attributes['url'] ?? '' );
			if ( $url ) {
				$resolved = block_for_strava_resolve_strava_url( $url );
				if ( ! is_wp_error( $resolved ) ) {
					$activity_id = block_for_strava_parse_activity_id( $resolved );
				}
			}
		}

		if ( ! $activity_id ) {
			return '';
		}

		$token       = sanitize_text_field( $attributes['token'] ?? '' );
		$caption_raw = $attributes['caption'] ?? '';
		$caption     = is_string( $caption_raw ) ? $caption_raw : '';

		wp_enqueue_script(
			'strava-embeds',
			'https://strava-embeds.com/embed.js',
			array(),
			null, // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
			true
		);

		$token_attr   = $token ? ' data-token="' . esc_attr( $token ) . '"' : '';
		$caption_html = '';
		$kses_caption = wp_kses_post( $caption );
		if ( '' !== trim( wp_strip_all_tags( $kses_caption ) ) ) {
			$caption_html = sprintf(
				'<figcaption class="wp-element-caption">%s</figcaption>',
				$kses_caption
			);
		}

		return sprintf(
			'<figure %s><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="%s" data-style="standard"%s></div>%s</figure>',
			get_block_wrapper_attributes(),
			esc_attr( $activity_id ),
			$token_attr,
			$caption_html
		);
	}
}
