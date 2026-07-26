import {
	Editor as CoreEditor,
	Mark,
	Node,
	type NodeViewRendererProps
} from '@tiptap/core';
import {
	EditorContent as ReactEditorContent,
	NodeViewContent as ReactNodeViewContent,
	NodeViewWrapper as ReactNodeViewWrapper,
	ReactNodeViewContext,
	ReactNodeViewRenderer,
	type ReactNodeViewProps
} from '@tiptap/react';
import {
	Editor as VueEditor,
	EditorContent as VueEditorContent,
	NodeViewContent as VueNodeViewContent,
	NodeViewWrapper as VueNodeViewWrapper,
	VueNodeViewRenderer,
	nodeViewProps
} from '@tiptap/vue-3';
import {
	act as actReact,
	createElement,
	useContext,
	type ComponentType
} from 'react';
import { flushSync as flushReact } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import {
	flushSync as flushSvelte,
	mount as mountSvelte,
	tick,
	unmount as unmountSvelte,
	type Component as SvelteComponent
} from 'svelte';
import {
	Editor as SvelteEditor,
	EditorContent as SvelteEditorContent,
	SvelteNodeViewRenderer
} from 'svelte-tiptap';
import {
	createApp,
	defineComponent,
	h,
	inject,
	nextTick,
	ref,
	type App,
	type Component as VueComponent
} from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { createHydrator, defineStaticNode } from '../src/hydrate.js';
import { createLightRenderer } from '../src/light.js';
import {
	createStaticNodeViewRuntimeHook,
	createStaticNodeViewHook,
	setStaticNodeViewHook,
	setStaticNodeViewRuntime,
	type StaticNodeViewProps,
	type StaticNodeViewHook,
	type StaticNodeViewRenderer,
	type StaticNodeViewRuntime
} from '../src/protocol.js';
import StaticLeafNodeView from './fixtures/StaticLeafNodeView.svelte';
import StaticNodeView from './fixtures/StaticNodeView.svelte';

const SVELTE_RUNTIME_KEY = Symbol.for(
	'svelte-tiptap/static-node-view-runtime/parity-v1'
);
const REACT_RUNTIME_KEY = Symbol.for(
	'@tiptap/react/static-node-view-runtime/parity-v1'
);
const VUE_RUNTIME_KEY = Symbol.for(
	'@tiptap/vue-3/static-node-view-runtime/parity-v1'
);
const PARITY_NODE_SELECTOR = '[data-parity-node-view]';

const TestDocument = Node.create({
	name: 'doc',
	topNode: true,
	content: 'block*'
});

const TestText = Node.create({
	name: 'text',
	group: 'inline'
});

const TestParagraph = Node.create({
	name: 'paragraph',
	group: 'block',
	content: 'inline*',
	parseHTML() {
		return [{ tag: 'p' }];
	},
	renderHTML() {
		return ['p', 0];
	}
});

interface RendererTracker {
	rawCalls: number;
	descriptorComponents: unknown[];
}

interface RuntimeCapture {
	extensions: unknown[];
}

interface SvelteRendererOptions {
	as?: string;
	attrs?: Record<string, string>;
}

interface SvelteDescriptor {
	component: SvelteComponent;
	options?: SvelteRendererOptions;
}

interface ReactDescriptor {
	component: ComponentType<any>;
	options?: {
		as?: string;
		className?: string;
		attrs?: Record<string, string>;
	};
}

interface VueDescriptor {
	component: VueComponent;
	context: string;
}

interface NodeViewSnapshot {
	framework: string | null;
	tag: string;
	title: string;
	childContext: string | null;
	editable: string | null;
	selected: string | null;
	button: string | null;
	contentTag: string | null;
	content: Array<string | NodeViewSnapshot>;
}

interface NodeViewStructure {
	title: string;
	content: Array<string | NodeViewStructure>;
}

function createContainerExtension(options: {
	name: string;
	tag: string;
	createRenderer: () => StaticNodeViewRenderer;
}) {
	return Node.create({
		name: options.name,
		group: 'block',
		content: 'block*',
		addAttributes() {
			return { title: { default: '' } };
		},
		parseHTML() {
			return [{ tag: options.tag }];
		},
		renderHTML({ HTMLAttributes }) {
			return [options.tag, HTMLAttributes, 0];
		},
		addNodeView() {
			return options.createRenderer() as never;
		}
	});
}

function createContainerPlan(options: {
	name: string;
	tag: string;
	nodeView: StaticNodeViewHook;
}) {
	return defineStaticNode({
		name: options.name,
		rules: [
			{
				selector: options.tag,
				parse(element) {
					const title = element.getAttribute('title') ?? '';
					return { attrs: { title }, HTMLAttributes: { title } };
				}
			}
		],
		type: { isLeaf: false, spec: { content: 'block*' } },
		nodeView: options.nodeView
	});
}

function createSvelteRenderer(
	component: SvelteComponent,
	tracker: RendererTracker,
	options?: SvelteRendererOptions
): StaticNodeViewRenderer {
	const editorRenderer = SvelteNodeViewRenderer(component, options as never);
	const countedRenderer = ((props: NodeViewRendererProps) => {
		tracker.rawCalls += 1;
		return editorRenderer(props);
	}) as unknown as StaticNodeViewRenderer;

	tracker.descriptorComponents.push(component);
	return setStaticNodeViewRuntime(countedRenderer, SVELTE_RUNTIME_KEY, {
		component,
		options
	} satisfies SvelteDescriptor);
}

function createReactRenderer(
	component: ComponentType<ReactNodeViewProps>,
	tracker: RendererTracker,
	options?: ReactDescriptor['options']
): StaticNodeViewRenderer {
	const editorRenderer = ReactNodeViewRenderer(component, options);
	const countedRenderer = ((props: NodeViewRendererProps) => {
		tracker.rawCalls += 1;
		return editorRenderer(props);
	}) as unknown as StaticNodeViewRenderer;

	tracker.descriptorComponents.push(component);
	return setStaticNodeViewRuntime(countedRenderer, REACT_RUNTIME_KEY, {
		component,
		options
	} satisfies ReactDescriptor);
}

function createVueRenderer(
	component: VueComponent,
	tracker: RendererTracker,
	context: string
): StaticNodeViewRenderer {
	const editorRenderer = VueNodeViewRenderer(component as never);
	const countedRenderer = ((props: NodeViewRendererProps) => {
		tracker.rawCalls += 1;
		return editorRenderer(props);
	}) as unknown as StaticNodeViewRenderer;

	tracker.descriptorComponents.push(component);
	return setStaticNodeViewRuntime(countedRenderer, VUE_RUNTIME_KEY, {
		component,
		context
	} satisfies VueDescriptor);
}

function createSvelteRuntime(capture: RuntimeCapture): StaticNodeViewRuntime<SvelteDescriptor> {
	return {
		key: SVELTE_RUNTIME_KEY,
		mount({ value, props }) {
			capture.extensions.push(props.extension);
			const tag = value.options?.as ?? (props.node.isInline ? 'span' : 'div');
			const dom = document.createElement(tag);
			dom.classList.add(`node-${props.node.type.name}`);
			for (const [name, attributeValue] of Object.entries(value.options?.attrs ?? {})) {
				dom.setAttribute(name, attributeValue);
			}
			const context = new Map<unknown, unknown>([
				['TipTapNodeView', { onDragStart: () => undefined }]
			]);
			const component = mountSvelte(value.component, {
				target: dom,
				props,
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
}

function createReactRuntime(capture: RuntimeCapture): StaticNodeViewRuntime<ReactDescriptor> {
	return {
		key: REACT_RUNTIME_KEY,
		mount({ value, props }) {
			capture.extensions.push(props.extension);
			const dom = document.createElement(
				value.options?.as ?? (props.node.isInline ? 'span' : 'div')
			);
			dom.classList.add('react-renderer', `node-${props.node.type.name}`);
			if (value.options?.className) dom.classList.add(...value.options.className.split(' '));
			for (const [name, attributeValue] of Object.entries(value.options?.attrs ?? {})) {
				dom.setAttribute(name, attributeValue);
			}
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
						createElement(value.component, props)
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
}

function createVueRuntime(
	capture: RuntimeCapture,
	contextKey: symbol
): StaticNodeViewRuntime<VueDescriptor> {
	return {
		key: VUE_RUNTIME_KEY,
		mount({ value, props }) {
			capture.extensions.push(props.extension);
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
			if (!dom.hasAttribute('data-node-view-wrapper')) {
				app.unmount();
				throw new Error('Vue NodeView must use NodeViewWrapper.');
			}
			return {
				dom,
				contentDOM: props.node.isLeaf
					? null
					: dom.querySelector<HTMLElement>('[data-node-view-content]'),
				destroy() {
					app.unmount();
				}
			};
		}
	};
}

function snapshotNodeView(wrapper: HTMLElement): NodeViewSnapshot {
	const directChildren = [...wrapper.children];
	const label = directChildren.find((element) =>
		element.hasAttribute('data-static-child-component')
	) as HTMLElement | undefined;
	const button = directChildren.find((element) => element.tagName === 'BUTTON');
	const contentTarget = directChildren.find((element) =>
		element.hasAttribute('data-parity-content')
	) as HTMLElement | undefined;
	const content = contentTarget
		? [
				...contentTarget.querySelectorAll<HTMLElement>(`p, ${PARITY_NODE_SELECTOR}`)
			]
				.filter((element) => {
					if (element === wrapper) return false;
					return element.parentElement?.closest(PARITY_NODE_SELECTOR) === wrapper;
				})
				.map((element) =>
					element.matches(PARITY_NODE_SELECTOR)
						? snapshotNodeView(element)
						: (element.textContent ?? '')
				)
		: [];

	return {
		framework: wrapper.getAttribute('data-parity-node-view'),
		tag: wrapper.tagName.toLowerCase(),
		title: label?.textContent ?? '',
		childContext: label?.getAttribute('data-node-view-context') ?? null,
		editable: wrapper.getAttribute('data-editable'),
		selected: wrapper.getAttribute('data-static-selected'),
		button: button?.textContent?.trim() ?? null,
		contentTag: contentTarget?.tagName.toLowerCase() ?? null,
		content
	};
}

function snapshotNodeViews(root: ParentNode): NodeViewSnapshot[] {
	return [...root.querySelectorAll<HTMLElement>(PARITY_NODE_SELECTOR)]
		.filter((wrapper) => {
			const owner = wrapper.parentElement?.closest(PARITY_NODE_SELECTOR);
			return !owner || !root.contains(owner);
		})
		.map(snapshotNodeView);
}

function toStructure(snapshot: readonly NodeViewSnapshot[]): NodeViewStructure[] {
	return snapshot.map((node) => ({
		title: node.title,
		content: node.content.map((child) =>
			typeof child === 'string'
				? child
				: {
						title: child.title,
						content: toStructure([child])[0]!.content
					}
		)
	}));
}

function normalizedHTML(html: string): string {
	const template = document.createElement('template');
	template.innerHTML = html.trim();
	return template.innerHTML;
}

function expectReadOnlyComponentContract(snapshot: readonly NodeViewSnapshot[]): void {
	const visit = (nodes: readonly NodeViewSnapshot[]) => {
		for (const node of nodes) {
			expect(node).toMatchObject({
				tag: 'section',
				childContext: 'true',
				editable: 'false',
				selected: 'false'
			});
			visit(node.content.filter((child): child is NodeViewSnapshot => typeof child !== 'string'));
		}
	};
	visit(snapshot);
}

async function settleSvelte(): Promise<void> {
	flushSvelte();
	await tick();
	flushSvelte();
}

const svelteContainerCases: Array<{
	name: string;
	html: string;
	expected: NodeViewStructure[];
}> = [
	{
		name: 'an empty editable container',
		html: '<svelte-parity-card title="empty"></svelte-parity-card>',
		expected: [{ title: 'empty', content: [] }]
	},
	{
		name: 'paragraphs around the component content hole',
		html:
			'<svelte-parity-card title="paragraphs"><p>before</p><p>after</p></svelte-parity-card>',
		expected: [{ title: 'paragraphs', content: ['before', 'after'] }]
	},
	{
		name: 'independent sibling components',
		html:
			'<svelte-parity-card title="first"><p>one</p></svelte-parity-card><svelte-parity-card title="second"><p>two</p></svelte-parity-card>',
		expected: [
			{ title: 'first', content: ['one'] },
			{ title: 'second', content: ['two'] }
		]
	},
	{
		name: 'recursive components inside NodeViewContent',
		html:
			'<svelte-parity-card title="outer"><p>before</p><svelte-parity-card title="inner"><p>inside</p><svelte-parity-card title="deep"><p>deep text</p></svelte-parity-card></svelte-parity-card><p>after</p></svelte-parity-card>',
		expected: [
			{
				title: 'outer',
				content: [
					'before',
					{
						title: 'inner',
						content: [
							'inside',
							{ title: 'deep', content: ['deep text'] }
						]
					},
					'after'
				]
			}
		]
	}
];

describe('actual Tiptap Editor parity', () => {
	it.each(svelteContainerCases)(
		'renders $name like the real svelte-tiptap Editor',
		async ({ html, expected }) => {
			const tracker: RendererTracker = { rawCalls: 0, descriptorComponents: [] };
			const lightCapture: RuntimeCapture = { extensions: [] };
			const hydrateCapture: RuntimeCapture = { extensions: [] };
			const rendererOptions = {
				as: 'article',
				attrs: { 'data-svelte-renderer-option': 'preserved' }
			};
			const extension = createContainerExtension({
				name: 'svelteParityCard',
				tag: 'svelte-parity-card',
				createRenderer: () =>
					createSvelteRenderer(
						StaticNodeView as SvelteComponent,
						tracker,
						rendererOptions
					)
			});
			const hydrationNode = createContainerPlan({
				name: 'svelteParityCard',
				tag: 'svelte-parity-card',
				nodeView: createStaticNodeViewRuntimeHook(SVELTE_RUNTIME_KEY, {
					component: StaticNodeView as SvelteComponent,
					options: rendererOptions
				} satisfies SvelteDescriptor)
			});
			const extensions = [TestDocument, TestText, TestParagraph, extension];
			const editor = new SvelteEditor({
				element: document.createElement('div'),
				extensions,
				content: html,
				editable: false,
				injectCSS: false
			});
			const editorHost = document.createElement('div');
			const lightHost = document.createElement('div');
			const hydrateHost = document.createElement('div');
			document.body.append(editorHost, lightHost, hydrateHost);
			const editorContent = mountSvelte(SvelteEditorContent, {
				target: editorHost,
				props: { editor }
			});
			let session: ReturnType<ReturnType<typeof createLightRenderer>['mount']> | undefined;
			let hydrateSession: ReturnType<ReturnType<typeof createHydrator>['mount']> | undefined;

			try {
				await settleSvelte();
				const actual = snapshotNodeViews(editorHost);
				const rawCallsAfterEditor = tracker.rawCalls;
				expect(rawCallsAfterEditor).toBeGreaterThan(0);

				const lightRenderer = createLightRenderer({
					extensions,
					nodeViewRuntimes: [createSvelteRuntime(lightCapture)]
				});
				session = lightRenderer.mount(lightHost, html);
				const hydrator = createHydrator({
					nodes: [hydrationNode],
					nodeViewRuntimes: [createSvelteRuntime(hydrateCapture)]
				});
				hydrateSession = hydrator.mount(hydrateHost, html);
				await settleSvelte();
				const light = snapshotNodeViews(lightHost);
				const hydrated = snapshotNodeViews(hydrateHost);

				expect(tracker.rawCalls).toBe(rawCallsAfterEditor);
				expect(light).toEqual(actual);
				expect(hydrated).toEqual(actual);
				expect(toStructure(actual)).toEqual(expected);
				expectReadOnlyComponentContract(actual);
				expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(session.html));
				expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(hydrateSession.html));
				expect(lightCapture.extensions).not.toHaveLength(0);
				expect(lightCapture.extensions.every((candidate) => candidate === extension)).toBe(true);
				expect(hydrateCapture.extensions).not.toHaveLength(0);
				expect(
					hydrateCapture.extensions.every(
						(candidate) =>
							candidate !== extension &&
							(candidate as { name?: string }).name === hydrationNode.name
					)
				).toBe(true);
				expect(
					tracker.descriptorComponents.every(
						(component) => component === (StaticNodeView as SvelteComponent)
					)
				).toBe(true);
				for (const root of [editorHost, lightHost, hydrateHost]) {
					const rendererDOM = root.querySelector<HTMLElement>(
						'article.node-svelteParityCard'
					);
					expect(rendererDOM?.getAttribute('data-svelte-renderer-option')).toBe(
						'preserved'
					);
				}
				expect(lightRenderer.diagnostics).toEqual([]);
				expect(hydrator.diagnostics).toEqual([]);
			} finally {
				session?.destroy();
				hydrateSession?.destroy();
				await unmountSvelte(editorContent);
				editor.destroy();
				editorHost.remove();
				lightHost.remove();
				hydrateHost.remove();
				await settleSvelte();
			}
		}
	);

	it('matches the upstream svelte-tiptap atom example and keeps static updates read-only', async () => {
		const tracker: RendererTracker = { rawCalls: 0, descriptorComponents: [] };
		const lightCapture: RuntimeCapture = { extensions: [] };
		const hydrateCapture: RuntimeCapture = { extensions: [] };
		const extension = Node.create({
			name: 'svelteParityLeaf',
			group: 'block',
			atom: true,
			addAttributes() {
				return {
					title: { default: '' },
					count: { default: 0 }
				};
			},
			parseHTML() {
				return [{ tag: 'svelte-parity-leaf' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['svelte-parity-leaf', HTMLAttributes];
			},
			addNodeView() {
				return createSvelteRenderer(
					StaticLeafNodeView as SvelteComponent,
					tracker
				) as never;
			}
		});
		const hydrationNode = defineStaticNode({
			name: 'svelteParityLeaf',
			rules: [
				{
					selector: 'svelte-parity-leaf',
					parse(element) {
						const title = element.getAttribute('title') ?? '';
						const count = Number(element.getAttribute('count') ?? 0);
						return {
							attrs: { title, count },
							HTMLAttributes: { title, count }
						};
					}
				}
			],
			type: { isLeaf: true, isAtom: true },
			nodeView: createStaticNodeViewRuntimeHook(SVELTE_RUNTIME_KEY, {
				component: StaticLeafNodeView as SvelteComponent
			} satisfies SvelteDescriptor)
		});
		const html =
			'<p>selection anchor</p><svelte-parity-leaf title="counter" count="3"></svelte-parity-leaf>';
		const extensions = [TestDocument, TestText, TestParagraph, extension];
		const editor = new SvelteEditor({
			element: document.createElement('div'),
			extensions,
			content: html,
			editable: false,
			injectCSS: false
		});
		const editorHost = document.createElement('div');
		const lightHost = document.createElement('div');
		const hydrateHost = document.createElement('div');
		document.body.append(editorHost, lightHost, hydrateHost);
		const editorContent = mountSvelte(SvelteEditorContent, {
			target: editorHost,
			props: { editor }
		});
		let session: ReturnType<ReturnType<typeof createLightRenderer>['mount']> | undefined;
		let hydrateSession: ReturnType<ReturnType<typeof createHydrator>['mount']> | undefined;

		try {
			await settleSvelte();
			const actual = snapshotNodeViews(editorHost);
			const rawCallsAfterEditor = tracker.rawCalls;
			const lightRenderer = createLightRenderer({
				extensions,
				nodeViewRuntimes: [createSvelteRuntime(lightCapture)]
			});
			session = lightRenderer.mount(lightHost, html);
			const hydrator = createHydrator({
				nodes: [hydrationNode],
				nodeViewRuntimes: [createSvelteRuntime(hydrateCapture)]
			});
			hydrateSession = hydrator.mount(hydrateHost, html);
			await settleSvelte();
			const light = snapshotNodeViews(lightHost);
			const hydrated = snapshotNodeViews(hydrateHost);

			expect(tracker.rawCalls).toBe(rawCallsAfterEditor);
			expect(light).toEqual(actual);
			expect(hydrated).toEqual(actual);
			expect(actual).toEqual([
				expect.objectContaining({
					framework: 'svelte',
					title: 'counter',
					button: 'count:3',
					contentTag: null,
					content: []
				})
			]);
			expectReadOnlyComponentContract(actual);
			expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(session.html));
			expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(hydrateSession.html));

			editorHost.querySelector<HTMLButtonElement>('[data-static-count]')?.click();
			await settleSvelte();
			expect(editorHost.querySelector('[data-static-count]')?.textContent?.trim()).toBe(
				'count:4'
			);
			expect(editor.getHTML()).toContain('count="4"');

			lightHost.querySelector<HTMLButtonElement>('[data-static-count]')?.click();
			hydrateHost.querySelector<HTMLButtonElement>('[data-static-count]')?.click();
			await settleSvelte();
			expect(lightHost.querySelector('[data-static-count]')?.textContent?.trim()).toBe(
				'count:3'
			);
			expect(session.html).toBe(html);
			expect(hydrateHost.querySelector('[data-static-count]')?.textContent?.trim()).toBe(
				'count:3'
			);
			expect(hydrateSession.html).toBe(html);
			expect(lightRenderer.diagnostics).toEqual([]);
			expect(hydrator.diagnostics).toEqual([]);
		} finally {
			session?.destroy();
			hydrateSession?.destroy();
			await unmountSvelte(editorContent);
			editor.destroy();
			editorHost.remove();
			lightHost.remove();
			hydrateHost.remove();
			await settleSvelte();
		}
	});

	it('matches nested @tiptap/react EditorContent output in light and hydrate modes', async () => {
		const tracker: RendererTracker = { rawCalls: 0, descriptorComponents: [] };
		const lightCapture: RuntimeCapture = { extensions: [] };
		const hydrateCapture: RuntimeCapture = { extensions: [] };
		const ReactParityLabel = ({ title }: { title: string }) => {
			const context = useContext(ReactNodeViewContext);
			return createElement(
				'strong',
				{
					'data-static-child-component': '',
					'data-node-view-context': String(typeof context?.onDragStart === 'function')
				},
				title
			);
		};
		const ReactParityNodeView = (props: ReactNodeViewProps) =>
			createElement(
				ReactNodeViewWrapper,
				{
					as: 'section',
					'data-parity-node-view': 'react',
					'data-editable': String(props.editor.options.editable),
					'data-static-selected': String(props.selected)
				},
				createElement(ReactParityLabel, {
					title: String(props.node.attrs.title ?? '')
				}),
				createElement(ReactNodeViewContent, {
					as: 'article',
					'data-parity-content': ''
				} as never)
			);
		const rendererOptions = {
			as: 'article',
			className: 'parity-react-renderer',
			attrs: { 'data-react-renderer-option': 'preserved' }
		};
		const extension = createContainerExtension({
			name: 'reactParityCard',
			tag: 'react-parity-card',
			createRenderer: () =>
				createReactRenderer(ReactParityNodeView, tracker, rendererOptions)
		});
		const hydrationNode = createContainerPlan({
			name: 'reactParityCard',
			tag: 'react-parity-card',
			nodeView: createStaticNodeViewRuntimeHook(REACT_RUNTIME_KEY, {
				component: ReactParityNodeView,
				options: rendererOptions
			} satisfies ReactDescriptor)
		});
		const html =
			'<react-parity-card title="outer"><p>before</p><react-parity-card title="inner"><p>inside</p></react-parity-card><p>after</p></react-parity-card>';
		const extensions = [TestDocument, TestText, TestParagraph, extension];
		const editor = new CoreEditor({
			element: document.createElement('div'),
			extensions,
			content: html,
			editable: false,
			injectCSS: false
		});
		const editorHost = document.createElement('div');
		const lightHost = document.createElement('div');
		const hydrateHost = document.createElement('div');
		document.body.append(editorHost, lightHost, hydrateHost);
		let editorRoot: Root | undefined;
		let session: ReturnType<ReturnType<typeof createLightRenderer>['mount']> | undefined;
		let hydrateSession: ReturnType<ReturnType<typeof createHydrator>['mount']> | undefined;
		const actEnvironment = globalThis as typeof globalThis & {
			IS_REACT_ACT_ENVIRONMENT?: boolean;
		};
		const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
		actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

		try {
			editorRoot = createRoot(editorHost);
			await actReact(async () => {
				editorRoot?.render(createElement(ReactEditorContent, { editor }));
				await Promise.resolve();
				await Promise.resolve();
			});
			await vi.waitFor(() => {
				expect(editorHost.querySelectorAll(PARITY_NODE_SELECTOR)).toHaveLength(2);
			});
			const actual = snapshotNodeViews(editorHost);
			const rawCallsAfterEditor = tracker.rawCalls;

			const lightRenderer = createLightRenderer({
				extensions,
				nodeViewRuntimes: [createReactRuntime(lightCapture)]
			});
			const hydrator = createHydrator({
				nodes: [hydrationNode],
				nodeViewRuntimes: [createReactRuntime(hydrateCapture)]
			});
			await actReact(async () => {
				session = lightRenderer.mount(lightHost, html);
				hydrateSession = hydrator.mount(hydrateHost, html);
			});
			const light = snapshotNodeViews(lightHost);
			const hydrated = snapshotNodeViews(hydrateHost);

			expect(tracker.rawCalls).toBe(rawCallsAfterEditor);
			expect(light).toEqual(actual);
			expect(hydrated).toEqual(actual);
			expect(toStructure(actual)).toEqual([
				{
					title: 'outer',
					content: [
						'before',
						{ title: 'inner', content: ['inside'] },
						'after'
					]
				}
			]);
			expectReadOnlyComponentContract(actual);
			expect(lightCapture.extensions.every((candidate) => candidate === extension)).toBe(true);
			expect(
				hydrateCapture.extensions.every(
					(candidate) =>
						candidate !== extension &&
						(candidate as { name?: string }).name === hydrationNode.name
				)
			).toBe(true);
			expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(session!.html));
			expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(hydrateSession!.html));
			for (const root of [editorHost, lightHost, hydrateHost]) {
				const rendererDOM = root.querySelector<HTMLElement>(
					'article.node-reactParityCard'
				);
				expect(rendererDOM?.classList.contains('parity-react-renderer')).toBe(true);
				expect(rendererDOM?.getAttribute('data-react-renderer-option')).toBe(
					'preserved'
				);
			}
			expect(lightRenderer.diagnostics).toEqual([]);
			expect(hydrator.diagnostics).toEqual([]);
		} finally {
			await actReact(async () => {
				session?.destroy();
				hydrateSession?.destroy();
				editorRoot?.unmount();
			});
			editor.destroy();
			editorHost.remove();
			lightHost.remove();
			hydrateHost.remove();
			actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
		}
	});

	it('matches nested @tiptap/vue-3 output in light and hydrate modes with application context', async () => {
		const tracker: RendererTracker = { rawCalls: 0, descriptorComponents: [] };
		const lightCapture: RuntimeCapture = { extensions: [] };
		const hydrateCapture: RuntimeCapture = { extensions: [] };
		const contextKey = Symbol('vue-parity-context');
		const sharedContext = 'shared-vue-context';
		const VueParityLabel = defineComponent({
			name: 'VueParityLabel',
			props: { title: { type: String, required: true } },
			setup(props) {
				const onDragStart = inject<(...args: any[]) => unknown>('onDragStart');
				return () =>
					h(
						'strong',
						{
							'data-static-child-component': '',
							'data-node-view-context': String(typeof onDragStart === 'function')
						},
						props.title
					);
			}
		});
		const VueParityNodeView = defineComponent({
			name: 'VueParityNodeView',
			props: nodeViewProps,
			setup(props) {
				const applicationContext = inject(contextKey);
				return () =>
					h(
						VueNodeViewWrapper,
						{
							as: 'section',
							'data-parity-node-view': 'vue',
							'data-application-context': String(applicationContext),
							'data-editable': String(props.editor.options.editable),
							'data-static-selected': String(props.selected)
						},
						{
							default: () => [
								h(VueParityLabel, {
									title: String(props.node.attrs.title ?? '')
								}),
								h(VueNodeViewContent, {
									as: 'article',
									'data-parity-content': ''
								})
							]
						}
					);
			}
		});
		const extension = createContainerExtension({
			name: 'vueParityCard',
			tag: 'vue-parity-card',
			createRenderer: () =>
				createVueRenderer(VueParityNodeView as VueComponent, tracker, sharedContext)
		});
		const hydrationNode = createContainerPlan({
			name: 'vueParityCard',
			tag: 'vue-parity-card',
			nodeView: createStaticNodeViewRuntimeHook(VUE_RUNTIME_KEY, {
				component: VueParityNodeView as VueComponent,
				context: sharedContext
			} satisfies VueDescriptor)
		});
		const html =
			'<vue-parity-card title="outer"><p>before</p><vue-parity-card title="inner"><p>inside</p></vue-parity-card><p>after</p></vue-parity-card>';
		const extensions = [TestDocument, TestText, TestParagraph, extension];
		const editor = new VueEditor({
			element: document.createElement('div'),
			extensions,
			content: html,
			editable: false,
			injectCSS: false
		});
		const editorHost = document.createElement('div');
		const lightHost = document.createElement('div');
		const hydrateHost = document.createElement('div');
		document.body.append(editorHost, lightHost, hydrateHost);
		let editorApp: App<Element> | undefined;
		let session: ReturnType<ReturnType<typeof createLightRenderer>['mount']> | undefined;
		let hydrateSession: ReturnType<ReturnType<typeof createHydrator>['mount']> | undefined;

		try {
			editorApp = createApp(
				defineComponent({
					name: 'VueParityEditorHost',
					setup: () => () => h(VueEditorContent, { editor })
				})
			);
			editorApp.provide(contextKey, sharedContext);
			editorApp.mount(editorHost);
			await nextTick();
			await nextTick();
			await vi.waitFor(() => {
				expect(editorHost.querySelectorAll(PARITY_NODE_SELECTOR)).toHaveLength(2);
			});
			const actual = snapshotNodeViews(editorHost);
			const rawCallsAfterEditor = tracker.rawCalls;

			const lightRenderer = createLightRenderer({
				extensions,
				nodeViewRuntimes: [createVueRuntime(lightCapture, contextKey)]
			});
			session = lightRenderer.mount(lightHost, html);
			const hydrator = createHydrator({
				nodes: [hydrationNode],
				nodeViewRuntimes: [createVueRuntime(hydrateCapture, contextKey)]
			});
			hydrateSession = hydrator.mount(hydrateHost, html);
			await nextTick();
			const light = snapshotNodeViews(lightHost);
			const hydrated = snapshotNodeViews(hydrateHost);

			expect(tracker.rawCalls).toBe(rawCallsAfterEditor);
			expect(light).toEqual(actual);
			expect(hydrated).toEqual(actual);
			expect(toStructure(actual)).toEqual([
				{
					title: 'outer',
					content: [
						'before',
						{ title: 'inner', content: ['inside'] },
						'after'
					]
				}
			]);
			expectReadOnlyComponentContract(actual);
			for (const root of [editorHost, lightHost, hydrateHost]) {
				const contextElements = [...root.querySelectorAll('[data-application-context]')];
				expect(contextElements).toHaveLength(2);
				expect(
					contextElements.every(
						(element) =>
							element.getAttribute('data-application-context') === sharedContext
					)
				).toBe(true);
			}
			expect(lightCapture.extensions.every((candidate) => candidate === extension)).toBe(true);
			expect(
				hydrateCapture.extensions.every(
					(candidate) =>
						candidate !== extension &&
						(candidate as { name?: string }).name === hydrationNode.name
				)
			).toBe(true);
			expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(session.html));
			expect(normalizedHTML(editor.getHTML())).toBe(normalizedHTML(hydrateSession.html));
			expect(lightRenderer.diagnostics).toEqual([]);
			expect(hydrator.diagnostics).toEqual([]);
		} finally {
			session?.destroy();
			hydrateSession?.destroy();
			editor.destroy();
			editorApp?.unmount();
			editorHost.remove();
			lightHost.remove();
			hydrateHost.remove();
			await nextTick();
		}
	});

	it('matches mapped attributes and an explicit content hole across all three runtimes', () => {
		interface CapturedCodeNode {
			attrs: Record<string, unknown>;
			HTMLAttributes: Record<string, unknown>;
			textContent: string;
		}
		const actualCaptures: CapturedCodeNode[] = [];
		const lightCaptures: CapturedCodeNode[] = [];
		const hydrateCaptures: CapturedCodeNode[] = [];
		const createCodeNodeView = (
			props: StaticNodeViewProps,
			captures: CapturedCodeNode[]
		) => {
			captures.push({
				attrs: { ...props.node.attrs },
				HTMLAttributes: { ...props.HTMLAttributes },
				textContent: props.node.textContent
			});
			const dom = document.createElement('section');
			dom.dataset.parityCodeView = '';
			const contentDOM = document.createElement('div');
			contentDOM.dataset.parityCodeContent = '';
			dom.append(contentDOM);
			return { dom, contentDOM };
		};
		const rawRenderer = ((props: NodeViewRendererProps) =>
			createCodeNodeView(
				props as unknown as StaticNodeViewProps,
				actualCaptures
			)) as unknown as StaticNodeViewRenderer;
		setStaticNodeViewHook(rawRenderer, (props) =>
			createCodeNodeView(props, lightCaptures)
		);
		const CodeNode = Node.create({
			name: 'preparedParityCode',
			group: 'block',
			content: 'inline*',
			addAttributes() {
				return {
					count: {
						default: 0,
						parseHTML: (element) => Number(element.getAttribute('data-count') ?? 0),
						renderHTML: (attributes) => ({ 'data-count': String(attributes.count) })
					},
					enabled: {
						default: false,
						parseHTML: (element) => element.hasAttribute('data-enabled'),
						renderHTML: (attributes) =>
							attributes.enabled ? { 'data-enabled': 'true' } : {}
					},
					tone: {
						default: 'neutral',
						parseHTML: (element) => element.getAttribute('data-tone') ?? 'neutral',
						renderHTML: (attributes) => ({ 'data-tone': attributes.tone })
					}
				};
			},
			parseHTML() {
				return [
					{
						tag: 'pre[data-parity-code]',
						contentElement: 'code'
					}
				];
			},
			renderHTML({ HTMLAttributes }) {
				return ['pre', { ...HTMLAttributes, 'data-parity-code': '' }, ['code', 0]];
			},
			addNodeView() {
				return rawRenderer as never;
			}
		});
		const Bold = Mark.create({
			name: 'bold',
			parseHTML: () => [{ tag: 'strong' }],
			renderHTML: () => ['strong', 0]
		});
		const html =
			'<pre data-parity-code data-count="3" data-enabled data-tone="blue"><span>outside</span><code>inside <strong>bold</strong></code></pre>';
		const extensions = [TestDocument, TestText, Bold, CodeNode];
		const editorHost = document.createElement('div');
		const lightHost = document.createElement('div');
		const hydrateHost = document.createElement('div');
		const editor = new CoreEditor({
			element: editorHost,
			extensions,
			content: html,
			editable: false,
			injectCSS: false
		});
		const lightRenderer = createLightRenderer({ extensions });
		const lightSession = lightRenderer.mount(lightHost, html);
		const hydrationNode = defineStaticNode({
			name: 'preparedParityCode',
			rules: [
				{
					selector: 'pre[data-parity-code]',
					contentElement: 'code',
					parse(element) {
						const count = Number(element.getAttribute('data-count') ?? 0);
						const enabled = element.hasAttribute('data-enabled');
						const tone = element.getAttribute('data-tone') ?? 'neutral';
						return {
							attrs: { count, enabled, tone },
							HTMLAttributes: {
								'data-count': String(count),
								...(enabled ? { 'data-enabled': 'true' } : {}),
								'data-tone': tone
							}
						};
					}
				}
			],
			type: { isLeaf: false, spec: { content: 'inline*' } },
			nodeView: createStaticNodeViewHook((props) =>
				createCodeNodeView(props, hydrateCaptures)
			)
		});
		const hydrator = createHydrator({ nodes: [hydrationNode] });
		const hydrateSession = hydrator.mount(hydrateHost, html);

		try {
			expect(actualCaptures).toEqual([
				{
					attrs: { count: 3, enabled: true, tone: 'blue' },
					HTMLAttributes: {
						'data-count': '3',
						'data-enabled': 'true',
						'data-tone': 'blue'
					},
					textContent: 'inside bold'
				}
			]);
			expect(lightCaptures).toEqual(actualCaptures);
			expect(hydrateCaptures).toEqual(actualCaptures);
			for (const host of [editorHost, lightHost, hydrateHost]) {
				const content = host.querySelector<HTMLElement>('[data-parity-code-content]');
				expect(content?.textContent).toBe('inside bold');
				expect(content?.querySelector('strong')?.textContent).toBe('bold');
				expect(content?.querySelector('code')).toBeNull();
				expect(host.textContent).not.toContain('outside');
			}
			expect(lightRenderer.diagnostics).toEqual([]);
			expect(hydrator.diagnostics).toEqual([]);
		} finally {
			lightSession.destroy();
			hydrateSession.destroy();
			editor.destroy();
		}
	});
});
