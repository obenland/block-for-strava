import { createElement, type ReactNode } from 'react';

export const useBlockProps = jest.fn(() => ({
	className: 'wp-block',
}));

export function BlockControls({ children }: { children: ReactNode }) {
	return createElement('div', { 'data-testid': 'block-controls' }, children);
}

export function BlockIcon({ icon }: { icon?: unknown }) {
	return createElement('span', {
		'data-testid': 'block-icon',
		'data-has-icon': icon ? 'yes' : 'no',
	});
}

interface RichTextProps {
	tagName?: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
}

export function RichText({
	tagName = 'div',
	value,
	onChange,
	placeholder,
	className,
}: RichTextProps) {
	return createElement(tagName, {
		'data-testid': 'rich-text',
		className,
		contentEditable: true,
		suppressContentEditableWarning: true,
		children: value || placeholder,
		onInput: (event: React.FormEvent<HTMLElement>) =>
			onChange(event.currentTarget.textContent || ''),
	});
}
