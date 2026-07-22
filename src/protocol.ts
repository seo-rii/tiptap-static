export type AnyRecord = Record<string, any>;

export interface TiptapExtensionLike {
	name: string;
	type?: string;
	options?: AnyRecord;
	storage?: AnyRecord;
	config: AnyRecord;
	parent?: TiptapExtensionLike | null;
}

export interface StaticNodeType {
	name: string;
	spec: AnyRecord;
}

export interface StaticNode {
	type: StaticNodeType;
	attrs: AnyRecord;
	textContent: string;
	nodeSize: number;
	isInline: boolean;
	isLeaf: boolean;
	isAtom: boolean;
	childCount: number;
	content: {
		size: number;
		childCount: number;
		content: readonly [];
	};
	eq(other: unknown): boolean;
	sameMarkup(other: unknown): boolean;
	toJSON(): AnyRecord;
}

export interface StaticNodeViewProps {
	node: StaticNode;
	view: AnyRecord;
	getPos: () => number;
	decorations: readonly [];
	innerDecorations: AnyRecord;
	selected: false;
	updateAttributes: (attributes?: AnyRecord) => void;
	deleteNode: () => void;
	editor: AnyRecord;
	extension: TiptapExtensionLike;
	HTMLAttributes: AnyRecord;
}

export interface StaticNodeViewResult {
	dom: Element;
	contentDOM?: HTMLElement | null;
	destroy?: () => void;
	[key: string]: unknown;
}

export type StaticNodeViewMount = (props: StaticNodeViewProps) => StaticNodeViewResult;

export interface DirectStaticNodeViewHook {
	version: 1;
	mount: StaticNodeViewMount;
	runtime?: never;
	value?: never;
}

export type StaticNodeViewRuntimeKey = string | symbol;

export interface RuntimeStaticNodeViewHook<T = unknown> {
	version: 1;
	runtime: StaticNodeViewRuntimeKey;
	value: T;
	mount?: never;
}

export type StaticNodeViewHook = DirectStaticNodeViewHook | RuntimeStaticNodeViewHook;

export interface StaticNodeViewRuntime<T = unknown> {
	key: StaticNodeViewRuntimeKey;
	mount(input: { value: T; props: StaticNodeViewProps }): StaticNodeViewResult;
}

export const STATIC_NODE_VIEW = Symbol.for('@tiptap-static/node-view-renderer/v1');

export type StaticNodeViewRenderer = ((props: StaticNodeViewProps) => StaticNodeViewResult) & {
	[STATIC_NODE_VIEW]?: StaticNodeViewHook;
};

export function createStaticNodeViewHook(
	mount: StaticNodeViewMount
): DirectStaticNodeViewHook {
	return { version: 1, mount };
}

export function createStaticNodeViewRuntimeHook<Value>(
	runtime: StaticNodeViewRuntimeKey,
	value: Value
): RuntimeStaticNodeViewHook<Value> {
	return { version: 1, runtime, value };
}

export function setStaticNodeViewHook<T extends (...args: any[]) => unknown>(
	renderer: T,
	mount: StaticNodeViewMount
): T & { [STATIC_NODE_VIEW]: DirectStaticNodeViewHook } {
	Object.defineProperty(renderer, STATIC_NODE_VIEW, {
		configurable: true,
		value: createStaticNodeViewHook(mount)
	});
	return renderer as T & { [STATIC_NODE_VIEW]: DirectStaticNodeViewHook };
}

export function setStaticNodeViewRuntime<T extends (...args: any[]) => unknown, Value>(
	renderer: T,
	runtime: StaticNodeViewRuntimeKey,
	value: Value
): T & { [STATIC_NODE_VIEW]: RuntimeStaticNodeViewHook<Value> } {
	Object.defineProperty(renderer, STATIC_NODE_VIEW, {
		configurable: true,
		value: createStaticNodeViewRuntimeHook(runtime, value)
	});
	return renderer as T & { [STATIC_NODE_VIEW]: RuntimeStaticNodeViewHook<Value> };
}

export function getStaticNodeViewHook(renderer: unknown): StaticNodeViewHook | undefined {
	if ((typeof renderer !== 'function' && typeof renderer !== 'object') || renderer === null) {
		return undefined;
	}

	return (renderer as { [STATIC_NODE_VIEW]?: StaticNodeViewHook })[STATIC_NODE_VIEW];
}

export function hasStaticNodeViewHook(renderer: unknown): boolean {
	return getStaticNodeViewHook(renderer) !== undefined;
}
