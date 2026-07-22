import type {
	AnyRecord,
	HydratorOptions,
	StaticDiagnostic,
	StaticHydrator,
	StaticNode,
	StaticNodePlan,
	StaticNodeType,
	StaticNodeViewProps,
	StaticNodeViewResult,
	StaticNodeViewRuntime,
	StaticNodeViewRuntimeKey,
	StaticRenderSession,
	TiptapExtensionLike
} from './types.js';

interface ActiveSession {
	dispose(restore: boolean): void;
}

interface MountedRecord {
	extension: string;
	sourceElement: HTMLElement;
	sourceContainer: HTMLElement;
	sourceNodes: Node[];
	mountedDOM: Node;
	originalParent: Node | null;
	originalNextSibling: Node | null;
	destroy(): void;
}

interface PreparedNode {
	plan: StaticNodePlan;
	extension: TiptapExtensionLike;
	type: StaticNodeType;
}

const ACTIVE_SESSION = Symbol.for('@tiptap-static/active-session/v1');

export type {
	HydratorOptions,
	StaticHydrationMatch,
	StaticHydrationNodeType,
	StaticHydrationRule,
	StaticHydrator,
	StaticNodePlan
} from './types.js';

function getActiveSession(target: HTMLElement): ActiveSession | undefined {
	return (target as HTMLElement & { [ACTIVE_SESSION]?: ActiveSession })[ACTIVE_SESSION];
}

function setActiveSession(target: HTMLElement, session?: ActiveSession): void {
	if (!session) {
		delete (target as HTMLElement & { [ACTIVE_SESSION]?: ActiveSession })[ACTIVE_SESSION];
		return;
	}
	Object.defineProperty(target, ACTIVE_SESSION, { configurable: true, value: session });
}

export function defineStaticNode<const Plan extends StaticNodePlan>(plan: Plan): Plan {
	return plan;
}

export function createHydrator(options: HydratorOptions): StaticHydrator {
	const diagnostics: StaticDiagnostic[] = [];
	const report = (
		code: StaticDiagnostic['code'],
		extension?: string,
		cause?: unknown,
		selector?: string,
		detail?: string
	) => {
		const context = detail ?? selector ?? extension;
		const diagnostic: StaticDiagnostic = {
			code,
			message: context === undefined ? code : `${code}: ${context}`
		};
		if (extension !== undefined) diagnostic.extension = extension;
		if (selector !== undefined) diagnostic.selector = selector;
		if (cause !== undefined) diagnostic.cause = cause;
		diagnostics.push(diagnostic);
		try {
			options.onDiagnostic?.(diagnostic);
		} catch {
			// Diagnostic callbacks are observers.
		}
		return diagnostic;
	};
	const notifyError = (cause: unknown, diagnostic: StaticDiagnostic) => {
		try {
			options.onError?.(cause, diagnostic);
		} catch {
			// Error callbacks are observers.
		}
	};
	const runtimes = new Map<StaticNodeViewRuntimeKey, StaticNodeViewRuntime>();
	for (const runtime of options.nodeViewRuntimes ?? []) {
		if (runtimes.has(runtime.key)) {
			report(
				'duplicate-node-view-runtime',
				undefined,
				undefined,
				undefined,
				String(runtime.key)
			);
			continue;
		}
		runtimes.set(runtime.key, runtime);
	}
	const nodes: PreparedNode[] = options.nodes.map((plan) => {
		const extension =
			plan.extension ??
			({
				name: plan.name,
				type: 'node',
				options: plan.options ?? {},
				storage: plan.storage ?? {},
				config: {}
			} satisfies TiptapExtensionLike);
		return {
			plan,
			extension,
			type: {
				name: plan.name,
				spec: {
					selectable: true,
					...(plan.type.spec ?? {}),
					...(plan.type.isInline === undefined ? {} : { inline: plan.type.isInline }),
					...(plan.type.isAtom === undefined ? {} : { atom: plan.type.isAtom })
				}
			}
		};
	});
	const extensionStorage = Object.fromEntries(
		nodes.map(({ extension }) => [extension.name, extension.storage ?? {}])
	);
	const invalidSelectors = new Set<string>();

	const createSession = (
		target: HTMLElement,
		initialHTML: string | undefined
	): StaticRenderSession => {
		getActiveSession(target)?.dispose(true);
		let currentHTML = initialHTML ?? target.innerHTML;
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
						const diagnostic = report('destroy-failed', record.extension, cause);
						notifyError(cause, diagnostic);
					}
				}
				try {
					record.destroy();
				} catch (cause) {
					const diagnostic = report('destroy-failed', record.extension, cause);
					notifyError(cause, diagnostic);
				}
			}
			mountedRecords = [];
		};

		const hydrateCurrentDOM = () => {
			const selection = { from: -1, to: -1 };
			const listeners = new Map<string, Set<(...args: any[]) => void>>();
			const commands = new Proxy<AnyRecord>({}, { get: () => () => false });
			let chain: AnyRecord;
			chain = new Proxy({}, {
				get: (_target, property) =>
					property === 'run' ? () => false : () => chain
			});
			const facade: AnyRecord = {
				options: { editable: false },
				isEditable: false,
				isFocused: false,
				state: { selection },
				commands,
				chain: () => chain,
				can: () => commands,
				extensionStorage,
				extensionManager: { attributes: [] },
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
				view: { dom: target, state: { selection }, dispatch: () => undefined }
			};
			const editor =
				typeof options.editor === 'function'
					? options.editor(facade)
					: Object.assign(facade, options.editor ?? {});

			const hydrateChildren = (container: ParentNode) => {
				for (const child of [...container.childNodes]) {
					if (child.nodeType !== 1) continue;
					const element = child as HTMLElement;
					let matched:
						| {
							prepared: PreparedNode;
							attrs: AnyRecord;
							HTMLAttributes: AnyRecord;
							contentElement?: string | ((element: HTMLElement) => HTMLElement | null);
						}
						| undefined;

					for (const prepared of nodes) {
						for (const rule of prepared.plan.rules) {
							if (invalidSelectors.has(rule.selector)) continue;
							if (rule.namespace && rule.namespace !== element.namespaceURI) continue;
							let matches = false;
							try {
								matches = element.matches(rule.selector);
							} catch (cause) {
								invalidSelectors.add(rule.selector);
								const diagnostic = report(
									'invalid-selector',
									prepared.plan.name,
									cause,
									rule.selector
								);
								notifyError(cause, diagnostic);
							}
							if (!matches) continue;
							try {
								const parsed = rule.parse?.(element);
								if (parsed === false) continue;
								const attrs = parsed?.attrs ?? {};
								matched = {
									prepared,
									attrs,
									HTMLAttributes: parsed?.HTMLAttributes ?? attrs,
									contentElement: rule.contentElement
								};
								break;
							} catch (cause) {
								const diagnostic = report('mount-failed', prepared.plan.name, cause);
								notifyError(cause, diagnostic);
							}
						}
						if (matched) break;
					}

					if (!matched) {
						hydrateChildren(element);
						continue;
					}

					const { prepared, attrs, HTMLAttributes, contentElement } = matched;
					let sourceContainer = element;
					if (contentElement !== undefined) {
						try {
							const selected =
								typeof contentElement === 'string'
									? element.querySelector(contentElement)
									: contentElement(element);
							if (!selected || selected.nodeType !== 1 || !element.contains(selected)) {
								throw new Error('unresolved-content-hole');
							}
							sourceContainer = selected as HTMLElement;
						} catch (cause) {
							const diagnostic = report(
								'unresolved-content-hole',
								prepared.plan.name,
								cause
							);
							notifyError(cause, diagnostic);
							hydrateChildren(element);
							continue;
						}
					}

					const textContent = sourceContainer.textContent ?? '';
					const { type: nodeType } = prepared;
					let node: StaticNode;
					node = {
						type: nodeType,
						attrs,
						textContent,
						nodeSize: prepared.plan.type.isLeaf ? 1 : textContent.length + 2,
						isInline: Boolean(prepared.plan.type.isInline),
						isLeaf: prepared.plan.type.isLeaf,
						isAtom: prepared.plan.type.isLeaf || Boolean(prepared.plan.type.isAtom),
						childCount: sourceContainer.childNodes.length,
						content: {
							size: textContent.length,
							childCount: sourceContainer.childNodes.length,
							content: []
						},
						eq(other) {
							return (
								Boolean(other) &&
								(other as StaticNode).type === nodeType &&
								(other as StaticNode).textContent === textContent &&
								JSON.stringify((other as StaticNode).attrs) === JSON.stringify(attrs)
							);
						},
						sameMarkup(other) {
							return (
								Boolean(other) &&
								(other as StaticNode).type === nodeType &&
								JSON.stringify((other as StaticNode).attrs) === JSON.stringify(attrs)
							);
						},
						toJSON() {
							return {
								type: nodeType.name,
								attrs,
								...(node.textContent ? { textContent: node.textContent } : {})
							};
						}
					};
					const props: StaticNodeViewProps = {
						node,
						view: editor.view,
						getPos: () => 0,
						decorations: [],
						innerDecorations: { eq: () => true, find: () => [] },
						selected: false,
						updateAttributes: () => undefined,
						deleteNode: () => undefined,
						editor,
						extension: prepared.extension,
						HTMLAttributes
					};
					let result: StaticNodeViewResult | undefined;
					let failureCode: StaticDiagnostic['code'] = 'mount-failed';
					let resultDestroyed = false;
					let mountedDOM: Node | undefined;
					let movedNodes: Node[] = [];
					const originalParent = element.parentNode;
					const originalNextSibling = element.nextSibling;
					const destroyResult = () => {
						if (resultDestroyed) return;
						resultDestroyed = true;
						result?.destroy?.();
					};

					try {
						const hook = prepared.plan.nodeView as unknown as {
							version?: unknown;
							mount?: unknown;
							runtime?: unknown;
							value?: unknown;
						} | null;
						if (!hook || typeof hook !== 'object' || hook.version !== 1) {
							failureCode = 'invalid-node-view-hook';
							throw new Error(failureCode);
						}
						if (typeof hook.mount === 'function') {
							result = hook.mount(props) as StaticNodeViewResult;
						} else if (
							typeof hook.runtime === 'string' ||
							typeof hook.runtime === 'symbol'
						) {
							const runtime = runtimes.get(hook.runtime);
							if (!runtime) {
								failureCode = 'missing-node-view-runtime';
								throw new Error(failureCode);
							}
							result = runtime.mount({ value: hook.value, props });
						} else {
							failureCode = 'invalid-node-view-hook';
							throw new Error(failureCode);
						}
						const dom = result?.dom;
						if (!dom || dom.nodeType !== 1) {
							failureCode = 'invalid-node-view';
							throw new Error(failureCode);
						}
						mountedDOM = dom;
						const contentDOM = result?.contentDOM ?? null;
						if (
							contentDOM &&
							(contentDOM.nodeType !== 1 || (dom !== contentDOM && !dom.contains(contentDOM)))
						) {
							failureCode = 'invalid-content-dom';
							throw new Error(failureCode);
						}
						movedNodes = [...sourceContainer.childNodes];
						const fragment = element.ownerDocument.createDocumentFragment();
						for (const movedNode of movedNodes) fragment.append(movedNode);
						if (dom !== element) element.replaceWith(dom);
						if (contentDOM) contentDOM.replaceChildren(fragment);
						mountedRecords.push({
							extension: prepared.plan.name,
							sourceElement: element,
							sourceContainer,
							sourceNodes: movedNodes,
							mountedDOM: dom,
							originalParent,
							originalNextSibling,
							destroy: destroyResult
						});
						if (contentDOM) hydrateChildren(contentDOM);
					} catch (cause) {
						try {
							destroyResult();
						} catch (destroyCause) {
							const diagnostic = report(
								'destroy-failed',
								prepared.plan.name,
								destroyCause
							);
							notifyError(destroyCause, diagnostic);
						}
						if (mountedDOM?.parentNode) {
							mountedDOM.parentNode.replaceChild(element, mountedDOM);
						} else if (!element.parentNode && originalParent) {
							originalParent.insertBefore(
								element,
								originalNextSibling?.parentNode === originalParent ? originalNextSibling : null
							);
						}
						if (movedNodes.length > 0) sourceContainer.replaceChildren(...movedNodes);
						const diagnostic = report(failureCode, prepared.plan.name, cause);
						notifyError(cause, diagnostic);
						hydrateChildren(element);
					}
				}
			};

			hydrateChildren(target);
		};

		if (initialHTML !== undefined) target.innerHTML = currentHTML;
		hydrateCurrentDOM();
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
			update(html) {
				if (disposed) throw new Error('Cannot update a destroyed hydration session.');
				disposeViews(true);
				currentHTML = html;
				target.innerHTML = html;
				hydrateCurrentDOM();
			},
			destroy() {
				internal.dispose(true);
			}
		};
	};

	return {
		get diagnostics() {
			return diagnostics;
		},
		enhance(target) {
			return createSession(target, undefined);
		},
		mount(target, trustedHTML) {
			return createSession(target, trustedHTML);
		}
	};
}
