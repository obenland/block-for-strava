/**
 * Save-component coverage.
 *
 * The save component owns the persistent post_content shape the PHP render
 * callback receives. If its DOM diverges from what `render_block` expects
 * (the `wp-block-embed__wrapper` div containing the bare URL), the PHP
 * regex-and-replace path that bakes route params into the iframe stops
 * matching and we silently fall back to the raw URL.
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';

import { save } from '../../src/save';

describe( 'save', () => {
	it( 'renders the figure/wrapper shape with the URL inside', () => {
		const url = 'https://www.strava.com/activities/123';
		const { container } = render(
			createElement( save, { attributes: { url } } )
		);

		const figure = container.querySelector( 'figure' );
		expect( figure ).not.toBeNull();
		expect( figure?.className ).toContain( 'wp-block-embed' );
		expect( figure?.className ).toContain( 'is-provider-strava' );

		const wrapper = container.querySelector( '.wp-block-embed__wrapper' );
		expect( wrapper ).not.toBeNull();
		// The URL is wrapped in newlines so `core/embed`-style autoembed
		// regex (and our PHP regex-and-replace) can find a clean line.
		expect( wrapper?.textContent ).toBe( `\n${ url }\n` );
	} );

	it( 'emits an empty wrapper when the URL is missing', () => {
		// Should never happen in practice — the editor guards against
		// saving without a URL — but a hand-edited block comment could
		// strip the attribute, and the save component must not throw.
		const { container } = render(
			createElement( save, { attributes: {} } )
		);
		const wrapper = container.querySelector( '.wp-block-embed__wrapper' );
		expect( wrapper?.textContent ).toBe( '\n\n' );
	} );
} );
