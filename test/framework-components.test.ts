import { Node } from '@tiptap/core';
import {
	NodeViewContent as ReactNodeViewContent,
	NodeViewWrapper as ReactNodeViewWrapper,
	ReactNodeViewContext,
	ReactNodeViewRenderer
} from '@tiptap/react';
import {
	NodeViewContent as VueNodeViewContent,
	NodeViewWrapper as VueNodeViewWrapper,
	VueNodeViewRenderer,
	nodeViewProps
} from '@tiptap/vue-3';
import {
	createElement,
	useLayoutEffect,
	useState,
	type ComponentType
} from 'react';
import { flushSync as flushReact } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
	flushSync as flushSvelte,
	mount as mountSvelte,
	tick,
	unmount as unmountSvelte,
	type Component as SvelteComponent
} from 'svelte';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import {
	createApp,
	defineComponent,
	h,
	inject,
	nextTick,
	onMounted,
	onUnmounted,
	ref,
	type Component as VueComponent
} from 'vue';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { createLightRenderer } from '../src/light.js';
import {
	setStaticNodeViewRuntime,
	type StaticNodeViewProps,
	type StaticNodeViewRenderer,
	type StaticNodeViewRuntime
} from '../src/protocol.js';
import StaticNodeView from './fixtures/StaticNodeView.svelte';

interface FrameworkComponentProps extends StaticNodeViewProps {
	onStaticMount: () => void;
	onStaticDestroy: () => void;
	onStaticClick: () => void;
}

function createContainerExtension(name: string, renderer: StaticNodeViewRenderer) {
	return Node.create({
		name,
		group: 'block',
		content: 'block*',
		addAttributes() {
			return { title: { default: '' } };
		},
		parseHTML() {
			return [{ tag: name }];
		},
		renderHTML({ HTMLAttributes }) {
			return [name, HTMLAttributes, 0];
		},
		addNodeView() {
			return renderer as never;
		}
	});
}

async function exerciseFrameworkRuntime(options: {
	name: string;
	componentSelector: string;
	rawRenderer: Mock;
	runtime: StaticNodeViewRuntime;
	mounted: Mock;
	destroyed: Mock;
	clicked: Mock;
	settle: () => void | Promise<void>;
	click: (button: HTMLButtonElement) => void | Promise<void>;
	assertMounted?: (component: HTMLElement) => void;
}) {
	const extension = createContainerExtension(options.name, options.rawRenderer as never);
	const renderer = createLightRenderer({
		extensions: [extension],
		nodeViewRuntimes: [options.runtime]
	});
	const target = document.createElement('div');
	const session = renderer.mount(
		target,
		`<${options.name} title="first"><p>first content</p></${options.name}>`
	);
	await options.settle();

	const firstComponent = target.querySelector<HTMLElement>(options.componentSelector);
	const firstButton = firstComponent?.querySelector<HTMLButtonElement>('[data-static-click]');
	expect(options.rawRenderer).not.toHaveBeenCalled();
	expect(firstComponent?.hasAttribute('data-node-view-wrapper')).toBe(true);
	expect(firstComponent?.getAttribute('data-editable')).toBe('false');
	expect(firstComponent?.getAttribute('data-static-selected')).toBe('false');
	expect(firstComponent?.querySelector('strong')?.textContent).toBe('first');
	expect(firstComponent?.querySelector('[data-static-content] p')?.textContent).toBe(
		'first content'
	);
	expect(firstButton?.textContent).toBe('clicks:0');
	expect(options.mounted).toHaveBeenCalledOnce();
	expect(options.destroyed).not.toHaveBeenCalled();
	options.assertMounted?.(firstComponent!);

	await options.click(firstButton!);
	expect(firstButton?.textContent).toBe('clicks:1');
	expect(options.clicked).toHaveBeenCalledOnce();
	expect(firstComponent?.querySelector('[data-static-content] p')?.textContent).toBe(
		'first content'
	);

	session.update(
		`<${options.name} title="second"><p>second content</p></${options.name}>`
	);
	await options.settle();
	expect(options.mounted).toHaveBeenCalledTimes(2);
	expect(options.destroyed).toHaveBeenCalledOnce();
	expect(target.querySelector(`${options.componentSelector} strong`)?.textContent).toBe('second');
	expect(
		target.querySelector(`${options.componentSelector} [data-static-content] p`)?.textContent
	).toBe('second content');

	session.destroy();
	await options.settle();
	expect(options.destroyed).toHaveBeenCalledTimes(2);
	expect(target.querySelector(options.componentSelector)).toBeNull();
	expect(target.querySelector(`${options.name}[title="second"] p`)?.textContent).toBe(
		'second content'
	);
	expect(renderer.diagnostics).toEqual([]);

	session.destroy();
	expect(options.destroyed).toHaveBeenCalledTimes(2);
}

describe('real framework component runtimes', () => {
	it('mounts the real svelte-tiptap wrapper and content components through /light', async () => {
		const runtimeKey = Symbol.for('svelte-tiptap/static-node-view-runtime/v1');
		const mounted = vi.fn();
		const destroyed = vi.fn();
		const clicked = vi.fn();
		const descriptor = {
			component: StaticNodeView as SvelteComponent,
			onStaticMount: mounted,
			onStaticDestroy: destroyed,
			onStaticClick: clicked
		};
		const rawRenderer = vi.fn(
			SvelteNodeViewRenderer(StaticNodeView) as never
		) as unknown as Mock;
		setStaticNodeViewRuntime(rawRenderer, runtimeKey, descriptor);
		const runtime: StaticNodeViewRuntime<typeof descriptor> = {
			key: runtimeKey,
			mount({ value, props }) {
				const dom = document.createElement(props.node.isInline ? 'span' : 'div');
				dom.classList.add(`node-${props.node.type.name}`);
				const context = new Map<unknown, unknown>([
					['TipTapNodeView', { onDragStart: () => undefined }]
				]);
				const component = mountSvelte(value.component, {
					target: dom,
					props: {
						...props,
						onStaticMount: value.onStaticMount,
						onStaticDestroy: value.onStaticDestroy,
						onStaticClick: value.onStaticClick
					},
					context
				});
				flushSvelte();
				if (!dom.firstElementChild?.hasAttribute('data-node-view-wrapper')) {
					void unmountSvelte(component);
					throw new Error('Svelte NodeView must use NodeViewWrapper.');
				}
				const contentDOM = props.node.isLeaf
					? null
					: document.createElement(props.node.isInline ? 'span' : 'div');
				if (contentDOM) {
					contentDOM.style.whiteSpace = 'inherit';
					const contentTarget = dom.querySelector('[data-node-view-content]');
					if (!contentTarget) {
						void unmountSvelte(component);
						throw new Error('Svelte NodeView must use NodeViewContent.');
					}
					contentTarget.append(contentDOM);
				}
				return {
					dom,
					contentDOM,
					destroy() {
						void unmountSvelte(component);
						flushSvelte();
					}
				};
			}
		};

		await exerciseFrameworkRuntime({
			name: 'svelte-runtime-card',
			componentSelector: '[data-real-svelte-node-view]',
			rawRenderer,
			runtime,
			mounted,
			destroyed,
			clicked,
			settle: async () => {
				flushSvelte();
				await tick();
			},
			click(button) {
				button.click();
				flushSvelte();
			}
		});
	});

	it('mounts the real @tiptap/react wrapper and content components through /light', async () => {
		const runtimeKey = Symbol.for('@tiptap/react/static-node-view-runtime/v1');
		const mounted = vi.fn();
		const destroyed = vi.fn();
		const clicked = vi.fn();
		const ReactStaticNodeView = (props: FrameworkComponentProps) => {
			const [clicks, setClicks] = useState(0);
			useLayoutEffect(() => {
				props.onStaticMount();
				return () => props.onStaticDestroy();
			}, []);
			return createElement(
				ReactNodeViewWrapper,
				{
					as: 'section',
					'data-real-react-node-view': '',
					'data-editable': String(props.editor.options.editable),
					'data-static-selected': String(props.selected)
				},
				createElement('strong', null, String(props.node.attrs.title ?? '')),
				createElement(
					'button',
					{
						'data-static-click': '',
						onClick: () => {
							setClicks((value) => value + 1);
							props.onStaticClick();
							props.updateAttributes({ ignored: true });
						}
					},
					`clicks:${clicks}`
				),
				createElement(ReactNodeViewContent, { 'data-static-content': '' })
			);
		};
		const descriptor = {
			component: ReactStaticNodeView as ComponentType<FrameworkComponentProps>,
			onStaticMount: mounted,
			onStaticDestroy: destroyed,
			onStaticClick: clicked
		};
		const rawRenderer = vi.fn(
			ReactNodeViewRenderer(ReactStaticNodeView as never) as never
		) as unknown as Mock;
		setStaticNodeViewRuntime(rawRenderer, runtimeKey, descriptor);
		const runtime: StaticNodeViewRuntime<typeof descriptor> = {
			key: runtimeKey,
			mount({ value, props }) {
				const dom = document.createElement(props.node.isInline ? 'span' : 'div');
				const contentDOM = props.node.isLeaf
					? null
					: document.createElement(props.node.isInline ? 'span' : 'div');
				if (contentDOM) {
					contentDOM.dataset.nodeViewContentReact = '';
					contentDOM.dataset.nodeViewWrapper = '';
					contentDOM.style.whiteSpace = 'inherit';
				}
				const root = createRoot(dom);
				flushReact(() => {
					root.render(
						createElement(
							ReactNodeViewContext.Provider,
							{
								value: {
									onDragStart: () => undefined,
									nodeViewContentRef(element) {
										if (element && contentDOM && !element.contains(contentDOM)) {
											element.removeAttribute('data-node-view-wrapper');
											element.append(contentDOM);
										}
									}
								}
							},
							createElement(value.component, {
								...props,
								onStaticMount: value.onStaticMount,
								onStaticDestroy: value.onStaticDestroy,
								onStaticClick: value.onStaticClick
							})
						)
					);
				});
				if (!dom.firstElementChild?.hasAttribute('data-node-view-wrapper')) {
					root.unmount();
					throw new Error('React NodeView must use NodeViewWrapper.');
				}
				return {
					dom,
					contentDOM,
					destroy() {
						flushReact(() => root.unmount());
					}
				};
			}
		};

		await exerciseFrameworkRuntime({
			name: 'react-runtime-card',
			componentSelector: '[data-real-react-node-view]',
			rawRenderer,
			runtime,
			mounted,
			destroyed,
			clicked,
			settle: () => flushReact(() => undefined),
			click: (button) => flushReact(() => button.click()),
			assertMounted(component) {
				expect(
					component.querySelector('[data-node-view-content-react] p')?.textContent
				).toBe('first content');
			}
		});
	});

	it('mounts the real @tiptap/vue-3 wrapper and content components through /light', async () => {
		const runtimeKey = Symbol.for('@tiptap/vue-3/static-node-view-runtime/v1');
		const contextKey = Symbol('vue-static-runtime-context');
		const mounted = vi.fn();
		const destroyed = vi.fn();
		const clicked = vi.fn();
		const VueStaticNodeView = defineComponent({
			name: 'VueStaticNodeView',
			props: nodeViewProps,
			setup(props) {
				const runtimeContext = inject(contextKey);
				const clicks = ref(0);
				onMounted(mounted);
				onUnmounted(destroyed);
				return () =>
					h(
						VueNodeViewWrapper,
						{
							as: 'section',
							'data-real-vue-node-view': '',
							'data-runtime-context': String(runtimeContext),
							'data-editable': String(props.editor.options.editable),
							'data-static-selected': String(props.selected)
						},
						{
							default: () => [
								h('strong', null, String(props.node.attrs.title ?? '')),
								h(
									'button',
									{
										'data-static-click': '',
										onClick: () => {
											clicks.value += 1;
											clicked();
											props.updateAttributes({ ignored: true });
										}
									},
									`clicks:${clicks.value}`
								),
								h(VueNodeViewContent, {
									as: 'article',
									'data-static-content': ''
								})
							]
						}
					);
			}
		});
		const descriptor = {
			component: VueStaticNodeView as VueComponent,
			context: 'static-app-context'
		};
		const rawRenderer = vi.fn(
			VueNodeViewRenderer(VueStaticNodeView as never) as never
		) as unknown as Mock;
		setStaticNodeViewRuntime(rawRenderer, runtimeKey, descriptor);
		const runtime: StaticNodeViewRuntime<typeof descriptor> = {
			key: runtimeKey,
			mount({ value, props }) {
				const host = document.createElement('div');
				const app = createApp(value.component, { ...props });
				app.provide('onDragStart', () => undefined);
				app.provide('decorationClasses', ref(''));
				app.provide(contextKey, value.context);
				app.mount(host);
				const dom = host.firstElementChild;
				if (!(dom instanceof HTMLElement)) {
					app.unmount();
					throw new Error('Vue NodeView must render one HTMLElement root.');
				}
				return {
					dom,
					contentDOM: dom.querySelector<HTMLElement>('[data-node-view-content]'),
					destroy() {
						app.unmount();
					}
				};
			}
		};

		await exerciseFrameworkRuntime({
			name: 'vue-runtime-card',
			componentSelector: '[data-real-vue-node-view]',
			rawRenderer,
			runtime,
			mounted,
			destroyed,
			clicked,
			settle: nextTick,
			click: async (button) => {
				button.click();
				await nextTick();
			},
			assertMounted(component) {
				expect(component.getAttribute('data-runtime-context')).toBe('static-app-context');
			}
		});
	});
});
