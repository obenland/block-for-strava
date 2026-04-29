import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

/*
 * URL-on-its-own-line paste already routes through `core/embed`'s built-in
 * raw transform. This filter covers the second path: a user who typed a
 * Strava URL into a paragraph and now wants to convert it via the block
 * toolbar's "Transform to..." menu. We add a `to core/embed` transform on
 * `core/paragraph` whose `isMatch` recognizes Strava URLs; the resulting
 * embed block carries `providerNameSlug: 'strava'` so the variation
 * registered in ./embed-variation matches on save.
 */

/*
 * Anchored variants of the variation patterns: the variation's regexes
 * accept a Strava URL prefix anywhere, but for a paragraph→embed transform
 * we only want to fire when the entire paragraph is a single Strava URL —
 * otherwise a paragraph mentioning Strava in passing would offer the
 * conversion and silently lose the rest of the text.
 */
const STRAVA_FULL_PATTERNS: ReadonlyArray< RegExp > = [
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(?:activities|routes|segments)\/\d+(?:[/?#][^\s]*)?$/i,
	/^https?:\/\/strava\.app\.link\/[^\s]+$/i,
];

/**
 * Extracts a single Strava URL from paragraph content, or returns null.
 *
 * Paragraph `content` arrives as a serialized RichText string — typically
 * either bare text or an `<a href="…">…</a>` wrapping after the editor's
 * autolinker fires. Strip HTML tags before testing so both shapes match.
 *
 * @param content Paragraph block content.
 */
export function extractStravaUrl( content: unknown ): string | null {
	if ( typeof content !== 'string' ) {
		return null;
	}
	const text = content.replace( /<[^>]+>/g, '' ).trim();
	if ( ! text ) {
		return null;
	}
	return STRAVA_FULL_PATTERNS.some( ( re ) => re.test( text ) ) ? text : null;
}

interface ParagraphAttributes {
	content?: unknown;
}

interface BlockTransform {
	type: 'block';
	blocks: ReadonlyArray< string >;
	isMatch: ( attrs: ParagraphAttributes ) => boolean;
	transform: ( attrs: ParagraphAttributes ) => unknown;
}

interface BlockSettings {
	transforms?: {
		to?: ReadonlyArray< BlockTransform >;
		[ key: string ]: unknown;
	};
	[ key: string ]: unknown;
}

addFilter(
	'blocks.registerBlockType',
	'block-for-strava/paragraph-to-strava-embed',
	( settings: BlockSettings, name: string ): BlockSettings => {
		if ( 'core/paragraph' !== name ) {
			return settings;
		}
		const existingTo = settings.transforms?.to ?? [];
		const stravaTransform: BlockTransform = {
			type: 'block',
			blocks: [ 'core/embed' ],
			isMatch: ( { content } ) => null !== extractStravaUrl( content ),
			transform: ( { content } ) => {
				const url = extractStravaUrl( content ) ?? '';
				return createBlock( 'core/embed', {
					url,
					providerNameSlug: 'strava',
					responsive: true,
				} );
			},
		};
		return {
			...settings,
			transforms: {
				...settings.transforms,
				to: [ ...existingTo, stravaTransform ],
			},
		};
	}
);
