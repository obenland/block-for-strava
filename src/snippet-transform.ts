/**
 * Strava-snippet paste path.
 *
 * Strava issues a per-activity share token (`data-token` on the placeholder
 * div) for any activity whose visibility is not "Everyone". The plain URL
 * iframe shape (`https://strava-embeds.com/activity/{id}`) returns 403 for
 * those activities; the same iframe with `?token=…` appended renders. To
 * cover the token-gated case alongside the existing URL-paste flow, we
 * register a raw transform on `block-for-strava/embed` that recognizes the
 * `<div class="strava-embed-placeholder" data-embed-type data-embed-id
 * data-token>…</div>` shape Gutenberg's paste handler hands us after
 * stripping the accompanying `<script>` tag.
 *
 * The token attribute (`stravaEmbedToken`) lives in `block.json`. Only the
 * snippet-paste path writes it — URL-only pastes leave it empty and rely
 * on the `/block-for-strava/v1/embed-status` preflight (see `src/edit.tsx`)
 * to warn the user before save when the URL alone won't render.
 */
import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

/*
 * Plural URL path Strava uses for each embed type, keyed by the singular
 * form Strava's snippet `data-embed-type` attribute carries. Mirrors the
 * inverse mapping in `Block_For_Strava_Embed::parse_strava_url()`; if
 * Strava ever adds a new embeddable type, both sides need updating in
 * lockstep.
 */
const SINGULAR_TO_PLURAL: Record< string, string > = {
	activity: 'activities',
	route: 'routes',
	segment: 'segments',
};

interface BlockSettings {
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
	schema: () => Record< string, unknown >;
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
	/*
	 * `type in SINGULAR_TO_PLURAL` would also accept inherited keys like
	 * `toString` / `constructor` and return their prototype values for
	 * `SINGULAR_TO_PLURAL[type]` — a function that stringifies to its
	 * `[native code]` body in the template literal below. Use an
	 * own-property check so only the three documented types pass.
	 */
	if (
		null === type ||
		! Object.prototype.hasOwnProperty.call( SINGULAR_TO_PLURAL, type )
	) {
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
		if ( 'block-for-strava/embed' !== name ) {
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
				 * without an unreachable defensive branch.
				 */
				const parsed = parsePlaceholder( node ) as ParsedPlaceholder;
				const path = SINGULAR_TO_PLURAL[ parsed.type ];
				return createBlock( 'block-for-strava/embed', {
					url: `https://www.strava.com/${ path }/${ parsed.id }`,
					stravaEmbedToken: parsed.token,
				} );
			},
			/*
			 * Gutenberg's paste pipeline runs `removeInvalidHTML` against a
			 * merged schema BEFORE asking any raw transform's `isMatch`. A
			 * raw transform that contributes no schema entry leaves the
			 * placeholder div with all its `data-*` attributes (and even
			 * the div itself, when empty) stripped — `parsePlaceholder`
			 * then sees a bare `<div>` and rejects it. Whitelist the exact
			 * shape Strava's share dialog produces so the attributes we
			 * read survive the filter step.
			 */
			schema: () => ( {
				div: {
					attributes: [
						'class',
						'data-embed-type',
						'data-embed-id',
						'data-token',
						'data-style',
						'data-from-embed',
					],
					classes: [ 'strava-embed-placeholder' ],
				},
			} ),
		};

		const existingFrom = settings.transforms?.from ?? [];
		return {
			...settings,
			transforms: {
				...settings.transforms,
				from: [ ...existingFrom, snippetTransform ],
			},
		};
	}
);
