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
		Block_For_Strava_OAuth::get_instance();
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
	 * Permission callback for editor-only REST routes.
	 *
	 * @return bool
	 */
	public function editor_permission(): bool {
		return current_user_can( 'edit_posts' );
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
				'permission_callback' => array( $this, 'editor_permission' ),
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

		register_rest_route(
			'block-for-strava/v1',
			'/oauth/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_oauth_status' ),
				'permission_callback' => array( $this, 'editor_permission' ),
			)
		);

		register_rest_route(
			'block-for-strava/v1',
			'/oauth/authorize-url',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_oauth_authorize_url' ),
				'permission_callback' => array( $this, 'editor_permission' ),
			)
		);

		register_rest_route(
			'block-for-strava/v1',
			'/oauth/disconnect',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'rest_oauth_disconnect' ),
				'permission_callback' => array( $this, 'editor_permission' ),
			)
		);

		register_rest_route(
			'block-for-strava/v1',
			'/activities',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_list_activities' ),
				'permission_callback' => array( $this, 'editor_permission' ),
				'args'                => array(
					'per_page' => array(
						'type'              => 'integer',
						'default'           => 10,
						'sanitize_callback' => 'absint',
					),
					'page'     => array(
						'type'              => 'integer',
						'default'           => 1,
						'sanitize_callback' => 'absint',
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
	 * Returns the connection status of the current user.
	 *
	 * @return WP_REST_Response
	 */
	public function rest_oauth_status(): WP_REST_Response {
		$token = Block_For_Strava_OAuth::get_token( get_current_user_id() );
		if ( null === $token ) {
			return new WP_REST_Response( array( 'connected' => false ) );
		}
		return new WP_REST_Response(
			array(
				'connected'        => true,
				'athlete'          => isset( $token['athlete'] ) && is_array( $token['athlete'] ) ? $token['athlete'] : array(),
				'scope'            => isset( $token['scope'] ) ? (string) $token['scope'] : '',
				'hasActivityScope' => Block_For_Strava_OAuth::has_activity_scope( $token ),
			)
		);
	}

	/**
	 * Returns the proxy authorize URL for the current user.
	 *
	 * @return WP_REST_Response
	 */
	public function rest_oauth_authorize_url(): WP_REST_Response {
		$oauth = Block_For_Strava_OAuth::get_instance();
		return new WP_REST_Response(
			array( 'url' => $oauth->build_authorize_url( get_current_user_id() ) )
		);
	}

	/**
	 * Disconnects the current user from Strava.
	 *
	 * Calls Strava's deauthorize endpoint first so the app is also removed
	 * from the athlete's Strava → Apps settings page, then deletes the
	 * locally stored token.
	 *
	 * @return WP_REST_Response
	 */
	public function rest_oauth_disconnect(): WP_REST_Response {
		$user_id = get_current_user_id();
		Block_For_Strava_API::deauthorize( $user_id );
		Block_For_Strava_OAuth::delete_token( $user_id );
		return new WP_REST_Response( array( 'connected' => false ) );
	}

	/**
	 * Lists activities for the connected user.
	 *
	 * @param  WP_REST_Request $request The REST request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_list_activities( WP_REST_Request $request ) {
		$result = Block_For_Strava_API::get_activities(
			get_current_user_id(),
			array(
				'per_page' => max( 1, min( 30, (int) $request->get_param( 'per_page' ) ) ),
				'page'     => max( 1, (int) $request->get_param( 'page' ) ),
			)
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$activities = array();
		if ( is_array( $result ) ) {
			foreach ( $result as $activity ) {
				if ( ! is_array( $activity ) || empty( $activity['id'] ) ) {
					continue;
				}

				/*
				 * Per Strava's API conventions, start_date_local is the UTC
				 * representation of the local start time of the activity. The
				 * editor renders it without further timezone conversion so
				 * the date displayed matches the athlete's actual local day.
				 */
				$start_date_local = isset( $activity['start_date_local'] ) ? (string) $activity['start_date_local'] : '';
				if ( '' === $start_date_local && isset( $activity['start_date'] ) ) {
					$start_date_local = (string) $activity['start_date'];
				}

				$activities[] = array(
					'id'        => (string) $activity['id'],
					'name'      => isset( $activity['name'] ) ? (string) $activity['name'] : '',
					'type'      => isset( $activity['type'] ) ? (string) $activity['type'] : '',
					'distance'  => isset( $activity['distance'] ) ? (float) $activity['distance'] : 0.0,
					'startDate' => $start_date_local,
					'private'   => ! empty( $activity['private'] ),
				);
			}
		}
		return new WP_REST_Response( array( 'activities' => $activities ) );
	}

	/**
	 * Renders the block on the frontend.
	 *
	 * Only outputs the activity ID + Strava's official embed.js. We must NOT
	 * render any data fetched via the Strava API here: the API agreement
	 * restricts displaying API-sourced Strava Data to the connected user, and
	 * the public-facing post is seen by everyone. The Strava-controlled embed
	 * script is the only sanctioned way to show activity content on the
	 * frontend.
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

		$style = 'large' === ( $attributes['style'] ?? '' ) ? 'large' : 'standard';
		$token = sanitize_text_field( $attributes['token'] ?? '' );

		wp_enqueue_script(
			'strava-embeds',
			'https://strava-embeds.com/embed.js',
			array(),
			null, // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
			true
		);

		$token_attr = $token ? ' data-token="' . esc_attr( $token ) . '"' : '';

		return sprintf(
			'<div %s><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="%s" data-style="%s"%s></div></div>',
			get_block_wrapper_attributes(),
			esc_attr( $activity_id ),
			esc_attr( $style ),
			$token_attr
		);
	}
}
