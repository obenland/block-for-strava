import { createElement, type ChangeEvent, type ReactNode } from 'react';

interface PlaceholderProps {
	icon?: ReactNode;
	label?: ReactNode;
	instructions?: ReactNode;
	children?: ReactNode;
}

export function Placeholder({
	icon,
	label,
	instructions,
	children,
}: PlaceholderProps) {
	return createElement(
		'div',
		{ 'data-testid': 'placeholder' },
		icon,
		label &&
			createElement('div', { 'data-testid': 'placeholder-label' }, label),
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
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

export function TextControl({
	label,
	hideLabelFromVision,
	value,
	onChange,
	placeholder,
	disabled,
	className,
}: TextControlProps) {
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
		createElement('input', {
			id,
			type: 'text',
			value,
			placeholder,
			disabled,
			'aria-label': label,
			onChange: (event: ChangeEvent<HTMLInputElement>) =>
				onChange(event.target.value),
		})
	);
}

interface ButtonProps {
	children?: ReactNode;
	onClick?: () => void;
	type?: 'button' | 'submit' | 'reset';
	disabled?: boolean;
}

export function Button({
	children,
	onClick,
	type = 'button',
	disabled,
}: ButtonProps) {
	return createElement('button', { type, onClick, disabled }, children);
}

export function Spinner() {
	return createElement('span', {
		'data-testid': 'spinner',
		role: 'progressbar',
	});
}

export function Disabled({ children }: { children?: ReactNode }) {
	return createElement('div', { 'data-testid': 'disabled' }, children);
}

export function ToolbarGroup({ children }: { children?: ReactNode }) {
	return createElement('div', { 'data-testid': 'toolbar-group' }, children);
}

interface ToolbarButtonProps {
	icon?: ReactNode;
	label?: string;
	onClick?: () => void;
}

export function ToolbarButton({ label, onClick }: ToolbarButtonProps) {
	return createElement(
		'button',
		{ type: 'button', 'aria-label': label, onClick },
		label
	);
}
