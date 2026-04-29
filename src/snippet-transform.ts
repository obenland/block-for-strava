/**
 * Strava-snippet paste path.
 *
 * Strava issues a per-activity share token (`data-token` on the placeholder
 * div) for any activity whose visibility is not "Everyone". The plain URL
 * iframe shape (`https://strava-embeds.com/activity/{id}`) returns 403 for
 * those activities; the same iframe with `?token=…` appended renders. To
 * cover the token-gated case alongside the existing URL-paste flow, we:
 *
 * 1. Extend `core/embed` with a `stravaEmbedToken` attribute so a token
 *    pasted via Strava's official snippet survives a save/reload round
 *    trip and feeds back into both the editor preview (see
 *    `src/route-controls.tsx`) and the server-side render
 *    (`Block_For_Strava_Embed::render_strava_embed`).
 * 2. Register a raw transform on `core/embed` that recognizes the
 *    `<div class="strava-embed-placeholder" data-embed-type data-embed-id
 *    data-token>…</div>` shape Gutenberg's paste handler hands us after
 *    stripping the accompanying `<script>` tag.
 *
 * This file owns the `stravaEmbedToken` attribute. Only the snippet-paste
 * path writes it — URL-only pastes leave it empty and rely on the
 * `/block-for-strava/v1/embed-status` preflight (see `src/route-controls.tsx`)
 * to warn the user before save when the URL alone won't render.
 */
import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

/*
 * Plural URL path Strava uses for each embed type, keyed by the singular
 * form Strava's snippet `data-embed-type` attribute carries. Mirrors the
 * inverse mapping in `block_for_strava_parse_strava_url`; if Strava ever
 * adds a new embeddable type, both sides need updating in lockstep.
 */
const SINGULAR_TO_PLURAL: Record< string, string > = {
	activity: 'activities',
	route: 'routes',
	segment: 'segments',
};

interface AttributeSpec {
	type: 'string' | 'boolean';
	default?: unknown;
}

interface BlockSettings {
	attributes?: Record< string, AttributeSpec >;
	transforms?: {
		from?: ReadonlyArray< unknown >;
		to?: ReadonlyArray< unknown >;
	};
	[ key: string ]: unknown;
}

interface RawTransform {
	type: 'raw';
	isMatch: ( node: Node ) => boolean;
	transform: ( node: Node ) => unknown;
}

interface ParsedPlaceholder {
	type: keyof typeof SINGULAR_TO_PLURAL;
	id: string;
	token: string;
}

/**
 * Pulls `{type, id, token}` out of a Strava embed placeholder element, or
 * returns `null` if the element isn't a recognizable placeholder. Shared
 * between `isMatch` and `transform` so the two paths can never disagree on
 * what counts as a valid snippet — there's no way for `isMatch` to say yes
 * to a node that `transform` can't fully read.
 *
 * @param node Parsed DOM node from Gutenberg's paste pipeline.
 * @return Parsed `{type, id, token}` triple, or `null` when the node is
 *         not a recognizable Strava embed placeholder.
 */
function parsePlaceholder( node: Node ): ParsedPlaceholder | null {
	if ( ! ( node instanceof HTMLElement ) ) {
		return null;
	}
	if ( ! node.classList.contains( 'strava-embed-placeholder' ) ) {
		return null;
	}
	const type = node.getAttribute( 'data-embed-type' );
	if ( null === type || ! ( type in SINGULAR_TO_PLURAL ) ) {
		return null;
	}
	/*
	 * Numeric id is what Strava's iframe path requires; reject anything
	 * else here so we don't persist a block that 404s on every render.
	 */
	const id = node.getAttribute( 'data-embed-id' );
	if ( null === id || ! /^\d+$/.test( id ) ) {
		return null;
	}
	return {
		type: type as keyof typeof SINGULAR_TO_PLURAL,
		id,
		token: node.getAttribute( 'data-token' ) ?? '',
	};
}

addFilter(
	'blocks.registerBlockType',
	'block-for-strava/snippet-transform',
	( settings: BlockSettings, name: string ): BlockSettings => {
		if ( 'core/embed' !== name ) {
			return settings;
		}

		const snippetTransform: RawTransform = {
			type: 'raw',
			isMatch: ( node ) => null !== parsePlaceholder( node ),
			transform: ( node ) => {
				/*
				 * Gutenberg only invokes `transform` after `isMatch`
				 * returns true, so this parse always succeeds — the
				 * non-null assertion encodes that pipeline contract
				 * without an unreachable defensive branch (which would
				 * be dead code on every real paste).
				 */
				const parsed = parsePlaceholder( node ) as ParsedPlaceholder;
				const path = SINGULAR_TO_PLURAL[ parsed.type ];
				return createBlock( 'core/embed', {
					url: `https://www.strava.com/${ path }/${ parsed.id }`,
					providerNameSlug: 'strava',
					responsive: true,
					stravaEmbedToken: parsed.token,
				} );
			},
		};

		const existingFrom = settings.transforms?.from ?? [];
		return {
			...settings,
			attributes: {
				...( settings.attributes ?? {} ),
				stravaEmbedToken: { type: 'string', default: '' },
			},
			transforms: {
				...settings.transforms,
				from: [ ...existingFrom, snippetTransform ],
			},
		};
	}
);
