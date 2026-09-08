import { Extension, Mark, Node, getAttributesFromExtensions } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { inspectExtensions } from '../src/extensions.js';
import { sanitizeTiptapHTML } from '../src/sanitize.js';

const Text = Node.create({ name: 'text', group: 'inline' });
const Card = Node.create({
	name: 'card',
	parseHTML: () => [{ tag: 'x-card' }],
	renderHTML: ({ HTMLAttributes }) => ['x-card', HTMLAttributes]
});
const Label = Mark.create({
	name: 'label',
	parseHTML: () => [{ tag: 'x-label' }],
	renderHTML: ({ HTMLAttributes }) => ['x-label', HTMLAttributes, 0]
});

describe('global attribute targets', () => {
	it.each([
		{ types: '*' as const, targets: ['card', 'label'] },
		{ types: 'nodes' as const, targets: ['card'] },
		{ types: 'marks' as const, targets: ['label'] },
		{ types: ['label', 'card'], targets: ['label', 'card'] },
		{ types: ['text'], targets: ['text'] },
		{ types: [], targets: [] }
	])('matches Tiptap attribute resolution for $types', ({ types, targets }) => {
		const Tracking = Extension.create({
			name: 'tracking',
			addGlobalAttributes: () => [{ types, attributes: { 'data-track': { default: null } } }]
		});
		// Marks precede nodes in the input; wildcard expansion still follows Tiptap's node/mark order.
		const extensions = [Label, Text, Card, Tracking];
		const inspection = inspectExtensions(extensions);
		const actual = inspection.attributes.map(({ type, name }) => ({ type, name }));
		const expected = getAttributesFromExtensions(extensions).map(({ type, name }) => ({ type, name }));

		expect(actual).toEqual(expected);
		expect(actual.map(({ type }) => type)).toEqual(targets);
		expect(inspection.diagnostics).toEqual([]);

		const html = sanitizeTiptapHTML(
			'<x-card data-track="card"><x-label data-track="label">text</x-label></x-card>',
			extensions
		);
		const target = document.createElement('div');
		target.innerHTML = html;
		expect(target.querySelector('x-card')?.hasAttribute('data-track')).toBe(targets.includes('card'));
		expect(target.querySelector('x-label')?.hasAttribute('data-track')).toBe(targets.includes('label'));
	});
});
