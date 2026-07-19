import { Node } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';

import { createStaticRenderer } from '../src/runtime.js';
import type { StaticNodeViewProps } from '../src/types.js';

describe('static NodeView edge contracts', () => {
	it('falls through getAttrs=false rules and applies fromString only to raw attributes', () => {
		let received: StaticNodeViewProps | undefined;
		const extension = Node.create({
			name: 'rule-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return {
					picked: { default: '' },
					number: { default: null },
					exponent: { default: null },
					flag: { default: null },
					custom: { default: null, parseHTML: () => '12' }
				};
			},
			parseHTML() {
				return [
					{ tag: 'rule-node[data-skip]', priority: 100, getAttrs: () => false },
					{ tag: 'rule-node', attrs: { picked: 'fallback' } }
				];
			},
			renderHTML({ HTMLAttributes }) {
				return ['rule-node', HTMLAttributes];
			},
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					received = props;
					return { dom: document.createElement('output') };
				}) as never;
			}
		});
		const target = document.createElement('div');

		createStaticRenderer({
			extensions: [extension],
			sanitize: { allowedAttributes: { 'rule-node': ['data-skip'] } }
		}).mount(
			target,
			'<rule-node data-skip="true" number="+.5" exponent="1e3" flag="false"></rule-node>'
		);

		expect(received?.node.attrs).toMatchObject({
			picked: 'fallback',
			number: 0.5,
			exponent: '1e3',
			flag: false,
			custom: '12'
		});
	});

	it('uses parse-rule contentElement before the renderHTML hole', () => {
		let textContent = '';
		const extension = Node.create({
			name: 'content-element-node',
			group: 'block',
			content: 'text*',
			parseHTML() {
				return [{ tag: 'content-element-node', contentElement: 'code' }];
			},
			renderHTML() {
				return ['content-element-node', ['div', 0]];
			},
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					textContent = props.node.textContent;
					const dom = document.createElement('section');
					const contentDOM = document.createElement('div');
					contentDOM.dataset.slot = '';
					dom.append(contentDOM);
					return { dom, contentDOM };
				}) as never;
			}
		});
		const target = document.createElement('div');

		createStaticRenderer({ extensions: [extension] }).mount(
			target,
			'<content-element-node><span>outside</span><code>inside<strong> bold</strong></code></content-element-node>'
		);

		expect(textContent).toBe('inside bold');
		expect(target.querySelector('[data-slot]')?.textContent).toBe('inside bold');
		expect(target.querySelector('[data-slot] code')).toBeNull();
		expect(target.textContent).not.toContain('outside');
	});

	it('preserves a node whose required attribute is missing', () => {
		const mounted = vi.fn();
		const extension = Node.create({
			name: 'required-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return { token: { default: undefined, isRequired: true } };
			},
			parseHTML: () => [{ tag: 'required-node' }],
			renderHTML: ({ HTMLAttributes }) => ['required-node', HTMLAttributes],
			addNodeView() {
				return (() => {
					mounted();
					return { dom: document.createElement('span') };
				}) as never;
			}
		});
		const renderer = createStaticRenderer({ extensions: [extension] });
		const target = document.createElement('div');

		renderer.mount(target, '<required-node></required-node>');

		expect(mounted).not.toHaveBeenCalled();
		expect(target.querySelector('required-node')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'required-attribute-missing',
				extension: 'required-node'
			})
		);
	});

	it('merges rendered class and style attributes like Tiptap', () => {
		let HTMLAttributes: Record<string, unknown> | undefined;
		const extension = Node.create({
			name: 'rendered-attributes-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return {
					first: {
						default: true,
						renderHTML: () => ({
							class: 'alpha beta',
							style: 'color: red; width: 1px'
						})
					},
					second: {
						default: true,
						renderHTML: () => ({
							class: 'beta gamma',
							style: 'color: blue; height: 2px'
						})
					}
				};
			},
			parseHTML: () => [{ tag: 'rendered-attributes-node' }],
			renderHTML: ({ HTMLAttributes: attributes }) => [
				'rendered-attributes-node',
				attributes
			],
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					HTMLAttributes = props.HTMLAttributes;
					return { dom: document.createElement('span') };
				}) as never;
			}
		});

		createStaticRenderer({ extensions: [extension] }).mount(
			document.createElement('div'),
			'<rendered-attributes-node></rendered-attributes-node>'
		);

		expect(HTMLAttributes).toEqual({
			class: 'alpha beta gamma',
			style: 'color: blue; width: 1px; height: 2px'
		});
	});

	it('keeps atom and leaf semantics distinct when an atom has content', () => {
		let receivedNode: StaticNodeViewProps['node'] | undefined;
		const extension = Node.create({
			name: 'atom-container',
			group: 'block',
			atom: true,
			content: 'block*',
			parseHTML: () => [{ tag: 'atom-container' }],
			renderHTML: () => ['atom-container', 0],
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					receivedNode = props.node;
					const dom = document.createElement('section');
					const contentDOM = document.createElement('div');
					dom.append(contentDOM);
					return { dom, contentDOM };
				}) as never;
			}
		});
		const target = document.createElement('div');

		createStaticRenderer({ extensions: [extension] }).mount(
			target,
			'<atom-container><p>content</p></atom-container>'
		);

		expect(receivedNode).toMatchObject({ isAtom: true, isLeaf: false, nodeSize: 9 });
		expect(target.querySelector('section p')?.textContent).toBe('content');
	});

	it('continues child-first destruction after one NodeView destroy throws', () => {
		const destroyed: string[] = [];
		const errors: unknown[] = [];
		const extension = Node.create({
			name: 'destroy-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return { id: { default: '' } };
			},
			parseHTML: () => [{ tag: 'destroy-node' }],
			renderHTML: ({ HTMLAttributes }) => ['destroy-node', HTMLAttributes],
			addNodeView() {
				return (({ node }: StaticNodeViewProps) => ({
					dom: document.createElement('span'),
					destroy() {
						const id = String(node.attrs.id);
						destroyed.push(id);
						if (id === 'second') throw new Error('destroy second');
					}
				})) as never;
			}
		});
		const target = document.createElement('div');
		const renderer = createStaticRenderer({
			extensions: [extension],
			onError: (error) => errors.push(error)
		});
		const session = renderer.mount(
			target,
			'<destroy-node id="first"></destroy-node><destroy-node id="second"></destroy-node>'
		);

		session.destroy();

		expect(destroyed).toEqual(['second', 'first']);
		expect(errors).toHaveLength(1);
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'destroy-failed' })
		);
		expect(target.querySelectorAll('destroy-node')).toHaveLength(2);
	});

	it('hands target ownership to a newer renderer session without stale restoration', () => {
		let firstDestroyed = 0;
		let secondDestroyed = 0;
		const firstExtension = Node.create({
			name: 'first-session-node',
			group: 'block',
			atom: true,
			parseHTML: () => [{ tag: 'first-session-node' }],
			renderHTML: () => ['first-session-node'],
			addNodeView() {
				return (() => ({
					dom: Object.assign(document.createElement('output'), { textContent: 'first mounted' }),
					destroy: () => (firstDestroyed += 1)
				})) as never;
			}
		});
		const secondExtension = Node.create({
			name: 'second-session-node',
			group: 'block',
			atom: true,
			parseHTML: () => [{ tag: 'second-session-node' }],
			renderHTML: () => ['second-session-node'],
			addNodeView() {
				return (() => ({
					dom: Object.assign(document.createElement('output'), { textContent: 'second mounted' }),
					destroy: () => (secondDestroyed += 1)
				})) as never;
			}
		});
		const target = document.createElement('div');
		const first = createStaticRenderer({ extensions: [firstExtension] }).mount(
			target,
			'<first-session-node></first-session-node>'
		);
		const second = createStaticRenderer({ extensions: [secondExtension] }).mount(
			target,
			'<second-session-node></second-session-node>'
		);

		expect(firstDestroyed).toBe(1);
		expect(target.textContent).toBe('second mounted');
		first.destroy();
		expect(target.textContent).toBe('second mounted');
		second.destroy();
		expect(secondDestroyed).toBe(1);
		expect(target.querySelector('second-session-node')).not.toBeNull();
	});

	it('destroys a partially created NodeView when its dom getter throws', () => {
		const destroy = vi.fn();
		const extension = Node.create({
			name: 'throwing-dom-node',
			group: 'block',
			atom: true,
			parseHTML: () => [{ tag: 'throwing-dom-node' }],
			renderHTML: () => ['throwing-dom-node'],
			addNodeView() {
				return (() => ({
					get dom() {
						throw new Error('dom getter failed');
					},
					destroy
				})) as never;
			}
		});
		const target = document.createElement('div');
		const renderer = createStaticRenderer({ extensions: [extension] });

		renderer.mount(target, '<throwing-dom-node></throwing-dom-node>');

		expect(destroy).toHaveBeenCalledOnce();
		expect(target.querySelector('throwing-dom-node')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'mount-failed', extension: 'throwing-dom-node' })
		);
	});

	it('keeps the current mounted tree alive when sanitizing an update throws', () => {
		const destroy = vi.fn();
		const extension = Node.create({
			name: 'atomic-update-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return { id: { default: '' } };
			},
			parseHTML: () => [{ tag: 'atomic-update-node' }],
			renderHTML: ({ HTMLAttributes }) => ['atomic-update-node', HTMLAttributes],
			addNodeView() {
				return (({ node }: StaticNodeViewProps) => {
					const dom = document.createElement('output');
					dom.dataset.id = String(node.attrs.id);
					return { dom, destroy };
				}) as never;
			}
		});
		const renderer = createStaticRenderer({
			extensions: [extension],
			sanitize: {
				attributeValidators: {
					'atomic-update-node': {
						id(value) {
							if (value === 'bad') throw new Error('invalid id');
							return true;
						}
					}
				}
			}
		});
		const target = document.createElement('div');
		const session = renderer.mount(
			target,
			'<atomic-update-node id="good"></atomic-update-node>'
		);
		const mounted = target.firstChild;

		expect(() =>
			session.update('<atomic-update-node id="bad"></atomic-update-node>')
		).toThrow('invalid id');
		expect(target.firstChild).toBe(mounted);
		expect(target.querySelector('output')?.dataset.id).toBe('good');
		expect(destroy).not.toHaveBeenCalled();
		expect(() =>
			renderer.mount(target, '<atomic-update-node id="bad"></atomic-update-node>')
		).toThrow('invalid id');
		expect(target.firstChild).toBe(mounted);
		expect(destroy).not.toHaveBeenCalled();
	});
});
