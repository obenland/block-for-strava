import {
	createElement,
	forwardRef,
	type FormEvent,
	type ReactNode,
	type Ref,
} from 'react';

export const useBlockProps = jest.fn( () => ( {
	className: 'wp-block',
} ) );

export function BlockControls( { children }: { children: ReactNode } ) {
	return createElement(
		'div',
		{ 'data-testid': 'block-controls' },
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
