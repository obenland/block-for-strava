/**
 * Verifies the route-customization filters wired into core/embed.
 *
 * Two surfaces to pin:
 * - The `blocks.registerBlockType` filter must add the route attributes to
 *   core/embed (and only core/embed); skipping that breaks every editor
 *   write for the Strava variation.
 * - The `editor.BlockEdit` filter must inject the inspector panel only
 *   when the variation is active and the URL is a route — adding it
 *   universally would clutter every embed block in the inserter.
 */
import { applyFilters } from '@wordpress/hooks';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ComponentType } from 'react';

import { StravaRouteInspector } from '../../src/route-controls';

interface AttributeSpec {
	type: 'string' | 'boolean';
	default?: unknown;
	enum?: ReadonlyArray< string >;
}

interface BlockTypeSettings {
	attributes?: Record< string, AttributeSpec >;
}

function applyRegisterFilter(
	settings: BlockTypeSettings,
	name: string
): BlockTypeSettings {
	return applyFilters(
		'blocks.registerBlockType',
		settings,
		name
	) as BlockTypeSettings;
}

interface EditProps {
	name: string;
	attributes: {
		providerNameSlug?: string;
		url?: string;
		stravaRouteMapStyle?: string;
		stravaRouteUnits?: string;
		stravaRouteTerrain?: string;
		stravaRouteFullWidth?: boolean;
		stravaRouteShowDirt?: boolean;
		stravaRouteShowElevation?: boolean;
	};
	setAttributes: ( attrs: Partial< EditProps[ 'attributes' ] > ) => void;
}

function applyBlockEditFilter(
	BaseEdit: ComponentType< EditProps >
): ComponentType< EditProps > {
	return applyFilters(
		'editor.BlockEdit',
		BaseEdit
	) as ComponentType< EditProps >;
}

describe( 'route attribute injection', () => {
	it( 'adds route attributes to core/embed', () => {
		const result = applyRegisterFilter( {}, 'core/embed' );
		const attrs = result.attributes ?? {};
		expect( attrs.stravaRouteMapStyle ).toMatchObject( {
			type: 'string',
			default: 'standard',
		} );
		expect( attrs.stravaRouteTerrain ).toMatchObject( {
			type: 'string',
			default: 'auto',
		} );
		expect( attrs.stravaRouteUnits ).toMatchObject( {
			type: 'string',
			default: 'auto',
		} );
		expect( attrs.stravaRouteFullWidth ).toMatchObject( {
			type: 'boolean',
			default: false,
		} );
		expect( attrs.stravaRouteShowDirt ).toMatchObject( {
			type: 'boolean',
			default: false,
		} );
		expect( attrs.stravaRouteShowElevation ).toMatchObject( {
			type: 'boolean',
			default: true,
		} );
	} );

	it( 'preserves existing core/embed attributes', () => {
		const existing: Record< string, AttributeSpec > = {
			url: { type: 'string' },
			providerNameSlug: { type: 'string' },
		};
		const result = applyRegisterFilter(
			{ attributes: existing },
			'core/embed'
		);
		expect( result.attributes?.url ).toBe( existing.url );
		expect( result.attributes?.providerNameSlug ).toBe(
			existing.providerNameSlug
		);
	} );

	it( 'leaves other blocks untouched', () => {
		const settings: BlockTypeSettings = {
			attributes: { content: { type: 'string' } },
		};
		const result = applyRegisterFilter( settings, 'core/paragraph' );
		expect( result ).toBe( settings );
	} );
} );

describe( 'BlockEdit HOC', () => {
	function FakeEdit() {
		return createElement( 'div', { 'data-testid': 'fake-edit' }, 'fake' );
	}

	it( 'renders only the underlying Edit when not a Strava route block', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'youtube',
					url: 'https://www.youtube.com/watch?v=abc',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.getByTestId( 'fake-edit' ) ).toBeInTheDocument();
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
	} );

	it( 'renders only the underlying Edit for Strava activity URLs', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
	} );

	it( 'renders the inspector panel for Strava route URLs', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/routes/456',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.getByTestId( 'inspector-controls' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'region', { name: /route options/i } )
		).toBeInTheDocument();
	} );

	it( 'leaves other block types alone (e.g. core/paragraph)', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/paragraph',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/routes/456',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
	} );

	it( 'tolerates a missing url attribute (no panel rendered)', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: { providerNameSlug: 'strava' },
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
	} );
} );

describe( 'StravaRouteInspector controls', () => {
	function renderWith( attributes: EditProps[ 'attributes' ] = {} ) {
		const setAttributes = jest.fn();
		render(
			createElement( StravaRouteInspector, {
				name: 'core/embed',
				attributes,
				setAttributes,
			} )
		);
		return setAttributes;
	}

	it( 'toggles `stravaRouteShowElevation`', async () => {
		const setAttributes = renderWith( { stravaRouteShowElevation: true } );
		await userEvent.click(
			screen.getByRole( 'switch', { name: /show elevation profile/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteShowElevation: false,
		} );
	} );

	it( 'changes `stravaRouteUnits`', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'radio', { name: /units: metric/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteUnits: 'metric',
		} );
	} );

	it( 'maps fullWidth radio to the boolean attribute', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'radio', { name: /embed width: responsive/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteFullWidth: true,
		} );
	} );

	it( 'reflects a stored fullWidth=true as the responsive radio', () => {
		renderWith( { stravaRouteFullWidth: true } );
		expect(
			screen.getByRole( 'radio', { name: /embed width: responsive/i } )
		).toBeChecked();
	} );

	it( 'changes `stravaRouteMapStyle`', async () => {
		const setAttributes = renderWith();
		await userEvent.selectOptions(
			screen.getByRole( 'combobox', { name: /map style/i } ),
			'satellite'
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteMapStyle: 'satellite',
		} );
	} );

	it( 'changes `stravaRouteTerrain`', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'radio', { name: /terrain: 3d/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteTerrain: '3d',
		} );
	} );

	it( 'toggles `stravaRouteShowDirt`', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'switch', {
				name: /highlight unpaved surfaces/i,
			} )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteShowDirt: true,
		} );
	} );

	it( 'clamps unknown stored values back to defaults', () => {
		// Hand-edited block comments can persist arbitrary strings; the
		// inspector reads through a clamp so the visible state never
		// disagrees with what the renderer accepts.
		renderWith( {
			stravaRouteMapStyle: 'invalid' as 'standard',
			stravaRouteTerrain: 'bogus' as 'auto',
			stravaRouteUnits: 'unknown' as 'auto',
		} );
		expect(
			screen.getByRole( 'combobox', { name: /map style/i } )
		).toHaveValue( 'standard' );
		expect(
			screen.getByRole( 'radio', { name: /terrain: auto/i } )
		).toBeChecked();
		expect(
			screen.getByRole( 'radio', { name: /units: auto/i } )
		).toBeChecked();
	} );
} );
