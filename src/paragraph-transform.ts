import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

/*
 * URL-on-its-own-line paste already routes through `core/embed`'s built-in
 * raw transform. This filter covers the second path: a user who typed a
 * Strava URL into a paragraph and now wants to convert it via the block
 * toolbar's "Transform to..." menu. We add a `to core/embed` transform on
 * `core/paragraph` whose `isMatch` recognizes Strava URLs; the resulting
 * embed block carries `providerNameSlug: 'strava'` so the Strava embed
 * variation registered in `src/index.tsx` matches on save.
 */

/*
 * Anchored full-string Strava URL patterns for the paragraph→embed
 * transform. We only want to fire when the entire paragraph is a single
 * Strava URL — otherwise a paragraph mentioning Strava in passing would
 * offer the conversion and silently lose the rest of the text.
 */
const STRAVA_FULL_PATTERNS: ReadonlyArray< RegExp > = [
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(?:activities|routes|segments)\/\d+(?:[/?#][^\s]*)?$/i,
	/^https?:\/\/strava\.app\.link\/[^\s]+$/i,
];

/*
 * Pulls the href out of a paragraph that contains exactly one `<a>` and
 * no other markup. The pattern is anchored start-to-end and disallows
 * `<` inside the anchor body, so crafted overlapping tags
 * (`<a href="..."><script>` etc.) don't pass — anything more elaborate
 * than the editor's autolinker output falls through to "not a URL".
 */
const ANCHOR_ONLY_RE = /^<a\b[^>]*\shref="([^"]+)"[^>]*>[^<]*<\/a>$/i;

/**
 * Extracts a single Strava URL from paragraph content, or returns null.
 *
 * Paragraph `content` arrives as a serialized RichText string and we only
 * recognize two shapes: a bare URL, or the single-anchor wrapping the
 * editor's autolinker produces when a URL is pasted into existing text.
 * Anything else — multiple links, mixed text, nested markup — returns
 * null so the transform never has to strip arbitrary HTML, which avoids
 * the well-known traps with multi-pass sanitization.
 *
 * @param content Paragraph block content.
 */
export function extractStravaUrl( content: unknown ): string | null {
	if ( typeof content !== 'string' ) {
		return null;
	}
	const trimmed = content.trim();
	if ( ! trimmed ) {
		return null;
	}
	if ( STRAVA_FULL_PATTERNS.some( ( re ) => re.test( trimmed ) ) ) {
		return trimmed;
	}
	const anchor = ANCHOR_ONLY_RE.exec( trimmed );
	if (
		anchor &&
		STRAVA_FULL_PATTERNS.some( ( re ) => re.test( anchor[ 1 ] ) )
	) {
		return anchor[ 1 ];
	}
	return null;
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
