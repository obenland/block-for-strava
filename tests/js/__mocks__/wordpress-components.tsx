import { createElement, type ChangeEvent, type ReactNode } from 'react';

interface PlaceholderProps {
	icon?: ReactNode;
	label?: ReactNode;
	instructions?: ReactNode;
	children?: ReactNode;
}

export function Placeholder( {
	icon,
	label,
	instructions,
	children,
}: PlaceholderProps ) {
	return createElement(
		'div',
		{ 'data-testid': 'placeholder' },
		icon,
		label &&
			createElement(
				'div',
				{ 'data-testid': 'placeholder-label' },
				label
			),
		instructions &&
			createElement(
				'div',
				{ 'data-testid': 'placeholder-instructions' },
				instructions
			),
		children
	);
}

interface TextControlProps {
	label?: string;
	hideLabelFromVision?: boolean;
	value: string;
	onChange: ( value: string ) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

export function TextControl( {
	label,
	hideLabelFromVision,
	value,
	onChange,
	placeholder,
	disabled,
	className,
}: TextControlProps ) {
	const id = 'text-control';
	return createElement(
		'div',
		{ className },
		label &&
			createElement(
				'label',
				{
					htmlFor: id,
					style: hideLabelFromVision
						? { position: 'absolute', clip: 'rect(0 0 0 0)' }
						: undefined,
				},
				label
			),
		createElement( 'input', {
			id,
			type: 'text',
			value,
			placeholder,
			disabled,
			'aria-label': label,
			onChange: ( event: ChangeEvent< HTMLInputElement > ) =>
				onChange( event.target.value ),
		} )
	);
}

interface ButtonProps {
	children?: ReactNode;
	onClick?: () => void;
	type?: 'button' | 'submit' | 'reset';
	disabled?: boolean;
	variant?: 'primary' | 'secondary' | 'tertiary' | 'link';
}

export function Button( {
	children,
	onClick,
	type = 'button',
	disabled,
}: ButtonProps ) {
	return createElement( 'button', { type, onClick, disabled }, children );
}

export function Spinner() {
	return createElement( 'span', {
		'data-testid': 'spinner',
		role: 'progressbar',
	} );
}

export function Disabled( { children }: { children?: ReactNode } ) {
	return createElement( 'div', { 'data-testid': 'disabled' }, children );
}

export function ToolbarGroup( { children }: { children?: ReactNode } ) {
	return createElement( 'div', { 'data-testid': 'toolbar-group' }, children );
}

interface ToolbarButtonProps {
	icon?: ReactNode;
	label?: string;
	onClick?: () => void;
	isActive?: boolean;
}

export function ToolbarButton( {
	label,
	onClick,
	isActive,
}: ToolbarButtonProps ) {
	return createElement(
		'button',
		{
			type: 'button',
			'aria-label': label,
			...( isActive !== undefined && { 'aria-pressed': isActive } ),
			onClick,
		},
		label
	);
}

interface PanelBodyProps {
	title?: ReactNode;
	initialOpen?: boolean;
	children?: ReactNode;
}

export function PanelBody( { title, children }: PanelBodyProps ) {
	return createElement(
		'section',
		{
			'data-testid': 'panel-body',
			'aria-label': typeof title === 'string' ? title : undefined,
		},
		title && createElement( 'h2', null, title ),
		children
	);
}

interface ToggleControlProps {
	label: string;
	checked: boolean;
	onChange: ( value: boolean ) => void;
	help?: ReactNode;
}

export function ToggleControl( {
	label,
	checked,
	onChange,
}: ToggleControlProps ) {
	return createElement(
		'label',
		null,
		createElement( 'input', {
			type: 'checkbox',
			role: 'switch',
			'aria-label': label,
			checked,
			onChange: ( event: ChangeEvent< HTMLInputElement > ) =>
				onChange( event.target.checked ),
		} ),
		label
	);
}

interface RadioOption {
	label: string;
	value: string;
}

interface RadioControlProps {
	label: string;
	selected: string;
	options: RadioOption[];
	onChange: ( value: string ) => void;
	help?: ReactNode;
}

export function RadioControl( {
	label,
	selected,
	options,
	onChange,
}: RadioControlProps ) {
	return createElement(
		'fieldset',
		{ 'aria-label': label },
		createElement( 'legend', null, label ),
		...options.map( ( option ) =>
			createElement(
				'label',
				{ key: option.value },
				createElement( 'input', {
					type: 'radio',
					name: label,
					value: option.value,
					checked: selected === option.value,
					'aria-label': `${ label }: ${ option.label }`,
					onChange: ( event: ChangeEvent< HTMLInputElement > ) => {
						if ( event.target.checked ) {
							onChange( option.value );
						}
					},
				} ),
				option.label
			)
		)
	);
}

interface SelectOption {
	label: string;
	value: string;
}

interface SelectControlProps {
	label: string;
	value: string;
	options: SelectOption[];
	onChange: ( value: string ) => void;
}

export function SelectControl( {
	label,
	value,
	options,
	onChange,
}: SelectControlProps ) {
	return createElement(
		'label',
		null,
		label,
		createElement(
			'select',
			{
				value,
				'aria-label': label,
				onChange: ( event: ChangeEvent< HTMLSelectElement > ) =>
					onChange( event.target.value ),
			},
			...options.map( ( option ) =>
				createElement(
					'option',
					{ key: option.value, value: option.value },
					option.label
				)
			)
		)
	);
}
