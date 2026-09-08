import { Node } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';

import { createStaticRenderer } from '../src/runtime.js';
import type { StaticNodeViewProps } from '../src/types.js';

describe('attribute rendering failures', () => {
	it('preserves the failing source, mounts later siblings, and keeps session cleanup usable', () => {
		const destroyed: string[] = [];
		const failure = new Error('Cannot render bad attributes');
		const onError = vi.fn();
		const extension = Node.create({
			name: 'attribute-card',
			group: 'block',
			atom: true,
			addAttributes() {
				return {
					id: {
						default: '',
						renderHTML: ({ id }) => {
							if (id === 'bad') throw failure;
							return { id };
						}
					}
				};
			},
			parseHTML: () => [{ tag: 'attribute-card' }],
			renderHTML: ({ HTMLAttributes }) => ['attribute-card', HTMLAttributes],
			addNodeView() {
				return (({ node }: StaticNodeViewProps) => {
					const id = String(node.attrs.id);
					const dom = document.createElement('output');
					dom.dataset.id = id;
					return { dom, destroy: () => destroyed.push(id) };
				}) as never;
			}
		});
		const target = document.createElement('div');
		target.innerHTML =
			'<attribute-card id="first"></attribute-card>' +
			'<attribute-card id="bad">Preserved</attribute-card>' +
			'<attribute-card id="last"></attribute-card>';
		const sourceNodes = [...target.childNodes];
		const renderer = createStaticRenderer({ extensions: [extension], onError });

		const session = renderer.enhance(target);

		expect(target.querySelector('[data-id="first"]')).not.toBeNull();
		expect(target.querySelector('#bad')).toBe(sourceNodes[1]);
		expect(target.querySelector('#bad')?.textContent).toBe('Preserved');
		expect(target.querySelector('[data-id="last"]')).not.toBeNull();
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			failure,
			expect.objectContaining({ code: 'mount-failed', extension: 'attribute-card', cause: failure })
		);
		expect(destroyed).toEqual([]);

		const replacement = renderer.enhance(target);
		expect(destroyed).toEqual(['last', 'first']);
		session.destroy();
		expect(destroyed).toEqual(['last', 'first']);
		replacement.destroy();
		expect(destroyed).toEqual(['last', 'first', 'last', 'first']);
		expect([...target.childNodes]).toEqual(sourceNodes);
	});
});
