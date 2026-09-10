import { Node, getAttributesFromExtensions, getRenderedAttributes, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { createLightRenderer } from '../src/light.js';
import type { StaticNodeViewProps } from '../src/types.js';

const Document = Node.create({ name: 'doc', topNode: true, content: 'block*' });
const Text = Node.create({ name: 'text', group: 'inline' });

function parsedStyle(css: string): Record<string, { value: string; priority: string }> {
	const style = document.createElement('div').style;
	style.cssText = css;
	return Object.fromEntries(Array.from({ length: style.length }, (_, index) => {
		const property = style.item(index);
		return [property, { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) }];
	}));
}

describe('rendered CSS attribute merging', () => {
	it.each([
		{
			label: 'URL colons and semicolons',
			first: 'background-image: url("https://example.com/image.svg?a=1;b=2"); color: red',
			second: 'width: 10px; color: blue'
		},
		{
			label: 'quoted punctuation and custom properties',
			first: 'content: "chapter;a:b"; --label: "first;second"',
			second: 'color: blue; --label: "replacement;still:valid"'
		},
		{
			label: 'later ordinary property replaces an earlier important property',
			first: 'color: red !important; width: 1px',
			second: 'color: blue; height: 2px'
		},
		{
			label: 'later important property retains its priority',
			first: 'color: red; width: 1px',
			second: 'color: blue !important; height: 2px'
		}
	])('matches official rendered attributes for $label', ({ first, second }) => {
		let renderedStyle: string | undefined;
		const Card = Node.create({
			name: 'styledCard',
			group: 'block',
			atom: true,
			addAttributes: () => ({
				first: { default: null, renderHTML: () => ({ style: first }) },
				second: { default: null, renderHTML: () => ({ style: second }) }
			}),
			parseHTML: () => [{ tag: 'styled-card' }],
			renderHTML: ({ HTMLAttributes }) => ['styled-card', HTMLAttributes],
			addNodeView: () => ((props: StaticNodeViewProps) => {
				renderedStyle = String(props.HTMLAttributes.style);
				return { dom: document.createElement('output') };
			}) as never
		});
		const extensions = [Document, Text, Card];
		const expected = getRenderedAttributes(
			getSchema(extensions).nodes.styledCard.create(),
			getAttributesFromExtensions(extensions)
		).style;
		// Render into a separate document, as when enhancing iframe contents.
		const target = document.implementation.createHTMLDocument().createElement('div');
		const renderer = createLightRenderer({ extensions, rawNodeViews: true });
		const session = renderer.mount(target, '<styled-card></styled-card>');

		expect(renderedStyle).toBeDefined();
		expect(parsedStyle(renderedStyle!)).toEqual(parsedStyle(expected));
		expect(renderer.diagnostics).toEqual([]);
		session.destroy();
	});
});
