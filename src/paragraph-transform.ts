import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

import { STRAVA_URL_PATTERNS } from './strava-url-patterns';

/*
 * Adds a `core/paragraph` → `block-for-strava/embed` transform so a user
 * who has typed (or pasted-into-text) a Strava URL inside a paragraph can
 * convert it to the Strava block via the toolbar's "Transform to..." menu.
 * The inserter handles the from-scratch path; this filter covers the case
 * where the URL is already living inside paragraph content.
 *
 * The recognition patterns live in `strava-url-patterns` because the
 * embed-block transform has the same gating rules and any drift between
 * the two would let identical URLs convert on one path and silently
 * stall on the other.
 */

/*
 * Pulls the href out of a paragraph that contains exactly one `<a>` and
 * no other markup. The pattern is anchored start-to-end and disallows
 * `<` inside the anchor body, so crafted overlapping tags
 * (`<a href="..."><script>` etc.) don't pass — anything more elaborate
 * than the editor's autolinker output falls through to "not a URL".
 */
const ANCHOR_ONLY_RE = /^<a\b[^>]*\shref="([^"]+)"[^>]*>[^<]*<\/a>$/i;

/*
 * RichText serializes anchor `href` attributes with HTML entities, so a URL
 * like `…?foo=1&bar=2` round-trips as `…?foo=1&amp;bar=2`. Storing that
 * unmodified would leave the embed block carrying a malformed URL — the
 * persisted string wouldn't match the URL the user pasted. Decode the
 * handful of entities the editor's autolinker actually produces (it
 * doesn't emit the numeric `&#x..;` forms) before we hand the string back.
 */
const HTML_ENTITY_MAP: Record< string, string > = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
};

function decodeHrefEntities( href: string ): string {
	return href.replace(
		/&(?:amp|lt|gt|quot|#39);/g,
		( match ) => HTML_ENTITY_MAP[ match ] as string
	);
}

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
	if ( STRAVA_URL_PATTERNS.some( ( re ) => re.test( trimmed ) ) ) {
		return trimmed;
	}
	const anchor = ANCHOR_ONLY_RE.exec( trimmed );
	if ( anchor ) {
		const href = decodeHrefEntities( anchor[ 1 ] );
		if ( STRAVA_URL_PATTERNS.some( ( re ) => re.test( href ) ) ) {
			return href;
		}
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
			blocks: [ 'block-for-strava/embed' ],
			isMatch: ( { content } ) => null !== extractStravaUrl( content ),
			transform: ( { content } ) => {
				const url = extractStravaUrl( content ) ?? '';
				return createBlock( 'block-for-strava/embed', { url } );
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
