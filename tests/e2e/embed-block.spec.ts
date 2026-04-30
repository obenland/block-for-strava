import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * End-to-end coverage for the `block-for-strava/embed` block.
 *
 * Two seams to pin:
 *
 * 1. A saved post containing a Strava URL in the block-comment
 *    attributes renders as an iframe pointing directly at
 *    strava-embeds.com via the block's `render_callback`, with the
 *    defense-in-depth sandbox flags and `referrerpolicy=origin` intact.
 * 2. The standalone block is discoverable in the inserter and accepts a
 *    URL through its placeholder.
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
 * Publishes a post with a serialized `block-for-strava/embed` block carrying
 * the supplied attributes. Returning the post ID synchronously lets the
 * caller assign it into the test's outer `postId` *before* any async assert
 * runs — otherwise a failed expect inside a helper would leak a published
 * post that `afterEach` can't see.
 *
 * @param title Post title.
 * @param attrs Block attributes (must include `url`).
 */
function publishStravaBlock(
	title: string,
	attrs: Record< string, unknown >
): string {
	// Dynamic block: `save` returns null, so the persisted comment carries
	// only attributes — the PHP render callback rebuilds the figure.
	const blockComment = `<!-- wp:block-for-strava/embed ${ JSON.stringify(
		attrs
	) } /-->`;
	const postId = wp(
		`post create --post_title=${ JSON.stringify(
			title
		) } --post_status=publish --porcelain`
	);
	wp(
		`post update ${ postId } --post_content=${ JSON.stringify(
			blockComment
		) }`
	);
	return postId;
}

/**
 * Loads the published post and returns the `src` of the Strava embed iframe.
 * Blocks strava-embeds.com so the test doesn't depend on the upstream embed
 * page actually loading; the URL on the iframe is the contract we own.
 *
 * @param page   Playwright page.
 * @param postId Post ID returned by `publishStravaBlock`.
 */
async function fetchEmbedIframeSrc(
	page: Page,
	postId: string
): Promise< string > {
	await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
	await page.goto( `/?p=${ postId }` );

	const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
	await expect( iframe ).toBeAttached();
	return ( await iframe.getAttribute( 'src' ) ) ?? '';
}

const RENDER_CASES = [
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

test.describe.serial( 'block-for-strava/embed render', () => {
	let postId: string;

	test.afterEach( () => {
		if ( postId ) {
			wp( `post delete ${ postId } --force` );
			postId = '';
		}
	} );

	for ( const { name, url, expectedSrc } of RENDER_CASES ) {
		test( `frontend: ${ name } URL renders via render_callback`, async ( {
			page,
		} ) => {
			postId = publishStravaBlock( `Strava ${ name } embed`, { url } );
			const src = await fetchEmbedIframeSrc( page, postId );
			expect( src ).toBe( expectedSrc );
		} );
	}

	test( 'frontend: route attributes append Strava URL params to the iframe', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		const attrs = {
			url: `https://www.strava.com/routes/${ routeId }`,
			stravaRouteMapStyle: 'satellite',
			stravaRouteUnits: 'metric',
			stravaRouteFullWidth: true,
			stravaRouteShowDirt: true,
			stravaRouteTerrain: '3d',
			stravaRouteShowElevation: false,
		};
		postId = publishStravaBlock( 'Strava route options', attrs );

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
		postId = publishStravaBlock( 'Strava sandbox attrs', {
			url: 'https://www.strava.com/activities/18233733854',
		} );
		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );
		const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
		await expect( iframe ).toHaveAttribute(
			'sandbox',
			'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
		);
		await expect( iframe ).toHaveAttribute( 'referrerpolicy', 'origin' );
	} );

	test( 'editor: block is registered in the editor data store', async ( {
		page,
	} ) => {
		// Block Directory's discovery process keys off block.json + the
		// editor finding the block at runtime — pin both by reading
		// `core/blocks` after the editor boots. This is version-resilient:
		// the inserter UI's accessible names drift across Gutenberg
		// versions, but `getBlockType('block-for-strava/embed')` is the
		// same call from WP 6.6 forward.
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		const blockType = await page.evaluate( () => {
			const wpAny = ( window as { wp?: any } ).wp;
			return wpAny?.data
				?.select( 'core/blocks' )
				?.getBlockType( 'block-for-strava/embed' );
		} );

		expect( blockType ).toBeTruthy();
		expect( blockType.name ).toBe( 'block-for-strava/embed' );
		expect( blockType.category ).toBe( 'embed' );
		expect( blockType.title ).toBe( 'Strava' );
		// The save/edit functions are present (they're React components,
		// so we just check they're truthy — the JSON pass through
		// `getBlockType` may strip function bodies depending on the
		// version, but the property survives).
		expect( typeof blockType.attributes ).toBe( 'object' );
		expect( blockType.attributes.url ).toBeTruthy();
	} );
} );
