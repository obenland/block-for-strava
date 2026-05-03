/**
 * `core/embed` → `block-for-strava/embed` conversion.
 *
 * Strava has no oEmbed provider, so a URL pasted on its own line lands
 * in a `core/embed` that renders "Sorry, this content could not be
 * embedded." Two paths convert it:
 *
 * 1. A `transforms.from` block-transform (toolbar "Transform to → Strava").
 * 2. A `subscribe()` watcher on `core/block-editor` that auto-converts
 *    `core/embed` blocks added during the editor session.
 *
 * The watcher records blocks present at editor load as legacy and
 * leaves them alone — the toolbar transform stays available for those.
 */
import { addFilter } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';
import { subscribe, select, dispatch } from '@wordpress/data';

import metadata from './block.json';
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
 * Attributes carried over from the source `core/embed`. Without explicit
 * passthrough, `createBlock` drops everything but `url`, silently
 * discarding alignment, custom classes, anchor, and caption text.
 */
const PRESERVED_ATTR_KEYS = [
	'align',
	'className',
	'anchor',
	'caption',
] as const;

/*
 * `core/embed` supports left/center/right/wide/full, but this block
 * declares a narrower set in `block.json` (currently wide/full).
 * Carrying an unsupported value through would leave the new block in
 * an invalid alignment state, so drop it. Sourced from `block.json` so
 * the two stay in lockstep — adding/removing an align there
 * automatically updates the conversion filter.
 */
const SUPPORTED_ALIGNMENTS = new Set< string >( metadata.supports.align );

function pickPreservedAttrs(
	attrs: SourceAttributes
): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	for ( const key of PRESERVED_ATTR_KEYS ) {
		const value = attrs[ key ];
		if ( undefined === value ) {
			continue;
		}
		if (
			'align' === key &&
			! SUPPORTED_ALIGNMENTS.has( value as string )
		) {
			continue;
		}
		out[ key ] = value;
	}
	return out;
}

function buildStravaBlock( source: SourceAttributes ): unknown {
	return createBlock( 'block-for-strava/embed', {
		...pickPreservedAttrs( source ),
		url: String( source.url ),
	} );
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
			transform: buildStravaBlock,
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

interface EditorSelectors {
	isEditedPostDirty?: () => boolean;
	getCurrentPostId?: () => unknown;
}

interface SiteEditorSelectors {
	getEditedPostId?: () => unknown;
}

interface BlockEditorActions {
	replaceBlock: ( clientId: string, block: unknown ) => unknown;
	/*
	 * Marks the next state change as merging into the previous undo
	 * entry. Without it, paste→core/embed and our auto-convert become
	 * two undo steps and Cmd+Z lands on the broken intermediate.
	 */
	__unstableMarkNextChangeAsNotPersistent?: () => void;
}

/*
 * clientIds the watcher should NOT auto-convert, paired with the URL
 * the block had at marking time. Two populations:
 *
 * - Legacy blocks loaded with the post (silent rewrite would dirty
 *   the post and surprise the author).
 * - Already-converted blocks (subscribe fires multiple times per
 *   dispatch — without dedupe a single paste would queue N replace
 *   calls).
 *
 * Keying on URL means a legacy block whose URL the user actively
 * changes during the session is no longer skipped — the new URL
 * doesn't match the recorded one, so the watcher converts it as a
 * user action. Bounded by distinct clientIds in the session.
 */
const skipClientIds = new Map< string, unknown >();

let initialized = false;

/*
 * The post/template ID the watcher last observed. Used to detect SPA
 * navigation (site editor, custom adapters) where the user switches
 * between documents without a page reload — the watcher's state is
 * stale once the entity changes.
 */
let lastEntityId: unknown = null;

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

/*
 * Identity-cache of the last walked block list. Gutenberg returns the
 * same reference when blocks haven't changed, so we can short-circuit
 * ticks that don't touch the tree (selection moves, etc.).
 */
let lastBlocks: ReadonlyArray< EditorBlock > | null = null;

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

	/*
	 * Detect SPA navigation: when the post editor loads a different
	 * post (rare; usually a page reload), or the site editor swaps
	 * templates without reloading, the watcher's legacy markers from
	 * the prior document don't apply to the new one. Read the entity
	 * ID from `core/editor` (post editor) or `core/edit-site` (site
	 * editor) and reset when it changes between two non-null values.
	 * Done after the `blocks === lastBlocks` short-circuit so the
	 * cheap reference check skips these selector reads on no-op ticks.
	 */
	const editor = select( 'core/editor' ) as EditorSelectors | null;
	const siteEditor = select( 'core/edit-site' ) as SiteEditorSelectors | null;
	const currentEntityId =
		editor?.getCurrentPostId?.() ?? siteEditor?.getEditedPostId?.() ?? null;
	if (
		null !== lastEntityId &&
		null !== currentEntityId &&
		currentEntityId !== lastEntityId
	) {
		skipClientIds.clear();
		initialized = false;
	}
	if ( null !== currentEntityId ) {
		lastEntityId = currentEntityId;
	}

	if ( ! initialized ) {
		/*
		 * Defer init across an empty boot snapshot so saved content
		 * arriving on the next tick isn't mistaken for a fresh paste.
		 */
		if ( 0 === blocks.length ) {
			return;
		}
		initialized = true;
		/*
		 * If the editor is already dirty when the first non-empty walk
		 * happens, the user has just modified the post — fall through
		 * to the conversion loop so a paste at this exact moment isn't
		 * recorded as legacy. Otherwise the post is freshly loaded and
		 * the current blocks are the saved content, which we leave
		 * alone (the toolbar transform stays available).
		 */
		if ( true !== editor?.isEditedPostDirty?.() ) {
			/*
			 * Only mark currently-Strava `core/embed` blocks as
			 * legacy. Paragraphs and non-Strava embeds aren't in
			 * the skip set, so if their attributes ever transition
			 * to a Strava URL (user edits a generic embed's URL)
			 * the watcher can still convert them.
			 */
			for ( const block of walk( blocks ) ) {
				if (
					'core/embed' === block.name &&
					isStravaUrl( block.attributes?.url )
				) {
					skipClientIds.set( block.clientId, block.attributes.url );
				}
			}
			return;
		}
	}

	const actions = dispatch( 'core/block-editor' ) as BlockEditorActions;
	for ( const block of walk( blocks ) ) {
		if (
			'core/embed' !== block.name ||
			! isStravaUrl( block.attributes?.url )
		) {
			continue;
		}
		/*
		 * Skip if we already saw this exact (clientId, url) pair —
		 * either we converted it (the new clientId would be
		 * different so this rarely matches) or it was loaded as
		 * legacy. A URL change to the same clientId no longer
		 * matches, so an actively-edited legacy block converts.
		 */
		if ( skipClientIds.get( block.clientId ) === block.attributes.url ) {
			continue;
		}
		skipClientIds.set( block.clientId, block.attributes.url );
		actions.__unstableMarkNextChangeAsNotPersistent?.();
		actions.replaceBlock(
			block.clientId,
			buildStravaBlock( block.attributes )
		);
	}
}

// Scoped to core/block-editor so we don't walk on every other store's tick.
subscribe( autoReplaceStravaEmbeds, 'core/block-editor' );

/**
 * Test-only reset of module state. Re-importing would orphan the
 * `subscribe` callback registered above; the leading underscores
 * follow WP core's convention for test/experimental exports.
 */
export function __resetForTests(): void {
	skipClientIds.clear();
	initialized = false;
	lastBlocks = null;
	lastEntityId = null;
}
