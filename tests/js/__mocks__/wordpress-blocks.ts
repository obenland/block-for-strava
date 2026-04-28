export const registerBlockType = jest.fn();

export const createBlock = jest.fn(
	( name: string, attributes: Record< string, unknown > = {} ) => ( {
		name,
		attributes,
		clientId: 'mock-client-id',
		innerBlocks: [],
		isValid: true,
	} )
);
