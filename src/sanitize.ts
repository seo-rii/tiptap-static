import sanitizeHtml from 'sanitize-html';

import { inspectExtensions, type ExtensionInspection } from './extensions.js';
import type {
	AllowedAttribute,
	AnyRecord,
	StaticDiagnostic,
	StaticSanitizeOptions,
	TiptapExtensionLike
} from './types.js';

const ACTIVE_CONTENT_TAGS = new Set(['embed', 'iframe', 'object', 'script', 'style']);
const HARD_DENIED_TAGS = new Set(['script', 'style']);

export function sanitizeTiptapHTML(
	html: string,
	extensions: readonly TiptapExtensionLike[],
	options: StaticSanitizeOptions = {},
	onDiagnostic?: (diagnostic: StaticDiagnostic) => void
): string {
	return sanitizeWithInspection(html, inspectExtensions(extensions, onDiagnostic), options, onDiagnostic);
}

export function sanitizeWithInspection(
	html: string,
	inspection: ExtensionInspection,
	options: StaticSanitizeOptions = {},
	onDiagnostic?: (diagnostic: StaticDiagnostic) => void
): string {
	const {
		attributeValidators = {},
		allowActiveContentTags = [],
		transformTags: requestedTransforms = {},
		...requested
	} = options;
	const explicitlyAllowedTags = new Set(
		options.allowedTags === false ? [] : (options.allowedTags ?? []).map((tag) => tag.toLowerCase())
	);
	const activeTagOptIns = new Set(allowActiveContentTags.map((tag) => tag.toLowerCase()));
	const inferredTags = new Set<string>();
	const inferredAttributes = new Map<string, AllowedAttribute[]>();
	const defaultsByType = new Map<string, AnyRecord>();

	for (const node of inspection.nodes) {
		const defaults: AnyRecord = {};
		for (const item of node.attributes) {
			if (item.hasDefault) defaults[item.name] = item.attribute.default;
		}
		defaultsByType.set(node.extension.name, defaults);
	}

	for (const node of inspection.nodes) {
		const tagNames = new Set(node.rules.map((rule) => rule.tagName).filter(Boolean) as string[]);
		for (const rule of node.rules) {
			if (!rule.tagName) {
				onDiagnostic?.({
					code: 'sanitize-selector-not-inferred',
					message: `Sanitizer permissions cannot be inferred from selector ${JSON.stringify(rule.selector)}; add an explicit sanitizer override.`,
					extension: node.extension.name,
					selector: rule.selector
				});
			}
		}

		for (const tagName of tagNames) {
			if (HARD_DENIED_TAGS.has(tagName)) continue;
			if (
				ACTIVE_CONTENT_TAGS.has(tagName) &&
				!activeTagOptIns.has(tagName) &&
				!explicitlyAllowedTags.has(tagName)
			) {
				onDiagnostic?.({
					code: 'active-tag-requires-opt-in',
					message: `${tagName} is active content and was not inferred automatically; allow it explicitly after defining its URL policy.`,
					extension: node.extension.name
				});
				continue;
			}

			inferredTags.add(tagName);
			const names = inferredAttributes.get(tagName) ?? [];
			const knownNames = new Set(
				names.map((attribute) => (typeof attribute === 'string' ? attribute : attribute.name))
			);

			for (const item of node.attributes) {
				if (item.attribute.rendered === false) continue;
				const candidateNames = new Set(item.attribute.renderHTML ? [] : [item.name]);
				if (item.attribute.renderHTML) {
					try {
						const probeAttributes = {
							...(defaultsByType.get(node.extension.name) ?? {}),
							[item.name]:
								typeof item.attribute.default === 'boolean'
									? true
									: typeof item.attribute.default === 'number'
										? 1
										: '__tiptap_static__'
						};
						for (const key of Object.keys(item.attribute.renderHTML(probeAttributes) ?? {})) {
							candidateNames.add(key);
						}
					} catch (cause) {
						onDiagnostic?.({
							code: 'attribute-probe-failed',
							message: `Could not infer rendered attribute names for ${node.extension.name}.${item.name}.`,
							extension: node.extension.name,
							cause
						});
					}
				}

				for (const candidate of candidateNames) {
					const normalized = candidate.toLowerCase();
					if (/^on/i.test(normalized) || normalized === 'srcdoc' || normalized === 'style') continue;
					if (!knownNames.has(normalized)) {
						names.push(normalized);
						knownNames.add(normalized);
					}
				}
			}
			inferredAttributes.set(tagName, names);
		}
	}

	const allowedTags =
		options.allowedTags === false
			? false
			: [
					...new Set([
						...sanitizeHtml.defaults.allowedTags,
						...inferredTags,
						...(options.allowedTags ?? []).map((tag) => tag.toLowerCase())
					])
				].filter((tag) => !HARD_DENIED_TAGS.has(tag));

	let allowedAttributes: Record<string, AllowedAttribute[]> | false;
	if (options.allowedAttributes === false) {
		allowedAttributes = false;
	} else {
		allowedAttributes = {};
		const sources = [sanitizeHtml.defaults.allowedAttributes, Object.fromEntries(inferredAttributes), options.allowedAttributes ?? {}];
		for (const source of sources) {
			for (const [tagName, attributes] of Object.entries(source)) {
				const normalizedTag = tagName.toLowerCase();
				const output = allowedAttributes[normalizedTag] ?? [];
				const known = new Set(
					output.map((attribute) =>
						typeof attribute === 'string' ? attribute.toLowerCase() : attribute.name.toLowerCase()
					)
				);
				for (const attribute of attributes as AllowedAttribute[]) {
					const name =
						typeof attribute === 'string' ? attribute.toLowerCase() : attribute.name.toLowerCase();
					if (/^on/i.test(name) || name === 'srcdoc') continue;
					if (!known.has(name)) {
						output.push(typeof attribute === 'string' ? name : { ...attribute, name });
						known.add(name);
					}
				}
				allowedAttributes[normalizedTag] = output;
			}
		}
	}

	const transformKeys = new Set([
		'*',
		...Object.keys(requestedTransforms),
		...(allowedTags === false ? [] : allowedTags)
	]);
	const transformTags: NonNullable<Parameters<typeof sanitizeHtml>[1]>['transformTags'] = {};
	for (const transformKey of transformKeys) {
		transformTags[transformKey] = (originalTagName, originalAttributes) => {
			if (HARD_DENIED_TAGS.has(originalTagName.toLowerCase())) {
				return { tagName: originalTagName, attribs: {} };
			}
			let tagName = originalTagName;
			let attributes = { ...originalAttributes };
			const requestedTransform = requestedTransforms[transformKey] ?? requestedTransforms['*'];
			if (typeof requestedTransform === 'string') {
				tagName = requestedTransform;
			} else if (requestedTransform) {
				const transformed = requestedTransform(tagName, attributes);
				tagName = transformed.tagName;
				attributes = { ...transformed.attribs };
			}

			for (const name of Object.keys(attributes)) {
				if (/^on/i.test(name) || name.toLowerCase() === 'srcdoc') delete attributes[name];
			}
			if (HARD_DENIED_TAGS.has(tagName.toLowerCase())) {
				tagName = 'span';
				attributes = {};
			}

			const validators = [attributeValidators['*'], attributeValidators[tagName.toLowerCase()]];
			for (const [attributeName, value] of Object.entries(attributes)) {
				let currentValue = value;
				for (const validatorSet of validators) {
					const validator = validatorSet?.[attributeName] ?? validatorSet?.['*'];
					if (!validator) continue;
					const result = validator(currentValue, {
						tagName,
						attributeName,
						attributes
					});
					if (result === false || result === null) {
						delete attributes[attributeName];
						break;
					}
					if (typeof result === 'string') {
						currentValue = result;
						attributes[attributeName] = result;
					}
				}
			}

			return { tagName, attribs: attributes };
		};
	}

	const allowedSchemesAppliedToAttributes = [
		...new Set([
			...sanitizeHtml.defaults.allowedSchemesAppliedToAttributes,
			'poster',
			'action',
			'formaction',
			'xlink:href',
			...(options.allowedSchemesAppliedToAttributes ?? [])
		])
	];
	const sanitizeOptions = {
		...requested,
		allowedTags,
		allowedAttributes,
		allowProtocolRelative: options.allowProtocolRelative ?? false,
		allowedSchemesAppliedToAttributes,
		selfClosing: [
			...new Set([...sanitizeHtml.defaults.selfClosing, 'embed', ...(options.selfClosing ?? [])])
		],
		allowVulnerableTags: allowedTags === false ? true : options.allowVulnerableTags,
		exclusiveFilter: (frame: Parameters<NonNullable<StaticSanitizeOptions['exclusiveFilter']>>[0]) => {
			if (HARD_DENIED_TAGS.has(frame.tag.toLowerCase())) return true;
			return options.exclusiveFilter?.(frame) ?? false;
		},
		transformTags
	} as NonNullable<Parameters<typeof sanitizeHtml>[1]>;

	return sanitizeHtml(html, sanitizeOptions);
}
