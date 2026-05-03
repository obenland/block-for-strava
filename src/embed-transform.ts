/**
 * `core/embed` → `block-for-strava/embed` conversion path.
 *
 * Gutenberg's URL paste handler creates a `core/embed` block when a user
 * pastes a bare URL onto its own line in post content (mode `BLOCKS`).
 * Strava has no oEmbed provider, so without intervention the URL would
 * sit in a generic embed block that renders "Sorry, this content could
 * not be embedded." Two conversion paths plug that gap:
 *
 * 1. A `from`-block transform on `block-for-strava/embed` targeting
 *    `core/embed` ("Transform to → Strava" toolbar option). This is the
 *    explicit, declarative path — it covers `core/embed` blocks that
 *    pre-date the auto-replacer (existing posts, imported content, or
 *    blocks inside reusable patterns) where the watcher's first walk
 *    short-circuits because the block list reference hasn't changed.
 *
 * 2. A `subscribe()` watcher on `core/block-editor` that auto-replaces
 *    any `core/embed` whose `url` attribute is a Strava form. This is
 *    the "convenience" path the plugin advertises: pasting a URL into
 *    post content yields a Strava block immediately, with no toolbar
 *    interaction required.
 */
import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';
import { subscribe, select, dispatch } from '@wordpress/data';

import { isStravaUrl } from './strava-url-patterns';

interface SourceAttributes {
	url?: unknown;
	align?: unknown;
	className?: unknown;
	anchor?: unknown;
	caption?: unknown;
	[ key: string ]: unknown;
}

interface BlockTransform {
	type: 'block';
	blocks: ReadonlyArray< string >;
	isMatch: ( attrs: SourceAttributes ) => boolean;
	transform: ( attrs: SourceAttributes ) => unknown;
}

interface BlockSettings {
	transforms?: {
		from?: ReadonlyArray< unknown >;
		to?: ReadonlyArray< unknown >;
	};
	[ key: string ]: unknown;
}

/*
 * Attributes core/embed shares with our block that we want to preserve
 * through conversion. Three are figure-wrapper styling/identification
 * (`align`, `className`, `anchor`); `caption` is the user-visible
 * caption text below the embed. Without explicit passthrough,
 * Gutenberg's `createBlock` would drop everything outside the
 * second-arg attributes object, silently discarding the user's caption
 * and styling. Other core/embed-only fields (`allowResponsive`,
 * `responsive`, `previewable`, `providerNameSlug`) are intentionally
 * not listed — they're not part of our block's schema and would be
 * discarded anyway.
 */
const PRESERVED_ATTR_KEYS = [
	'align',
	'className',
	'anchor',
	'caption',
] as const;

function pickPreservedAttrs(
	attrs: SourceAttributes
): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	for ( const key of PRESERVED_ATTR_KEYS ) {
		if ( undefined !== attrs[ key ] ) {
			out[ key ] = attrs[ key ];
		}
	}
	return out;
}

addFilter(
	'blocks.registerBlockType',
	'block-for-strava/embed-block-transform',
	( settings: BlockSettings, name: string ): BlockSettings => {
		if ( 'block-for-strava/embed' !== name ) {
			return settings;
		}
		const embedTransform: BlockTransform = {
			type: 'block',
			blocks: [ 'core/embed' ],
			isMatch: ( { url } ) => isStravaUrl( url ),
			transform: ( attrs ) =>
				createBlock( 'block-for-strava/embed', {
					...pickPreservedAttrs( attrs ),
					url: String( attrs.url ),
				} ),
		};
		const existingFrom = settings.transforms?.from ?? [];
		return {
			...settings,
			transforms: {
				...settings.transforms,
				from: [ ...existingFrom, embedTransform ],
			},
		};
	}
);

interface EditorBlock {
	clientId: string;
	name: string;
	attributes: SourceAttributes;
	innerBlocks?: ReadonlyArray< EditorBlock >;
}

interface BlockEditorSelectors {
	getBlocks: () => ReadonlyArray< EditorBlock >;
}

interface BlockEditorActions {
	replaceBlock: ( clientId: string, block: unknown ) => unknown;
	/*
	 * Marks the next dispatch on `core/block-editor` as merging into
	 * the previous undo entry instead of starting a new one. Without
	 * this, pasting a Strava URL produces two history entries
	 * (paste → core/embed, then auto-convert → block-for-strava/embed),
	 * so the first Undo lands on the broken intermediate `core/embed`
	 * instead of removing the paste outright. Marking the conversion
	 * non-persistent collapses the two steps so Undo behaves like a
	 * single transparent paste-and-convert.
	 */
	__unstableMarkNextChangeAsNotPersistent?: () => void;
}

/**
 * Tracks clientIds the watcher should NOT auto-convert.
 *
 * Two distinct populations end up here:
 *
 * 1. Blocks present at the initial editor load. These are "legacy"
 *    content the user authored (or imported) before the auto-replacer
 *    was watching, and silently rewriting them on the next unrelated
 *    edit would dirty the post and surprise the author. The toolbar
 *    `Transform to → Strava` entry stays available for explicit
 *    conversion of those blocks.
 *
 * 2. `core/embed` blocks the watcher has already auto-converted in
 *    this session. `subscribe` fires on every state tick during a
 *    single dispatch, so without dedupe a single paste would queue
 *    several `replaceBlock` calls — only the first finds its target,
 *    the rest are wasted work and (worse) could be misread as a
 *    state-change loop.
 *
 * The set is bounded by the number of distinct clientIds that have
 * existed in this editor session, which is the natural ceiling.
 */
const skipClientIds = new Set< string >();

/*
 * Whether the watcher has performed its initial walk. Set true after
 * the first non-skip tick observes the loaded post content. Until
 * then, we record what's on screen as legacy and don't touch it.
 */
let initialized = false;

function* walk(
	blocks: ReadonlyArray< EditorBlock >
): Generator< EditorBlock > {
	for ( const block of blocks ) {
		yield block;
		if ( block.innerBlocks?.length ) {
			yield* walk( block.innerBlocks );
		}
	}
}

/**
 * Reference to the most recent `getBlocks()` result we walked.
 *
 * Gutenberg's `core/block-editor` returns the same array reference when
 * the block list hasn't changed, so comparing identities lets us skip
 * the recursive walk on ticks that don't touch the block tree (e.g.,
 * selection moves, inspector panel toggles).
 */
let lastBlocks: ReadonlyArray< EditorBlock > | null = null;

/**
 * Scans the editor's block list for `core/embed` blocks carrying a
 * Strava URL and replaces each with `block-for-strava/embed`.
 *
 * The first walk records every existing clientId as "skip" so legacy
 * content (loaded with the post) isn't silently rewritten on the user's
 * next unrelated edit. Subsequent walks convert any new `core/embed`
 * with a Strava URL — those are paste-introduced or pattern-introduced
 * during the editor session, where conversion is the convenience the
 * plugin advertises.
 *
 * Exits early on the boot-race tick where `core/block-editor` hasn't
 * registered yet — `select` returns `null` until the store is available.
 * Once the store is up its selectors and actions are registered together,
 * so we don't re-check the dispatch side.
 */
function autoReplaceStravaEmbeds(): void {
	const blockEditor = select(
		'core/block-editor'
	) as BlockEditorSelectors | null;
	if ( ! blockEditor ) {
		return;
	}
	const blocks = blockEditor.getBlocks();
	if ( blocks === lastBlocks ) {
		return;
	}
	lastBlocks = blocks;

	if ( ! initialized ) {
		for ( const block of walk( blocks ) ) {
			skipClientIds.add( block.clientId );
		}
		initialized = true;
		return;
	}

	const actions = dispatch( 'core/block-editor' ) as BlockEditorActions;
	for ( const block of walk( blocks ) ) {
		if (
			'core/embed' !== block.name ||
			skipClientIds.has( block.clientId ) ||
			! isStravaUrl( block.attributes?.url )
		) {
			continue;
		}
		skipClientIds.add( block.clientId );
		actions.__unstableMarkNextChangeAsNotPersistent?.();
		actions.replaceBlock(
			block.clientId,
			createBlock( 'block-for-strava/embed', {
				...pickPreservedAttrs( block.attributes ),
				url: String( block.attributes.url ),
			} )
		);
	}
}

/*
 * Scoped to `core/block-editor` so we don't pay the walk cost on every
 * tick of every other store.
 */
subscribe( autoReplaceStravaEmbeds, 'core/block-editor' );
