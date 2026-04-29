import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * End-to-end coverage for the Strava core/embed variation flow.
 *
 * Exercises the two seams that turn a pasted Strava URL into a working embed:
 *
 * 1. Paste a Strava URL into a fresh post → core/embed picks up the
 *    `strava` variation (`is-provider-strava` class on the block).
 * 2. Saved post renders the iframe-with-data-URL Strava embed on the front
 *    end via `wp_embed_register_handler`.
 *
 * The REST `/oembed/1.0/proxy` rewrite is covered by the PHP integration
 * test in tests/test-strava-embed.php; replicating it here would only add
 * cookie-juggling without surfacing a different failure mode.
 */

function wp( args: string ): string {
	return execSync( `npx wp-env run cli wp ${ args }`, {
		stdio: [ 'ignore', 'pipe', 'inherit' ],
		cwd: process.cwd(),
	} )
		.toString()
		.trim();
}

async function loginAsAdmin( page: Page ): Promise< void > {
	await page.goto( '/wp-login.php' );
	await page.locator( '#user_login' ).fill( 'admin' );
	await page.locator( '#user_pass' ).fill( 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.waitForURL( /wp-admin/ );
}

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
 * Decodes a `data:text/html;base64,...` URL and returns the inner document.
 *
 * The Strava embed iframe carries its placeholder + script payload inside a
 * data URL; asserting on the decoded contents lets the test verify the
 * exact data-* attributes Strava's embed.js looks for, instead of just
 * checking that *some* iframe was emitted.
 *
 * @param src The iframe `src` attribute value.
 */
function decodeIframeSrc( src: string ): string {
	const match = src.match( /^data:text\/html;charset=utf-8;base64,(.+)$/ );
	if ( ! match ) {
		throw new Error( `iframe src is not a Strava data URL: ${ src }` );
	}
	return Buffer.from( match[ 1 ], 'base64' ).toString( 'utf-8' );
}

/**
 * Publishes a post containing the given URL and returns the decoded inner
 * document of the Strava embed iframe rendered on the front end. Blocks
 * strava-embeds.com so embed.js can't replace the placeholder inside the
 * inner data-URL document during the test run.
 *
 * @param page    Playwright page.
 * @param title   Post title.
 * @param content Raw post_content (typically a bare Strava URL).
 */
async function renderAutoembed(
	page: Page,
	title: string,
	content: string
): Promise< { postId: string; inner: string } > {
	const postId = wp(
		`post create --post_title="${ title }" --post_status=publish --porcelain`
	);
	wp( `post update ${ postId } --post_content="${ content }"` );

	await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
	await page.goto( `/?p=${ postId }` );

	const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
	await expect( iframe ).toBeAttached();
	const src = ( await iframe.getAttribute( 'src' ) ) ?? '';
	return { postId, inner: decodeIframeSrc( src ) };
}

test.describe.serial( 'Strava core/embed variation', () => {
	let postId: string;

	test.afterEach( () => {
		if ( postId ) {
			wp( `post delete ${ postId } --force` );
			postId = '';
		}
	} );

	test( 'frontend: bare Strava URL in post_content autoembeds via wp_embed_register_handler', async ( {
		page,
	} ) => {
		// A bare URL on its own line is what classic content/autoembed turns
		// into an embed at render time. Our handler should match it.
		const result = await renderAutoembed(
			page,
			'Strava autoembed',
			'https://www.strava.com/activities/18233733854'
		);
		postId = result.postId;
		expect( result.inner ).toContain( 'data-embed-id="18233733854"' );
		expect( result.inner ).toContain( 'data-embed-type="activity"' );
	} );

	test( 'frontend: route URL autoembeds with data-embed-type="route"', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		const result = await renderAutoembed(
			page,
			'Strava route autoembed',
			`https://www.strava.com/routes/${ routeId }`
		);
		postId = result.postId;
		expect( result.inner ).toContain( `data-embed-id="${ routeId }"` );
		expect( result.inner ).toContain( 'data-embed-type="route"' );
	} );

	test( 'frontend: segment URL autoembeds with data-embed-type="segment"', async ( {
		page,
	} ) => {
		const result = await renderAutoembed(
			page,
			'Strava segment autoembed',
			'https://www.strava.com/segments/789'
		);
		postId = result.postId;
		expect( result.inner ).toContain( 'data-embed-id="789"' );
		expect( result.inner ).toContain( 'data-embed-type="segment"' );
	} );

	test( 'editor: pasting a Strava URL creates a core/embed block on the strava variation', async ( {
		page,
		context,
	} ) => {
		// Grant clipboard permissions before login so the editor session can
		// read/write the OS clipboard inside Playwright's headless chromium.
		// Without this the navigator.clipboard.writeText() call below silently
		// no-ops and the keyboard paste pulls in stale clipboard contents.
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
		 * Click the canvas to materialize an empty default-block paragraph,
		 * write the URL to the actual clipboard, then trigger a real paste
		 * via the keyboard shortcut. Synthesizing a ClipboardEvent works for
		 * many handlers, but Gutenberg's RichText paste pipeline relies on
		 * the real `paste` event that Chrome dispatches for Ctrl/Meta+V.
		 */
		await canvas.locator( 'body' ).click();

		const STRAVA_URL = 'https://www.strava.com/activities/18233733854';
		await page.evaluate(
			( url: string ) => navigator.clipboard.writeText( url ),
			STRAVA_URL
		);
		await page.keyboard.press( 'ControlOrMeta+v' );

		// Wait for the data store to settle on a single core/embed block;
		// the variation lookup runs at render time, so the visible class
		// arrives a tick after the block name flips.
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
