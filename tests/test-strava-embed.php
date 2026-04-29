<?php
/**
 * Tests for the Strava oEmbed hijack.
 *
 * Covers the three integration points that make a pasted Strava URL flow
 * through `core/embed` without Strava providing oEmbed: the
 * `pre_oembed_result` short-circuit, the `/oembed/1.0/proxy` REST fallback,
 * and the `wp_embed_register_handler` autoembed callbacks.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for Block_For_Strava_Embed.
 */
class Test_Strava_Embed extends WP_UnitTestCase {

	/**
	 * Asserts the iframe HTML carries the expected Strava placeholder data.
	 *
	 * The data: URL is base64 so we decode it and pull the placeholder div
	 * out of the inner document; locking down the inner shape stops a future
	 * change from quietly breaking the embed.js handshake.
	 *
	 * @param  string $html        The iframe HTML to inspect.
	 * @param  string $embed_type  Expected `data-embed-type`.
	 * @param  string $activity_id Expected `data-embed-id`.
	 */
	private function assertStravaIframe( string $html, string $embed_type, string $activity_id ): void {
		$this->assertMatchesRegularExpression( '/^<iframe\s/', $html );
		$this->assertStringContainsString( 'class="strava-embed-iframe"', $html );

		$this->assertSame( 1, preg_match( '/src="data:text\/html;charset=utf-8;base64,([^"]+)"/', $html, $matches ) );
		$decoded = base64_decode( $matches[1], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$this->assertNotFalse( $decoded );
		$this->assertStringContainsString(
			sprintf( 'data-embed-id="%s"', $activity_id ),
			$decoded
		);
		$this->assertStringContainsString(
			sprintf( 'data-embed-type="%s"', $embed_type ),
			$decoded
		);
		$this->assertStringContainsString(
			// phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript -- String literal: this is the expected payload, not a real script tag.
			'<script src="https://strava-embeds.com/embed.js"></script>',
			$decoded
		);
	}

	/**
	 * Confirms a canonical activity URL short-circuits oEmbed with our iframe.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_returns_iframe_for_canonical_activity_url(): void {
		$result = apply_filters( 'pre_oembed_result', null, 'https://www.strava.com/activities/18233733854', array() );
		$this->assertIsString( $result );
		$this->assertStravaIframe( $result, 'activity', '18233733854' );
	}

	/**
	 * Confirms a canonical route URL short-circuits oEmbed with our iframe.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_returns_iframe_for_route_url(): void {
		$result = apply_filters( 'pre_oembed_result', null, 'https://www.strava.com/routes/3379104463896442748', array() );
		$this->assertIsString( $result );
		$this->assertStravaIframe( $result, 'route', '3379104463896442748' );
	}

	/**
	 * Confirms a canonical segment URL short-circuits oEmbed with our iframe.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_returns_iframe_for_segment_url(): void {
		$result = apply_filters( 'pre_oembed_result', null, 'https://www.strava.com/segments/789', array() );
		$this->assertIsString( $result );
		$this->assertStravaIframe( $result, 'segment', '789' );
	}

	/**
	 * Non-Strava URLs must fall through so other providers/handlers can run.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_passes_through_non_strava_url(): void {
		$result = apply_filters( 'pre_oembed_result', null, 'https://example.com/foo', array() );
		$this->assertNull( $result );
	}

	/**
	 * The filter contract is "return null to fall through, return string to
	 * short-circuit". A previously-set non-null result must survive — without
	 * this short-circuit our handler would clobber a faster cache hit.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_does_not_clobber_existing_result(): void {
		$existing = '<iframe src="https://example.com/oembed"></iframe>';
		$result   = apply_filters( 'pre_oembed_result', $existing, 'https://www.strava.com/activities/123', array() );
		$this->assertSame( $existing, $result );
	}

	/**
	 * Short URLs follow a remote redirect chain via `wp_safe_remote_head`.
	 * Stub HTTP so the test stays deterministic and offline.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_resolves_short_url(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => array( 'location' => 'https://www.strava.com/activities/99999' ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$result = apply_filters( 'pre_oembed_result', null, 'https://strava.app.link/abcd', array() );

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertIsString( $result );
		$this->assertStravaIframe( $result, 'activity', '99999' );
	}

	/**
	 * Canonical URL handler returns a Strava iframe for valid input.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler_canonical
	 */
	public function test_embed_handler_canonical_builds_iframe(): void {
		$html = Block_For_Strava_Embed::embed_handler_canonical(
			array(
				0 => 'https://www.strava.com/activities/123',
				1 => 'activities',
				2 => '123',
			)
		);
		$this->assertIsString( $html );
		$this->assertStravaIframe( $html, 'activity', '123' );
	}

	/**
	 * Canonical URL handler must refuse paths that aren't activity/route/segment.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler_canonical
	 */
	public function test_embed_handler_canonical_rejects_unknown_segment(): void {
		$result = Block_For_Strava_Embed::embed_handler_canonical(
			array(
				0 => 'https://www.strava.com/clubs/1',
				1 => 'clubs',
				2 => '1',
			)
		);
		$this->assertFalse( $result );
	}

	/**
	 * Short URL handler must return false (not bad HTML) when resolution fails,
	 * so `WP_Embed::shortcode()` falls through to leaving the URL bare.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler_short
	 */
	public function test_embed_handler_short_returns_false_on_resolve_failure(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return new WP_Error( 'http_failed', 'simulated network error' );
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$result = Block_For_Strava_Embed::embed_handler_short(
			array( 0 => 'https://strava.app.link/broken' )
		);

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertFalse( $result );
	}

	/**
	 * Canonical URL handler must refuse non-numeric ids that embed.js can't render.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler_canonical
	 */
	public function test_embed_handler_canonical_rejects_non_numeric_id(): void {
		$result = Block_For_Strava_Embed::embed_handler_canonical(
			array(
				0 => 'https://www.strava.com/activities/abc',
				1 => 'activities',
				2 => 'abc',
			)
		);
		$this->assertFalse( $result );
	}

	/**
	 * `wp_embed_register_handler` returns autoembed HTML when post content
	 * contains a bare URL. This integration test runs the URL through
	 * `WP_Embed::shortcode()` like autoembed does.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler_canonical
	 */
	public function test_autoembed_replaces_bare_canonical_url(): void {
		global $wp_embed;
		$html = $wp_embed->shortcode( array(), 'https://www.strava.com/activities/18233733854' );
		$this->assertIsString( $html );
		$this->assertStravaIframe( $html, 'activity', '18233733854' );
	}

	/**
	 * Confirms the REST proxy fallback rewrites a 404 oEmbed response into
	 * a valid embed payload for Strava URLs. Without this, the editor's
	 * paste-URL flow throws "Sorry, this content could not be embedded."
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_rewrites_strava_response(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$request = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://www.strava.com/activities/18233733854' );
		$request->set_param( '_wpnonce', wp_create_nonce( 'wp_rest' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertIsObject( $data );
		$this->assertSame( 'rich', $data->type );
		$this->assertSame( 'Strava', $data->provider_name );
		$this->assertStravaIframe( $data->html, 'activity', '18233733854' );
	}

	/**
	 * Other REST endpoints must not see their responses mutated by the filter.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_ignores_non_proxy_routes(): void {
		$response = new WP_REST_Response( array( 'foo' => 'bar' ) );
		$request  = new WP_REST_Request( 'GET', '/wp/v2/posts' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $response, array(), $request );

		$this->assertSame( $response, $result );
	}

	/**
	 * If a previous filter already set valid HTML we must leave it alone.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_passes_through_when_html_already_present(): void {
		$existing = (object) array( 'html' => '<iframe src="https://example.com"></iframe>' );
		$response = new WP_REST_Response( $existing );
		$request  = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://www.strava.com/activities/123' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $response, array(), $request );

		$this->assertSame( $response, $result );
		$this->assertSame( $existing, $result->get_data() );
	}

	/**
	 * Auth/permission errors on Strava URLs must propagate so the editor
	 * can react (re-auth, retry) instead of seeing a synthesized success
	 * payload that hides the real failure.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_propagates_non_oembed_errors_for_strava_urls(): void {
		$err     = new WP_Error( 'rest_cookie_invalid_nonce', 'nope', array( 'status' => 403 ) );
		$request = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://www.strava.com/activities/18233733854' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $err, array(), $request );

		$this->assertSame( $err, $result );
	}

	/**
	 * Errors for non-Strava URLs must propagate untouched.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_passes_through_non_strava_error(): void {
		$err     = new WP_Error( 'oembed_invalid_url', 'nope', array( 'status' => 404 ) );
		$request = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://example.com/post/1' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $err, array(), $request );

		$this->assertSame( $err, $result );
	}
}
