/**
 * Save component for the Strava embed block.
 *
 * Mirrors `core/embed`'s save shape — a `<figure>` with a single
 * `wp-block-embed__wrapper` div containing the bare URL — so theme styles
 * targeting `.wp-block-embed` (responsive containers, alignment, etc.)
 * still apply.
 *
 * The bare URL persists in saved post content but never reaches the front
 * end as-is: the PHP render callback registered in `block.json` rewrites
 * the wrapper contents to a sandboxed iframe pointing at strava-embeds.com.
 * Keeping the URL (rather than the iframe) in saved content means edits to
 * the iframe shape don't require a block deprecation pass and old posts
 * keep rendering with the latest defense-in-depth attributes.
 */
import { createElement } from '@wordpress/element';
import { useBlockProps } from '@wordpress/block-editor';

interface SaveProps {
	attributes: { url?: string };
}

export function save( { attributes }: SaveProps ) {
	const blockProps = useBlockProps.save( {
		className:
			'wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava',
	} );
	return createElement(
		'figure',
		blockProps,
		createElement(
			'div',
			{ className: 'wp-block-embed__wrapper' },
			`\n${ attributes.url ?? '' }\n`
		)
	);
}
