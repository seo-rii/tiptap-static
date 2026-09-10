import type {
	AnyRecord,
	StaticDiagnostic,
	TiptapAttributeLike,
	TiptapExtensionLike,
	TiptapParseRuleLike
} from './types.js';

export interface InspectedAttribute {
	type: string;
	name: string;
	attribute: Required<
		Pick<TiptapAttributeLike, 'rendered' | 'keepOnSplit' | 'isRequired'>
	> &
		TiptapAttributeLike;
	hasDefault: boolean;
}

export interface InspectedParseRule {
	extension: TiptapExtensionLike;
	rule: TiptapParseRuleLike;
	selector: string;
	tagName?: string;
	extensionOrder: number;
	ruleOrder: number;
}

export interface InspectedNodeExtension {
	extension: TiptapExtensionLike;
	attributes: InspectedAttribute[];
	rules: InspectedParseRule[];
	typeSpec: AnyRecord;
	renderHTML?: (props: AnyRecord) => unknown;
	hasNodeView: boolean;
}

export interface ExtensionInspection {
	extensions: TiptapExtensionLike[];
	nodes: InspectedNodeExtension[];
	marks: InspectedNodeExtension[];
	attributes: InspectedAttribute[];
	rules: InspectedParseRule[];
	diagnostics: StaticDiagnostic[];
}

export function resolveExtensionField<T = unknown>(
	extension: TiptapExtensionLike,
	field: string,
	context: AnyRecord = {}
): T {
	const resolve = (current: TiptapExtensionLike, seen: Set<TiptapExtensionLike>): unknown => {
		if (seen.has(current)) {
			throw new Error(`Circular extension parent chain while resolving ${extension.name}.${field}`);
		}

		const nextSeen = new Set(seen);
		nextSeen.add(current);
		const value = current.config[field];

		if (value === undefined && current.parent) {
			return resolve(current.parent, nextSeen);
		}

		if (typeof value !== 'function') return value;

		return value.bind({
			...context,
			parent: current.parent ? resolve(current.parent, nextSeen) : null
		});
	};

	return resolve(extension, new Set()) as T;
}

export function inspectExtensions(
	input: readonly TiptapExtensionLike[],
	onDiagnostic?: (diagnostic: StaticDiagnostic) => void
): ExtensionInspection {
	const diagnostics: StaticDiagnostic[] = [];
	const report = (diagnostic: StaticDiagnostic) => {
		diagnostics.push(diagnostic);
		onDiagnostic?.(diagnostic);
	};
	const flattened: TiptapExtensionLike[] = [];
	const extensionContexts = new Map<TiptapExtensionLike, AnyRecord>();
	const stack = [...input].reverse();

	while (stack.length > 0) {
		const extension = stack.pop();
		if (!extension) continue;
		flattened.push(extension);
		let context = extensionContexts.get(extension);
		if (!context) {
			const options = extension.options ?? {};
			let storage: AnyRecord;
			if (Object.hasOwn(extension, 'storage')) {
				storage = extension.storage ?? {};
			} else {
				const addStorage = resolveExtensionField<(() => AnyRecord) | undefined>(
					extension,
					'addStorage',
					{ name: extension.name, options }
				);
				storage = addStorage?.() ?? {};
			}
			context = { name: extension.name, options, storage };
			extensionContexts.set(extension, context);
		}

		try {
			const addExtensions = resolveExtensionField<(() => TiptapExtensionLike[]) | undefined>(
				extension,
				'addExtensions',
				context
			);
			const children = addExtensions?.() ?? [];
			for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
		} catch (cause) {
			report({
				code: 'extension-field-failed',
				message: `Could not resolve ${extension.name}.addExtensions().`,
				extension: extension.name,
				cause
			});
		}
	}

	const extensions = flattened
		.map((extension, index) => ({
			extension,
			index,
			priority:
				Number(
					resolveExtensionField<number | undefined>(
						extension,
						'priority',
						extensionContexts.get(extension)
					) ?? 100
				) || 100
		}))
		.sort((left, right) => right.priority - left.priority || left.index - right.index)
		.map(({ extension }) => extension);

	const nameCounts = new Map<string, number>();
	for (const extension of extensions) {
		nameCounts.set(extension.name, (nameCounts.get(extension.name) ?? 0) + 1);
	}
	for (const [name, count] of nameCounts) {
		if (count > 1) {
			report({
				code: 'duplicate-extension',
				message: `Extension name ${JSON.stringify(name)} occurs ${count} times; the last definition wins.`,
				extension: name
			});
		}
	}

	const nodesByName = new Map<string, InspectedNodeExtension>();
	const marksByName = new Map<string, InspectedNodeExtension>();
	const nodeAndMarkExtensions = extensions.filter(
		(extension) => extension.type === 'node' || extension.type === 'mark'
	);

	for (const [extensionOrder, extension] of extensions.entries()) {
		if (extension.type !== 'node' && extension.type !== 'mark') continue;

		const context = extensionContexts.get(extension) ?? {};
		const rules: InspectedParseRule[] = [];

		try {
			const parseHTML = resolveExtensionField<(() => TiptapParseRuleLike[]) | undefined>(
				extension,
				'parseHTML',
				context
			);
			for (const [ruleOrder, rule] of (parseHTML?.() ?? []).entries()) {
				if (!rule.tag) {
					report({
						code: 'unsupported-parse-rule',
						message: `${extension.name} has a style-only or tagless parse rule, which static enhancement cannot match.`,
						extension: extension.name
					});
					continue;
				}

				if (
					rule.context !== undefined ||
					rule.consuming === false ||
					rule.getContent !== undefined ||
					rule.ignore !== undefined ||
					rule.skip !== undefined ||
					rule.closeParent !== undefined
				) {
					report({
						code: 'unsupported-parse-rule',
						message: `${extension.name} uses a parse-rule feature that requires ProseMirror's DOMParser.`,
						extension: extension.name,
						selector: rule.tag
					});
					continue;
				}

				const selectorWithoutAttributes = rule.tag.replace(/\[[^\]]*\]/g, '');
				const tagMatch = rule.tag.match(/^([A-Za-z][A-Za-z0-9:_-]*)/);
				const tagName =
					tagMatch && !/[\s>+~,]/.test(selectorWithoutAttributes)
						? tagMatch[1].toLowerCase()
						: undefined;
				rules.push({ extension, rule, selector: rule.tag, tagName, extensionOrder, ruleOrder });
			}
		} catch (cause) {
			report({
				code: 'extension-field-failed',
				message: `Could not resolve ${extension.name}.parseHTML().`,
				extension: extension.name,
				cause
			});
		}

		let renderHTML: ((props: AnyRecord) => unknown) | undefined;
		let hasNodeView = false;
		try {
			renderHTML = resolveExtensionField<typeof renderHTML>(extension, 'renderHTML', context);
			hasNodeView = Boolean(resolveExtensionField(extension, 'addNodeView', context));
		} catch (cause) {
			report({
				code: 'extension-field-failed',
				message: `Could not inspect ${extension.name}'s rendering fields.`,
				extension: extension.name,
				cause
			});
		}

		const typeSpec: AnyRecord = {};
		for (const field of [
			'atom',
			'content',
			'defining',
			'draggable',
			'inline',
			'isolating',
			'selectable',
			'whitespace'
		]) {
			const value = resolveExtensionField(extension, field, context);
			if (value !== undefined) typeSpec[field] = value;
		}

		const inspected = {
			extension,
			attributes: [],
			rules,
			typeSpec,
			renderHTML,
			hasNodeView
		};
		if (extension.type === 'node') nodesByName.set(extension.name, inspected);
		else marksByName.set(extension.name, inspected);
	}

	const attributes: InspectedAttribute[] = [];
	const nodeAttributeTypes = nodeAndMarkExtensions
		.filter((extension) => extension.type === 'node' && extension.name !== 'text')
		.map((extension) => extension.name);
	const markAttributeTypes = nodeAndMarkExtensions
		.filter((extension) => extension.type === 'mark')
		.map((extension) => extension.name);
	for (const extension of extensions) {
		try {
			const addGlobalAttributes = resolveExtensionField<
				| (() => Array<{
						types: string[] | '*' | 'nodes' | 'marks';
						attributes: Record<string, TiptapAttributeLike>;
					}>)
				| undefined
			>(extension, 'addGlobalAttributes', {
				...extensionContexts.get(extension),
				extensions: nodeAndMarkExtensions
			});

			for (const group of addGlobalAttributes?.() ?? []) {
				// Match Tiptap's shorthand ordering and exclusion of text attributes.
				let types: string[];
				if (Array.isArray(group.types)) types = group.types;
				else if (group.types === '*') types = [...nodeAttributeTypes, ...markAttributeTypes];
				else if (group.types === 'nodes') types = nodeAttributeTypes;
				else if (group.types === 'marks') types = markAttributeTypes;
				else types = [];
				for (const type of types) {
					for (const [name, attribute] of Object.entries(group.attributes)) {
						attributes.push({
							type,
							name,
							attribute: {
								default: null,
								rendered: true,
								renderHTML: null,
								parseHTML: null,
								keepOnSplit: true,
								isRequired: false,
								...attribute
							},
							hasDefault: !attribute.isRequired
						});
					}
				}
			}
		} catch (cause) {
			report({
				code: 'extension-field-failed',
				message: `Could not resolve ${extension.name}.addGlobalAttributes().`,
				extension: extension.name,
				cause
			});
		}
	}

	for (const extension of nodeAndMarkExtensions) {
		try {
			const addAttributes = resolveExtensionField<
				(() => Record<string, TiptapAttributeLike>) | undefined
			>(extension, 'addAttributes', extensionContexts.get(extension));

			for (const [name, originalAttribute] of Object.entries(addAttributes?.() ?? {})) {
				const attribute: InspectedAttribute['attribute'] = {
					default: null,
					rendered: true,
					renderHTML: null,
					parseHTML: null,
					keepOnSplit: true,
					isRequired: false,
					...originalAttribute
				};
				if (typeof attribute.default === 'function') attribute.default = attribute.default();
				// Tiptap's schema omits all defaults for required attributes, including
				// explicit null/literal defaults retained by getAttributesFromExtensions.
				const hasDefault = !attribute.isRequired;
				if (attribute.isRequired && attribute.default === undefined) delete attribute.default;
				attributes.push({ type: extension.name, name, attribute, hasDefault });
			}
		} catch (cause) {
			report({
				code: 'extension-field-failed',
				message: `Could not resolve ${extension.name}.addAttributes().`,
				extension: extension.name,
				cause
			});
		}
	}

	for (const node of nodesByName.values()) {
		node.attributes = attributes.filter((attribute) => attribute.type === node.extension.name);
	}
	for (const mark of marksByName.values()) {
		mark.attributes = attributes.filter((attribute) => attribute.type === mark.extension.name);
	}

	const nodes = [...nodesByName.values()];
	const marks = [...marksByName.values()];
	const rules = nodes
		.flatMap((node) => node.rules)
		.sort(
			(left, right) =>
				Number(right.rule.priority ?? 50) - Number(left.rule.priority ?? 50) ||
				left.extensionOrder - right.extensionOrder ||
				left.ruleOrder - right.ruleOrder
		);

	return { extensions, nodes, marks, attributes, rules, diagnostics };
}
