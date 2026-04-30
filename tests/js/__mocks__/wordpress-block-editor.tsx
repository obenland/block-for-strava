import {
	createElement,
	forwardRef,
	type FormEvent,
	type ReactNode,
	type Ref,
} from 'react';

type BlockPropsArg = { className?: string } | undefined;

interface UseBlockPropsMock {
	( props?: BlockPropsArg ): { className: string };
	save: ( props?: BlockPropsArg ) => { className: string };
}

const useBlockPropsImpl: UseBlockPropsMock = Object.assign(
	jest.fn( ( props?: BlockPropsArg ) => ( {
		className: props?.className ?? 'wp-block',
	} ) ),
	{
		save: jest.fn( ( props?: BlockPropsArg ) => ( {
			className: props?.className ?? 'wp-block',
		} ) ),
	}
) as unknown as UseBlockPropsMock;

export const useBlockProps = useBlockPropsImpl;

export function BlockControls( { children }: { children: ReactNode } ) {
	return createElement(
		'div',
		{ 'data-testid': 'block-controls' },
		children
	);
}

export function InspectorControls( { children }: { children: ReactNode } ) {
	return createElement(
		'div',
		{ 'data-testid': 'inspector-controls' },
		children
	);
}

export function BlockIcon( { icon }: { icon?: unknown } ) {
	return createElement( 'span', {
		'data-testid': 'block-icon',
		'data-has-icon': icon ? 'yes' : 'no',
	} );
}

interface RichTextProps {
	tagName?: string;
	value: string;
	onChange: ( value: string ) => void;
	placeholder?: string;
	className?: string;
	'aria-label'?: string;
}

export const RichText = forwardRef( function RichText(
	{
		tagName = 'div',
		value,
		onChange,
		placeholder,
		className,
		'aria-label': ariaLabel,
	}: RichTextProps,
	ref: Ref< HTMLElement >
) {
	return createElement( tagName, {
		'data-testid': 'rich-text',
		className,
		'aria-label': ariaLabel,
		ref,
		contentEditable: true,
		suppressContentEditableWarning: true,
		children: value || placeholder,
		onInput: ( event: FormEvent< HTMLElement > ) =>
			onChange( event.currentTarget.textContent || '' ),
	} );
} );
