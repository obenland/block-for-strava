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

		$parsed = block_for_strava_parse_strava_url( $url );

		if ( false === $parsed ) {
			$resolved = block_for_strava_resolve_strava_url( $url );
			if ( is_wp_error( $resolved ) ) {
				return $resolved;
			}
			$parsed = block_for_strava_parse_strava_url( $resolved );
		}

		if ( false === $parsed ) {
			return new WP_Error(
				'invalid_strava_url',
				__( 'Could not extract a Strava activity, route, or segment ID from the provided URL.', 'block-for-strava' ),
				array( 'status' => 400 )
			);
		}

		return new WP_REST_Response(
			array(
				'activityId' => $parsed['id'],
				'embedType'  => $parsed['type'],
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
		$activity_id    = sanitize_text_field( $attributes['activityId'] ?? '' );
		$saved_type_raw = sanitize_text_field( $attributes['embedType'] ?? '' );
		$embed_type     = in_array( $saved_type_raw, array( 'activity', 'route', 'segment' ), true )
			? $saved_type_raw
			: 'activity';

		if ( ! $activity_id ) {
			$url = sanitize_url( $attributes['url'] ?? '' );
			if ( $url ) {
				$resolved = block_for_strava_resolve_strava_url( $url );
				if ( ! is_wp_error( $resolved ) ) {
					$parsed = block_for_strava_parse_strava_url( $resolved );
					if ( false !== $parsed ) {
						$activity_id = $parsed['id'];
						$embed_type  = $parsed['type'];
					}
				}
			}
		}

		if ( ! $activity_id ) {
			return '';
		}

		$caption_raw = $attributes['caption'] ?? '';
		$caption     = is_string( $caption_raw ) ? $caption_raw : '';

		wp_enqueue_script(
			'strava-embeds',
			'https://strava-embeds.com/embed.js',
			array(),
			null, // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
			true
		);

		$caption_html = '';
		$kses_caption = wp_kses_post( $caption );
		if ( '' !== trim( wp_strip_all_tags( $kses_caption ) ) ) {
			$caption_html = sprintf(
				'<figcaption class="wp-element-caption">%s</figcaption>',
				$kses_caption
			);
		}

		$extra_data_attrs = 'route' === $embed_type
			? $this->build_route_data_attrs( $attributes )
			: ' data-style="standard"';

		return sprintf(
			'<figure %s><div class="strava-embed-placeholder" data-embed-type="%s" data-embed-id="%s"%s></div>%s</figure>',
			get_block_wrapper_attributes(),
			esc_attr( $embed_type ),
			esc_attr( $activity_id ),
			$extra_data_attrs,
			$caption_html
		);
	}

	/**
	 * Builds the route-specific data-* attribute string for the placeholder div.
	 *
	 * Strava's embed.js spreads these attributes into the inner iframe URL as
	 * query params, so omitting an attribute lets the embed fall back to its
	 * own default. Each returned segment is space-prefixed so callers can
	 * concatenate directly.
	 *
	 * @param  array $attributes The block attributes.
	 * @return string The serialized data-* attribute fragment.
	 */
	private function build_route_data_attrs( array $attributes ): string {
		$map_style = sanitize_text_field( $attributes['routeMapStyle'] ?? '' );
		if ( ! in_array(
			$map_style,
			array( 'standard', 'satellite', 'hybrid', 'dark', 'winter', 'light' ),
			true
		) ) {
			$map_style = 'standard';
		}
		$units = sanitize_text_field( $attributes['routeUnits'] ?? '' );
		if ( ! in_array( $units, array( 'auto', 'metric', 'imperial' ), true ) ) {
			$units = 'auto';
		}
		$terrain = sanitize_text_field( $attributes['routeTerrain'] ?? '' );
		if ( ! in_array( $terrain, array( 'auto', '2d', '3d' ), true ) ) {
			$terrain = 'auto';
		}

		$show_elevation = $this->bool_attr( $attributes, 'routeShowElevation', true );
		$full_width     = $this->bool_attr( $attributes, 'routeFullWidth', false );
		$show_dirt      = $this->bool_attr( $attributes, 'routeShowDirt', false );

		$out = sprintf( ' data-style="%s"', esc_attr( $map_style ) );
		if ( ! $show_elevation ) {
			$out .= ' data-hide-elevation="true"';
		}
		if ( 'auto' !== $units ) {
			$out .= sprintf( ' data-units="%s"', esc_attr( $units ) );
		}
		if ( $full_width ) {
			$out .= ' data-full-width="true"';
		}
		if ( 'auto' !== $terrain ) {
			$out .= sprintf( ' data-terrain="%s"', esc_attr( $terrain ) );
		}
		if ( $show_dirt ) {
			$out .= ' data-surface-type="true"';
		}
		return $out;
	}

	/**
	 * Reads a boolean block attribute, falling back to the default for anything
	 * that isn't a real boolean. A hand-edited block comment can persist these
	 * as strings, and `(bool) "false"` is `true` — silently inverting the
	 * user's intent. Strict-type matching here mirrors `clampBool` in edit.tsx
	 * so the editor preview and the front-end agree.
	 *
	 * @param  array  $attributes  The block attributes.
	 * @param  string $key         The attribute name to read.
	 * @param  bool   $default_val The value to return when missing or not a bool.
	 * @return bool
	 */
	private function bool_attr( array $attributes, string $key, bool $default_val ): bool {
		return isset( $attributes[ $key ] ) && is_bool( $attributes[ $key ] )
			? $attributes[ $key ]
			: $default_val;
	}
}
