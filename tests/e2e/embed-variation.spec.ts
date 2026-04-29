import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * End-to-end coverage for the Strava core/embed variation flow.
 *
 * Exercises the two seams that turn a pasted Strava URL into a working embed:
 *
 * 1. Paste a Strava URL into a fresh post → core/embed picks up the
 *    `strava` variation (`is-provider-strava` class on the block).
 * 2. Saved post renders an iframe pointing directly at strava-embeds.com
 *    via `wp_embed_register_handler`, with the defense-in-depth sandbox
 *    flags and `referrerpolicy=origin` intact.
 *
 * The REST `/oembed/1.0/proxy` rewrite is covered by the PHP integration
 * test in tests/test-strava-embed.php; replicating it here would only add
 * cookie-juggling without surfacing a different failure mode.
 */

/**
 * Runs a wp-cli command inside the wp-env container.
 *
 * @param args Arguments to append after `wp` in the container.
 */
function wp( args: string ): string {
	return execSync( `npx wp-env run cli wp ${ args }`, {
		stdio: [ 'ignore', 'pipe', 'inherit' ],
		cwd: process.cwd(),
	} )
		.toString()
		.trim();
}

/**
 * Logs into wp-admin as the default admin user.
 *
 * @param page Playwright page.
 */
async function loginAsAdmin( page: Page ): Promise< void > {
	await page.goto( '/wp-login.php' );
	await page.locator( '#user_login' ).fill( 'admin' );
	await page.locator( '#user_pass' ).fill( 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.waitForURL( /wp-admin/ );
}

/**
 * Waits for the block editor canvas iframe and dismisses the welcome guide.
 *
 * @param page Playwright page.
 */
async function waitForEditor( page: Page ): Promise< void > {
	await page
		.locator( 'iframe[name="editor-canvas"]' )
		.waitFor( { timeout: 15000 } );
	const guide = page.getByRole( 'dialog', { name: /welcome/i } );
	if ( await guide.isVisible( { timeout: 2000 } ).catch( () => false ) ) {
		await guide.getByRole( 'button', { name: /close/i } ).click();
	}
}

/**
 * Publishes a post with the given content and returns its ID synchronously.
 *
 * Returning synchronously lets the caller assign the ID into the test's
 * outer `postId` *before* any async assertion runs — otherwise a failed
 * expect inside a helper would leak a published post that `afterEach`
 * can't see.
 *
 * @param title   Post title.
 * @param content Raw post_content (typically a bare Strava URL).
 */
function publishPostWithContent( title: string, content: string ): string {
	return wp(
		`post create --post_title=${ JSON.stringify(
			title
		) } --post_content=${ JSON.stringify(
			content
		) } --post_status=publish --porcelain`
	);
}

/**
 * Loads the published post and returns the `src` of the Strava embed iframe.
 * Blocks strava-embeds.com so the test doesn't depend on the upstream embed
 * page actually loading; the URL on the iframe is the contract we own.
 *
 * @param page   Playwright page.
 * @param postId Post ID returned by `publishPostWithContent`.
 */
async function fetchAutoembedIframeSrc(
	page: Page,
	postId: string
): Promise< string > {
	await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
	await page.goto( `/?p=${ postId }` );

	const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
	await expect( iframe ).toBeAttached();
	return ( await iframe.getAttribute( 'src' ) ) ?? '';
}

const AUTOEMBED_CASES = [
	{
		name: 'activity',
		url: 'https://www.strava.com/activities/18233733854',
		expectedSrc: 'https://strava-embeds.com/activity/18233733854',
	},
	{
		name: 'route',
		url: 'https://www.strava.com/routes/3379104463896442748',
		expectedSrc: 'https://strava-embeds.com/route/3379104463896442748',
	},
	{
		name: 'segment',
		url: 'https://www.strava.com/segments/789',
		expectedSrc: 'https://strava-embeds.com/segment/789',
	},
] as const;

test.describe.serial( 'Strava core/embed variation', () => {
	let postId: string;

	test.afterEach( () => {
		if ( postId ) {
			wp( `post delete ${ postId } --force` );
			postId = '';
		}
	} );

	for ( const { name, url, expectedSrc } of AUTOEMBED_CASES ) {
		test( `frontend: ${ name } URL autoembeds via wp_embed_register_handler`, async ( {
			page,
		} ) => {
			postId = publishPostWithContent(
				`Strava ${ name } autoembed`,
				url
			);
			const src = await fetchAutoembedIframeSrc( page, postId );
			expect( src ).toBe( expectedSrc );
		} );
	}

	test( 'frontend: route block_attrs append Strava URL params to the iframe', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		const attrs = {
			providerNameSlug: 'strava',
			url: `https://www.strava.com/routes/${ routeId }`,
			responsive: true,
			stravaRouteMapStyle: 'satellite',
			stravaRouteUnits: 'metric',
			stravaRouteFullWidth: true,
			stravaRouteShowDirt: true,
			stravaRouteTerrain: '3d',
			stravaRouteShowElevation: false,
		};
		/*
		 * core/embed's `save()` writes the bare URL inside the wrapper; the
		 * `render_block_core/embed` filter swaps it for our parameterized
		 * iframe before autoembed runs. Saving in this shape mirrors what
		 * the editor produces in production.
		 */
		const blockComment = `<!-- wp:embed ${ JSON.stringify(
			attrs
		) } --><figure class="wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava"><div class="wp-block-embed__wrapper">\n${
			attrs.url
		}\n</div></figure><!-- /wp:embed -->`;
		postId = wp(
			'post create --post_title="Strava route options" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } --post_content=${ JSON.stringify(
				blockComment
			) }`
		);

		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );

		const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
		const src = ( await iframe.getAttribute( 'src' ) ) ?? '';
		const url = new URL( src );
		expect( url.pathname ).toBe( `/route/${ routeId }` );
		expect( url.searchParams.get( 'style' ) ).toBe( 'satellite' );
		expect( url.searchParams.get( 'hideElevation' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'units' ) ).toBe( 'metric' );
		expect( url.searchParams.get( 'fullWidth' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'terrain' ) ).toBe( '3d' );
		expect( url.searchParams.get( 'surfaceType' ) ).toBe( 'true' );
	} );

	test( 'frontend: iframe carries the defense-in-depth sandbox + referrer-policy attributes', async ( {
		page,
	} ) => {
		postId = publishPostWithContent(
			'Strava sandbox attrs',
			'https://www.strava.com/activities/18233733854'
		);
		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );
		const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
		await expect( iframe ).toHaveAttribute(
			'sandbox',
			'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
		);
		await expect( iframe ).toHaveAttribute( 'referrerpolicy', 'origin' );
	} );

	test( 'editor: pasting a Strava URL creates a core/embed block on the strava variation', async ( {
		page,
		context,
	} ) => {
		// Without explicit clipboard permissions the navigator.clipboard call
		// silently no-ops in headless chromium and the keyboard paste pulls
		// in stale clipboard contents.
		await context.grantPermissions( [
			'clipboard-read',
			'clipboard-write',
		] );

		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		// Block strava-embeds.com so the inner Strava iframe doesn't stall
		// the test waiting on embed.js. The variation match happens client-
		// side from the URL alone, so the iframe content is irrelevant here.
		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );

		const canvas = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.first();

		/*
		 * Synthesizing a ClipboardEvent works for many handlers, but
		 * Gutenberg's RichText paste pipeline relies on the real `paste`
		 * event that Chrome dispatches for Ctrl/Meta+V — so write to the
		 * actual clipboard and trigger a real keyboard paste.
		 */
		await canvas.locator( 'body' ).click();

		const STRAVA_URL = 'https://www.strava.com/activities/18233733854';
		await page.evaluate(
			( url: string ) => navigator.clipboard.writeText( url ),
			STRAVA_URL
		);
		await page.keyboard.press( 'ControlOrMeta+v' );

		// The variation lookup runs at render time, so the visible class
		// arrives a tick after the block name flips — poll the data store
		// to settle on a single core/embed block first.
		await expect
			.poll(
				async () =>
					await page.evaluate( () => {
						const wpAny = ( window as { wp?: any } ).wp;
						const list = wpAny?.data
							?.select( 'core/block-editor' )
							?.getBlocks();
						return Array.isArray( list ) && list.length === 1
							? list[ 0 ].name
							: null;
					} ),
				{ timeout: 15000 }
			)
			.toBe( 'core/embed' );

		const embedBlock = canvas.locator(
			'.wp-block-embed.is-provider-strava'
		);
		await expect( embedBlock ).toBeVisible( { timeout: 15000 } );
	} );
} );
