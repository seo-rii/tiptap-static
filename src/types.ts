import type {
	AnyRecord,
	StaticNodeViewRuntime,
	TiptapExtensionLike
} from './protocol.js';

export type {
	AnyRecord,
	StaticNode,
	StaticNodeType,
	DirectStaticNodeViewHook,
	RuntimeStaticNodeViewHook,
	StaticNodeViewHook,
	StaticNodeViewMount,
	StaticNodeViewProps,
	StaticNodeViewRenderer,
	StaticNodeViewResult,
	StaticNodeViewRuntime,
	StaticNodeViewRuntimeKey,
	TiptapExtensionLike
} from './protocol.js';

export interface TiptapParseRuleLike {
	tag?: string;
	style?: string;
	priority?: number;
	namespace?: string;
	attrs?: AnyRecord;
	getAttrs?: (element: HTMLElement) => AnyRecord | false | null | undefined;
	contentElement?: string | HTMLElement | ((element: HTMLElement) => HTMLElement | null);
	context?: string;
	consuming?: boolean;
	getContent?: (...args: any[]) => unknown;
	ignore?: boolean;
	skip?: boolean;
	closeParent?: boolean;
	[key: string]: unknown;
}

export interface TiptapAttributeLike {
	default?: unknown | (() => unknown);
	rendered?: boolean;
	renderHTML?: ((attributes: AnyRecord) => AnyRecord | null | undefined) | null;
	parseHTML?: ((element: HTMLElement) => unknown) | null;
	keepOnSplit?: boolean;
	isRequired?: boolean;
}

export type StaticDiagnosticCode =
	| 'active-tag-requires-opt-in'
	| 'attribute-probe-failed'
	| 'destroy-failed'
	| 'duplicate-extension'
	| 'extension-field-failed'
	| 'invalid-content-dom'
	| 'invalid-node-view'
	| 'invalid-node-view-hook'
	| 'invalid-selector'
	| 'mount-failed'
	| 'duplicate-node-view-runtime'
	| 'missing-node-view-runtime'
	| 'raw-node-view-disabled'
	| 'required-attribute-missing'
	| 'sanitize-selector-not-inferred'
	| 'unsupported-parse-rule'
	| 'unresolved-content-hole';

export interface StaticDiagnostic {
	code: StaticDiagnosticCode;
	message: string;
	extension?: string;
	selector?: string;
	cause?: unknown;
}

export type AllowedAttribute = string | { name: string; multiple?: boolean; values: string[] };

export type AttributeValidator = (
	value: string,
	context: {
		tagName: string;
		attributeName: string;
		attributes: Readonly<Record<string, string>>;
	}
) => boolean | string | null | undefined;

export interface StaticSanitizeOptions {
	allowedTags?: string[] | false;
	allowedAttributes?: Record<string, AllowedAttribute[]> | false;
	allowedStyles?: Record<string, Record<string, RegExp[]>>;
	allowedClasses?: Record<string, boolean | Array<string | RegExp>>;
	allowedIframeDomains?: string[];
	allowedIframeHostnames?: string[];
	allowIframeRelativeUrls?: boolean;
	allowedSchemes?: string[] | false;
	allowedSchemesByTag?: Record<string, string[]> | false;
	allowedSchemesAppliedToAttributes?: string[];
	allowProtocolRelative?: boolean;
	allowVulnerableTags?: boolean;
	allowedEmptyAttributes?: string[];
	selfClosing?: string[];
	nonBooleanAttributes?: string[];
	transformTags?: Record<
		string,
		string | ((tagName: string, attributes: Record<string, string>) => {
			tagName: string;
			attribs: Record<string, string>;
		})
	>;
	exclusiveFilter?: (frame: {
		tag: string;
		attribs: Record<string, string>;
		text: string;
		tagPosition: number;
		mediaChildren: string[];
	}) => boolean | 'excludeTag';
	attributeValidators?: Record<string, Record<string, AttributeValidator>>;
	allowActiveContentTags?: string[];
	[key: string]: unknown;
}

export interface LightRendererOptions {
	extensions: readonly TiptapExtensionLike[];
	/** Defaults to false in createLightRenderer and true in createStaticRenderer. */
	rawNodeViews?: boolean;
	/** Adapter-owned runtimes for opaque static NodeView descriptors. */
	nodeViewRuntimes?: readonly StaticNodeViewRuntime[];
	editor?: AnyRecord | ((facade: AnyRecord) => AnyRecord);
	onDiagnostic?: (diagnostic: StaticDiagnostic) => void;
	onError?: (error: unknown, diagnostic: StaticDiagnostic) => void;
}

export interface StaticRendererOptions extends LightRendererOptions {
	sanitize?: StaticSanitizeOptions;
}

export interface StaticRenderSession {
	readonly html: string;
	update(html: string): void;
	destroy(): void;
}

export interface LightRenderer {
	readonly diagnostics: readonly StaticDiagnostic[];
	/** Enhances DOM that has already crossed a trusted sanitization boundary. */
	enhance(target: HTMLElement): StaticRenderSession;
	/** Does not sanitize trustedHTML or later session updates. */
	mount(target: HTMLElement, trustedHTML: string): StaticRenderSession;
}

export interface StaticRenderer extends LightRenderer {
	sanitize(html: string, options?: StaticSanitizeOptions): string;
	/** Trusts the existing DOM; returned session updates are sanitized. */
	enhance(target: HTMLElement): StaticRenderSession;
	/** Sanitizes html and all later session updates before enhancement. */
	mount(target: HTMLElement, html: string): StaticRenderSession;
}
