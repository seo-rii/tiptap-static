import { Node } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';

import { createHydrator } from '../src/hydrate.js';
import { createStaticNodeViewHook } from '../src/protocol.js';
import { createStaticRenderer } from '../src/runtime.js';
import type { StaticNodeViewMount, StaticNodeViewProps } from '../src/types.js';

describe.each(['compatibility', 'prepared'] as const)('%s failed mount rollback', (runtime) => {
	it.each(['validation', 'content insertion'] as const)(
		'preserves source DOM when %s fails for a NodeView created inside a detached host',
		(failurePhase) => {
			const target = document.createElement('div');
			target.innerHTML =
				'<rollback-card id="bad"><button>Original body</button></rollback-card>' +
				'<rollback-card id="good">Sibling</rollback-card>';
			const sourceNodes = [...target.childNodes];
			const source = target.firstElementChild!;
			const button = target.querySelector('button')!;
			const clicked = vi.fn();
			button.addEventListener('click', clicked);
			const destroyed: string[] = [];
			const detachedHost = document.createElement('aside');
			const mount: StaticNodeViewMount = ({ node }) => {
				const id = String(node.attrs.id);
				const dom = document.createElement('article');
				dom.dataset.id = id;
				const contentDOM = document.createElement('main');
				if (id === 'bad') {
					detachedHost.append(dom);
					if (failurePhase === 'content insertion') {
						dom.append(contentDOM);
						contentDOM.replaceChildren = () => {
							throw new Error('Content insertion failed');
						};
					}
				} else {
					dom.append(contentDOM);
				}
				return { dom, contentDOM, destroy: () => destroyed.push(id) };
			};
			const extension = Node.create({
				name: 'rollback-card',
				group: 'block',
				content: 'block*',
				addAttributes: () => ({ id: { default: '' } }),
				parseHTML: () => [{ tag: 'rollback-card' }],
				renderHTML: ({ HTMLAttributes }) => ['rollback-card', HTMLAttributes, 0],
				addNodeView: () => ((props: StaticNodeViewProps) => mount(props)) as never
			});
			const renderer =
				runtime === 'compatibility'
					? createStaticRenderer({ extensions: [extension] })
					: createHydrator({
							nodes: [{
								name: 'rollback-card',
								rules: [{
									selector: 'rollback-card',
									parse: (element) => ({ attrs: { id: element.id } })
								}],
								type: { isLeaf: false, spec: { content: 'block*' } },
								nodeView: createStaticNodeViewHook(mount)
							}]
						});

			const session = renderer.enhance(target);

			expect(target.firstElementChild).toBe(source);
			expect(source.firstElementChild).toBe(button);
			expect(detachedHost.contains(source)).toBe(false);
			expect(target.querySelector('[data-id="good"]')?.textContent).toBe('Sibling');
			expect(destroyed).toEqual(['bad']);
			expect(renderer.diagnostics).toContainEqual(
				expect.objectContaining({
					code: failurePhase === 'validation' ? 'invalid-content-dom' : 'mount-failed',
					extension: 'rollback-card'
				})
			);
			button.click();
			expect(clicked).toHaveBeenCalledOnce();

			session.destroy();
			expect([...target.childNodes]).toEqual(sourceNodes);
			expect(source.firstElementChild).toBe(button);
			expect(destroyed).toEqual(['bad', 'good']);
			button.click();
			expect(clicked).toHaveBeenCalledTimes(2);
		}
	);
});
