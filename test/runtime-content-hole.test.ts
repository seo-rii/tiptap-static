import { Node } from '@tiptap/core';
import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import { createStaticRenderer } from '../src/runtime.js';
import type { StaticNodeViewProps } from '../src/types.js';

describe('serialized content hole selection', () => {
	it.each<{ name: string; spec: DOMOutputSpec }>([
		{
			name: 'same-tag siblings',
			spec: ['content-card', ['div', 'Title'], ['div', 0]]
		},
		{
			name: 'text mixed with element siblings',
			spec: ['content-card', 'Prefix', ['div', 'Title'], 'Separator', ['div', 0]]
		},
		{
			name: 'nested same-tag siblings',
			spec: ['content-card', ['div', 'Title'], ['div', ['div', 'Label'], ['div', 0]]]
		}
	])('uses the actual hole for $name and restores the source', ({ spec }) => {
		const received = vi.fn();
		const extension = Node.create({
			name: 'content-card',
			group: 'block',
			content: 'block*',
			parseHTML: () => [{ tag: 'content-card' }],
			renderHTML: () => spec,
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					received(props.node.textContent);
					const dom = document.createElement('article');
					const contentDOM = document.createElement('main');
					dom.append(contentDOM);
					return { dom, contentDOM };
				}) as never;
			}
		});
		const { dom, contentDOM } = DOMSerializer.renderSpec(document, spec);
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Actual body';
		contentDOM!.append(paragraph);
		const target = document.createElement('div');
		target.append(dom);
		const originalHTML = target.innerHTML;
		const renderer = createStaticRenderer({ extensions: [extension] });

		const session = renderer.enhance(target);

		expect(received).toHaveBeenCalledExactlyOnceWith('Actual body');
		expect(target.querySelector('article main p')).toBe(paragraph);
		expect(target.textContent).toBe('Actual body');
		expect(renderer.diagnostics).toEqual([]);
		session.destroy();
		expect(target.firstChild).toBe(dom);
		expect(contentDOM!.firstChild).toBe(paragraph);
		expect(target.innerHTML).toBe(originalHTML);
	});
});
