import {
	resolveExtensionField,
	type ExtensionInspection,
	type InspectedNodeExtension,
	type InspectedParseRule
} from './extensions.js';
import { getStaticNodeViewHook } from './protocol.js';
import type {
	AnyRecord,
	StaticDiagnostic,
	StaticNode,
	StaticNodeViewRenderer,
	StaticNodeViewResult,
	StaticRenderSession,
	TiptapExtensionLike
} from './types.js';
import type { StaticNodeViewRuntime, StaticNodeViewRuntimeKey } from './protocol.js';

interface ActiveSession {
	dispose(restore: boolean): void;
}

interface MountedRecord {
	sourceElement: HTMLElement;
	sourceContainer: HTMLElement;
	sourceNodes: Node[];
	mountedDOM: Node;
	originalParent: Node | null;
	originalNextSibling: Node | null;
	destroy(): void;
}

const ACTIVE_SESSION = Symbol.for('@tiptap-static/active-session/v1');

function getActiveSession(target: HTMLElement): ActiveSession | undefined {
	return (target as HTMLElement & { [ACTIVE_SESSION]?: ActiveSession })[ACTIVE_SESSION];
}

function setActiveSession(target: HTMLElement, session?: ActiveSession): void {
	if (!session) {
		delete (target as HTMLElement & { [ACTIVE_SESSION]?: ActiveSession })[ACTIVE_SESSION];
		return;
	}
	Object.defineProperty(target, ACTIVE_SESSION, {
		configurable: true,
		value: session
	});
}

export interface EnhancementEngineOptions {
	inspection: ExtensionInspection;
	rawNodeViews?: boolean;
	nodeViewRuntimes?: readonly StaticNodeViewRuntime[];
	editor?: AnyRecord | ((facade: AnyRecord) => AnyRecord);
	prepareHTML?: (html: string) => string;
	report(diagnostic: StaticDiagnostic): void;
	onError?: (error: unknown, diagnostic: StaticDiagnostic) => void;
}

export interface EnhancementEngine {
	enhance(target: HTMLElement): StaticRenderSession;
	mount(target: HTMLElement, trustedHTML: string): StaticRenderSession;
}

export function createEnhancementEngine(options: EnhancementEngineOptions): EnhancementEngine {
	const { inspection, report } = options;
	const notifyError = (error: unknown, diagnostic: StaticDiagnostic) => {
		try {
			options.onError?.(error, diagnostic);
		} catch {
			// Diagnostic callbacks are observers and must not interrupt DOM rollback.
		}
	};
	const nodeViewRuntimes = new Map<StaticNodeViewRuntimeKey, StaticNodeViewRuntime>();
	for (const runtime of options.nodeViewRuntimes ?? []) {
		if (nodeViewRuntimes.has(runtime.key)) {
			report({
				code: 'duplicate-node-view-runtime',
				message: `A static NodeView runtime is registered more than once for ${String(runtime.key)}.`
			});
			continue;
		}
		nodeViewRuntimes.set(runtime.key, runtime);
	}

	const createSession = (
		target: HTMLElement,
		initialHTML: string | undefined
	): StaticRenderSession => {
		const preparedInitialHTML =
			initialHTML === undefined ? undefined : (options.prepareHTML?.(initialHTML) ?? initialHTML);
		getActiveSession(target)?.dispose(true);
		let currentHTML = preparedInitialHTML ?? target.innerHTML;
		let mountedRecords: MountedRecord[] = [];
		let disposed = false;

		const disposeViews = (restore: boolean) => {
			for (let index = mountedRecords.length - 1; index >= 0; index -= 1) {
				const record = mountedRecords[index];
				if (restore) {
					try {
						record.sourceContainer.replaceChildren(...record.sourceNodes);
						if (record.mountedDOM !== record.sourceElement) {
							if (record.mountedDOM.parentNode) {
								record.mountedDOM.parentNode.replaceChild(
									record.sourceElement,
									record.mountedDOM
								);
							} else if (!record.sourceElement.parentNode && record.originalParent) {
								record.originalParent.insertBefore(
									record.sourceElement,
									record.originalNextSibling?.parentNode === record.originalParent
										? record.originalNextSibling
										: null
								);
							}
						}
					} catch (cause) {
						const diagnostic: StaticDiagnostic = {
							code: 'destroy-failed',
							message: 'A static NodeView source tree could not be restored.',
							cause
						};
						report(diagnostic);
						notifyError(cause, diagnostic);
					}
				}
				try {
					record.destroy();
				} catch (cause) {
					const diagnostic: StaticDiagnostic = {
						code: 'destroy-failed',
						message: 'A static NodeView threw while being destroyed.',
						cause
					};
					report(diagnostic);
					notifyError(cause, diagnostic);
				}
			}
			mountedRecords = [];
		};

		const enhanceCurrentDOM = () => {
			const listeners = new Map<string, Set<(...args: any[]) => void>>();
			const commands = new Proxy<AnyRecord>(
				{},
				{
					get: () => () => false
				}
			);
			let chain: AnyRecord;
			chain = new Proxy(
				{},
				{
					get: (_chainTarget, property) =>
						property === 'run' ? () => false : () => chain
				}
			);
			const extensionStorage = Object.fromEntries(
				inspection.extensions.map((extension) => [extension.name, extension.storage ?? {}])
			);
			const facade: AnyRecord = {
				options: { editable: false },
				isEditable: false,
				isFocused: false,
				state: { selection: { from: -1, to: -1 } },
				commands,
				chain: () => chain,
				can: () => commands,
				extensionStorage,
				extensionManager: {
					attributes: inspection.attributes.map(({ type, name, attribute }) => ({
						type,
						name,
						attribute
					}))
				},
				on(event: string, listener: (...args: any[]) => void) {
					const eventListeners = listeners.get(event) ?? new Set();
					eventListeners.add(listener);
					listeners.set(event, eventListeners);
					return this;
				},
				off(event: string, listener: (...args: any[]) => void) {
					listeners.get(event)?.delete(listener);
					return this;
				},
				emit(event: string, ...args: any[]) {
					for (const listener of listeners.get(event) ?? []) listener(...args);
				},
				view: {
					dom: target,
					state: { selection: { from: -1, to: -1 } },
					dispatch: () => undefined
				}
			};
			const editor =
				typeof options.editor === 'function'
					? options.editor(facade)
					: Object.assign(facade, options.editor ?? {});
			const definitionByExtension = new Map<TiptapExtensionLike, InspectedNodeExtension>(
				inspection.nodes.map((node) => [node.extension, node])
			);
			const staticTypes = new Map(
				inspection.nodes.map((definition) => [
					definition.extension,
					{
						name: definition.extension.name,
						spec: {
							selectable: definition.typeSpec.selectable ?? true,
							...definition.typeSpec
						}
					}
				])
			);
			const renderers = new Map<TiptapExtensionLike, StaticNodeViewRenderer | null>();
			const invalidSelectors = new Set<string>();

			const resolveRenderer = (
				definition: InspectedNodeExtension
			): StaticNodeViewRenderer | null => {
				if (renderers.has(definition.extension)) return renderers.get(definition.extension) ?? null;
				try {
					const type = staticTypes.get(definition.extension);
					const addNodeView = resolveExtensionField<(() => StaticNodeViewRenderer) | undefined>(
						definition.extension,
						'addNodeView',
						{
							name: definition.extension.name,
							options: definition.extension.options ?? {},
							storage: definition.extension.storage ?? {},
							editor,
							type
						}
					);
					const renderer = addNodeView?.() ?? null;
					renderers.set(definition.extension, renderer);
					return renderer;
				} catch (cause) {
					const diagnostic: StaticDiagnostic = {
						code: 'extension-field-failed',
						message: `Could not create the NodeView renderer for ${definition.extension.name}.`,
						extension: definition.extension.name,
						cause
					};
					report(diagnostic);
					notifyError(cause, diagnostic);
					renderers.set(definition.extension, null);
					return null;
				}
			};

			const enhanceChildren = (container: ParentNode) => {
				for (const child of [...container.childNodes]) {
					if (child.nodeType !== 1) continue;
					const element = child as HTMLElement;
					let match:
						| { definition: InspectedNodeExtension; inspectedRule: InspectedParseRule; ruleAttrs: AnyRecord }
						| undefined;

					for (const inspectedRule of inspection.rules) {
						const definition = definitionByExtension.get(inspectedRule.extension);
						if (!definition?.hasNodeView) continue;
						if (
							inspectedRule.rule.namespace &&
							inspectedRule.rule.namespace !== element.namespaceURI
						) {
							continue;
						}

						let matches = false;
						try {
							matches = element.matches(inspectedRule.selector);
						} catch (cause) {
							if (!invalidSelectors.has(inspectedRule.selector)) {
								invalidSelectors.add(inspectedRule.selector);
								report({
									code: 'invalid-selector',
									message: `Invalid parseHTML selector ${JSON.stringify(inspectedRule.selector)}.`,
									extension: inspectedRule.extension.name,
									selector: inspectedRule.selector,
									cause
								});
							}
						}
						if (!matches) continue;

						try {
							const parsed = inspectedRule.rule.getAttrs
								? inspectedRule.rule.getAttrs(element)
								: inspectedRule.rule.attrs;
							if (parsed === false) continue;
							match = {
								definition,
								inspectedRule,
								ruleAttrs: parsed ?? {}
							};
							break;
						} catch (cause) {
							const diagnostic: StaticDiagnostic = {
								code: 'mount-failed',
								message: `${definition.extension.name}'s parse rule threw; the source element was preserved.`,
								extension: definition.extension.name,
								selector: inspectedRule.selector,
								cause
							};
							report(diagnostic);
							notifyError(cause, diagnostic);
						}
					}

					if (!match) {
						enhanceChildren(element);
						continue;
					}

					const { definition, inspectedRule, ruleAttrs } = match;
					const renderer = resolveRenderer(definition);
					if (!renderer) {
						enhanceChildren(element);
						continue;
					}

					const attributes: AnyRecord = {};
					for (const item of definition.attributes) {
						if (item.hasDefault) attributes[item.name] = item.attribute.default;
					}
					Object.assign(attributes, ruleAttrs);

					let attributeFailure = false;
					for (const item of definition.attributes) {
						try {
							const parsedByAttribute = Boolean(item.attribute.parseHTML);
							const value = parsedByAttribute
								? item.attribute.parseHTML?.(element)
								: element.getAttribute(item.name);
							if (value !== null && value !== undefined) {
								if (parsedByAttribute || typeof value !== 'string') {
									attributes[item.name] = value;
								} else if (value.match(/^[+-]?(?:\d*\.)?\d+$/)) {
									attributes[item.name] = Number(value);
								} else if (value === 'true') {
									attributes[item.name] = true;
								} else if (value === 'false') {
									attributes[item.name] = false;
								} else {
									attributes[item.name] = value;
								}
							}
							if (item.attribute.isRequired && attributes[item.name] === undefined) {
								attributeFailure = true;
								report({
									code: 'required-attribute-missing',
									message: `Required attribute ${definition.extension.name}.${item.name} is missing; the source element was preserved.`,
									extension: definition.extension.name
								});
							}
						} catch (cause) {
							attributeFailure = true;
							const diagnostic: StaticDiagnostic = {
								code: 'mount-failed',
								message: `Could not parse ${definition.extension.name}.${item.name}; the source element was preserved.`,
								extension: definition.extension.name,
								cause
							};
							report(diagnostic);
							notifyError(cause, diagnostic);
						}
					}
					if (attributeFailure) {
						enhanceChildren(element);
						continue;
					}

					const HTMLAttributes: AnyRecord = {};
					try {
						for (const item of definition.attributes) {
							if (item.attribute.rendered === false) continue;
							const rendered = item.attribute.renderHTML
								? item.attribute.renderHTML(attributes) ?? {}
								: { [item.name]: attributes[item.name] };
							for (const [key, value] of Object.entries(rendered)) {
								if (!HTMLAttributes[key]) {
									HTMLAttributes[key] = value;
								} else if (key === 'class') {
									const existing = String(HTMLAttributes[key]).split(' ');
									const additions = String(value ?? '')
										.split(' ')
										.filter((className) => !existing.includes(className));
									HTMLAttributes[key] = [...existing, ...additions].join(' ');
								} else if (key === 'style') {
									const styleMap = new Map<string, string>();
									for (const declaration of `${HTMLAttributes[key]};${value ?? ''}`
										.split(';')
										.map((style) => style.trim())
										.filter(Boolean)) {
										const [property, propertyValue] = declaration
											.split(':')
											.map((part) => part.trim());
										styleMap.set(property, propertyValue);
									}
									HTMLAttributes[key] = [...styleMap]
										.map(([property, propertyValue]) => `${property}: ${propertyValue}`)
										.join('; ');
								} else {
									HTMLAttributes[key] = value;
								}
							}
						}
					} catch (cause) {
						const diagnostic: StaticDiagnostic = {
							code: 'mount-failed',
							message: `Could not render ${definition.extension.name}'s attributes; the source element was preserved.`,
							extension: definition.extension.name,
							cause
						};
						report(diagnostic);
						notifyError(cause, diagnostic);
						enhanceChildren(element);
						continue;
					}

					let sourceContainer: HTMLElement = element;
					let contentResolved = false;
					try {
						const configuredContentElement = inspectedRule.rule.contentElement;
						if (typeof configuredContentElement === 'string') {
							const selected = element.querySelector(configuredContentElement);
							if (selected?.nodeType === 1) {
								sourceContainer = selected as HTMLElement;
								contentResolved = true;
							}
						} else if (typeof configuredContentElement === 'function') {
							const selected = configuredContentElement(element);
							if (selected?.nodeType === 1 && element.contains(selected)) {
								sourceContainer = selected;
								contentResolved = true;
							}
						} else if (
							configuredContentElement?.nodeType === 1 &&
							element.contains(configuredContentElement)
						) {
							sourceContainer = configuredContentElement;
							contentResolved = true;
						}
					} catch (cause) {
						const diagnostic: StaticDiagnostic = {
							code: 'unresolved-content-hole',
							message: `Could not resolve ${definition.extension.name}'s parse-rule contentElement; direct children will be used.`,
							extension: definition.extension.name,
							cause
						};
						report(diagnostic);
						notifyError(cause, diagnostic);
					}

					const provisionalText = sourceContainer.textContent ?? '';
					const inline = Boolean(definition.typeSpec.inline);
					const contentExpression = definition.typeSpec.content;
					const isLeaf = contentExpression === undefined || contentExpression === null || contentExpression === '';
					const isAtom = isLeaf || Boolean(definition.typeSpec.atom);
					const type = staticTypes.get(definition.extension)!;
					let node: StaticNode;
					node = {
						type,
						attrs: attributes,
						textContent: provisionalText,
						nodeSize: isLeaf ? 1 : provisionalText.length + 2,
						isInline: inline,
						isLeaf,
						isAtom,
						childCount: sourceContainer.childNodes.length,
						content: {
							size: provisionalText.length,
							childCount: sourceContainer.childNodes.length,
							content: []
						},
						eq(other) {
							return (
								Boolean(other) &&
								(other as StaticNode).type === type &&
								(other as StaticNode).textContent === node.textContent &&
								JSON.stringify((other as StaticNode).attrs) === JSON.stringify(attributes)
							);
						},
						sameMarkup(other) {
							return (
								Boolean(other) &&
								(other as StaticNode).type === type &&
								JSON.stringify((other as StaticNode).attrs) === JSON.stringify(attributes)
							);
						},
						toJSON() {
							return {
								type: type.name,
								attrs: attributes,
								...(node.textContent ? { textContent: node.textContent } : {})
							};
						}
					};

					if (!contentResolved && !isLeaf && definition.renderHTML) {
						try {
							const spec = definition.renderHTML({ node, HTMLAttributes });
							// Array specs describe ordered element children. Keep their positions so
							// repeated tag names cannot redirect the hole into decorative siblings.
							// Other serialization shapes should provide parseHTML.contentElement.
							let holePath: Array<{ tag: string; index: number }> | undefined;
							const visitSpec = (
								value: unknown,
								path: Array<{ tag: string; index: number }>,
								elementIndex: number
							): void => {
								if (holePath || !Array.isArray(value) || typeof value[0] !== 'string') return;
								const tag = value[0].trim().split(/\s+/).at(-1)?.toLowerCase();
								if (!tag) return;
								const nextPath = [...path, { tag, index: elementIndex }];
								const childStart =
									typeof value[1] === 'object' && value[1] !== null && !Array.isArray(value[1])
										? 2
										: 1;
								let childElementIndex = 0;
								for (let index = childStart; index < value.length; index += 1) {
									if (value[index] === 0) {
										holePath = nextPath;
										return;
									}
									const child = value[index];
									visitSpec(child, nextPath, childElementIndex);
									if (Array.isArray(child) || child?.nodeType === 1 || child?.dom?.nodeType === 1) {
										childElementIndex += 1;
									}
								}
							};
							visitSpec(spec, [], 0);

							if (holePath?.[0]?.tag === element.localName) {
								let selected: HTMLElement | undefined = element;
								for (const { tag, index } of holePath.slice(1)) {
									const candidate: Element | undefined = selected?.children[index];
									selected = candidate?.localName === tag
										? candidate as HTMLElement
										: undefined;
									if (!selected) break;
								}
								if (selected) {
									sourceContainer = selected;
									contentResolved = true;
									node.textContent = selected.textContent ?? '';
									node.childCount = selected.childNodes.length;
									node.content.size = node.textContent.length;
									node.content.childCount = selected.childNodes.length;
									node.nodeSize = node.textContent.length + 2;
								}
							}
						} catch (cause) {
							const diagnostic: StaticDiagnostic = {
								code: 'unresolved-content-hole',
								message: `Could not inspect ${definition.extension.name}.renderHTML(); direct children will be used.`,
								extension: definition.extension.name,
								cause
							};
							report(diagnostic);
							notifyError(cause, diagnostic);
						}
					}

					if (!contentResolved && !isLeaf) {
						report({
							code: 'unresolved-content-hole',
							message: `Could not identify ${definition.extension.name}'s serialized content hole; direct children will be used.`,
							extension: definition.extension.name,
							selector: inspectedRule.selector
						});
					}

					const props = {
						node,
						view: editor.view,
						getPos: () => 0,
						decorations: [] as const,
						innerDecorations: { eq: () => true, find: () => [] },
						selected: false as const,
						updateAttributes: () => undefined,
						deleteNode: () => undefined,
						editor,
						extension: definition.extension,
						HTMLAttributes
					};
					let result: StaticNodeViewResult | undefined;
					let hookFailureCode: StaticDiagnostic['code'] | undefined;
					let hookFailureMessage: string | undefined;
					let resultDestroyed = false;
					let mountedDOM: Node | undefined;
					let sourceReplaced = false;
					let movedNodes: Node[] = [];
					const originalParent = element.parentNode;
					const originalNextSibling = element.nextSibling;
					const destroyResult = () => {
						if (resultDestroyed) return;
						resultDestroyed = true;
						result?.destroy?.();
					};

					try {
						const hook = getStaticNodeViewHook(renderer);
						if (hook) {
							const candidate = hook as unknown as {
								version?: unknown;
								mount?: unknown;
								runtime?: unknown;
								value?: unknown;
							};
							if (candidate.version !== 1) {
								hookFailureCode = 'invalid-node-view-hook';
								hookFailureMessage = `${definition.extension.name} uses an unsupported static NodeView hook.`;
								throw new Error(`Unsupported static NodeView hook version ${String(candidate.version)}`);
							}
							if (typeof candidate.mount === 'function') {
								result = candidate.mount(props) as StaticNodeViewResult;
							} else if (
								typeof candidate.runtime === 'string' ||
								typeof candidate.runtime === 'symbol'
							) {
								const runtime = nodeViewRuntimes.get(candidate.runtime);
								if (!runtime) {
									hookFailureCode = 'missing-node-view-runtime';
									hookFailureMessage = `${definition.extension.name}'s static NodeView runtime ${String(candidate.runtime)} is not registered.`;
									throw new Error(hookFailureMessage);
								}
								result = runtime.mount({ value: candidate.value, props });
							} else {
								hookFailureCode = 'invalid-node-view-hook';
								hookFailureMessage = `${definition.extension.name} has an invalid static NodeView hook.`;
								throw new Error(hookFailureMessage);
							}
						} else if (options.rawNodeViews !== false) {
							result = renderer(props);
						} else {
							report({
								code: 'raw-node-view-disabled',
								message: `${definition.extension.name} has no static hook and raw NodeView fallback is disabled.`,
								extension: definition.extension.name
							});
							enhanceChildren(element);
							continue;
						}

						const dom = result?.dom;
						if (!dom || dom.nodeType !== 1) {
							throw new Error('NodeView must return a DOM Element in its dom property.');
						}
						mountedDOM = dom;
						const contentDOM = result.contentDOM ?? null;
						if (
							contentDOM &&
							(contentDOM.nodeType !== 1 || (dom !== contentDOM && !dom.contains(contentDOM)))
						) {
							throw new Error('NodeView contentDOM must be its dom node or a descendant of dom.');
						}

						movedNodes = [...sourceContainer.childNodes];
						const fragment = element.ownerDocument.createDocumentFragment();
						for (const movedNode of movedNodes) fragment.append(movedNode);
						if (dom !== element) {
							element.replaceWith(dom);
							sourceReplaced = true;
						}
						if (contentDOM) contentDOM.replaceChildren(fragment);
						mountedRecords.push({
							sourceElement: element,
							sourceContainer,
							sourceNodes: movedNodes,
							mountedDOM: dom,
							originalParent,
							originalNextSibling,
							destroy: destroyResult
						});
						if (contentDOM) enhanceChildren(contentDOM);
					} catch (cause) {
						try {
							destroyResult();
						} catch (destroyCause) {
							const diagnostic: StaticDiagnostic = {
								code: 'destroy-failed',
								message: `${definition.extension.name} also threw while cleaning up a failed mount.`,
								extension: definition.extension.name,
								cause: destroyCause
							};
							report(diagnostic);
							notifyError(destroyCause, diagnostic);
						}
						// A returned DOM can have a parent before it replaces the source.
						if (
							sourceReplaced &&
							mountedDOM &&
							originalParent &&
							mountedDOM.parentNode === originalParent
						) {
							originalParent.replaceChild(element, mountedDOM);
						} else if (!element.parentNode && originalParent) {
							originalParent.insertBefore(
								element,
								originalNextSibling?.parentNode === originalParent ? originalNextSibling : null
							);
						}
						if (movedNodes.length > 0) sourceContainer.replaceChildren(...movedNodes);
						const diagnostic: StaticDiagnostic = {
							code:
								cause instanceof Error && cause.message.includes('contentDOM')
									? 'invalid-content-dom'
										: cause instanceof Error && cause.message.includes('dom property')
										? 'invalid-node-view'
										: (hookFailureCode ?? 'mount-failed'),
							message:
								hookFailureMessage ??
								`${definition.extension.name} could not be statically mounted; the source element was preserved.`,
							extension: definition.extension.name,
							cause
						};
						report(diagnostic);
						notifyError(cause, diagnostic);
					}
				}
			};

			enhanceChildren(target);
		};

		const render = (html: string) => {
			const preparedHTML = options.prepareHTML?.(html) ?? html;
			disposeViews(true);
			currentHTML = preparedHTML;
			target.innerHTML = currentHTML;
			enhanceCurrentDOM();
		};

		if (preparedInitialHTML !== undefined) {
			target.innerHTML = currentHTML;
			enhanceCurrentDOM();
		} else {
			currentHTML = target.innerHTML;
			enhanceCurrentDOM();
		}

		const internal: ActiveSession = {
			dispose(restore) {
				if (disposed) return;
				disposed = true;
				disposeViews(restore);
				if (getActiveSession(target) === internal) setActiveSession(target);
			}
		};
		setActiveSession(target, internal);

		return {
			get html() {
				return currentHTML;
			},
			update(html: string) {
				if (disposed) throw new Error('Cannot update a destroyed static render session.');
				render(html);
			},
			destroy() {
				internal.dispose(true);
			}
		};
	};

	return {
		enhance(target) {
			return createSession(target, undefined);
		},
		mount(target, trustedHTML) {
			return createSession(target, trustedHTML);
		}
	};
}
