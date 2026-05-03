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
	 * Marks the next state change as merging into the previous undo
	 * entry. Without it, paste→core/embed and our auto-convert become
	 * two undo steps and Cmd+Z lands on the broken intermediate.
	 */
	__unstableMarkNextChangeAsNotPersistent?: () => void;
}

/*
 * clientIds the watcher should NOT auto-convert: legacy blocks loaded
 * with the post (silent rewrite would dirty the post and surprise the
 * author) plus already-converted blocks (subscribe fires multiple times
 * per dispatch — without dedupe a single paste would queue N replace
 * calls). Bounded by distinct clientIds in the session.
 */
const skipClientIds = new Set< string >();

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

	if ( ! initialized ) {
		/*
		 * Defer init across an empty boot snapshot so saved content
		 * arriving on the next tick isn't mistaken for a fresh paste.
		 */
		if ( 0 === blocks.length ) {
			return;
		}
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
}
