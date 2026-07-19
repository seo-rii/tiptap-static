import { createEnhancementEngine } from './engine.js';
import { inspectExtensions } from './extensions.js';
import { sanitizeWithInspection } from './sanitize.js';
import type {
	StaticDiagnostic,
	StaticRenderer,
	StaticRendererOptions,
	StaticSanitizeOptions
} from './types.js';

export function createStaticRenderer(options: StaticRendererOptions): StaticRenderer {
	const diagnostics: StaticDiagnostic[] = [];
	const report = (diagnostic: StaticDiagnostic) => {
		diagnostics.push(diagnostic);
		try {
			options.onDiagnostic?.(diagnostic);
		} catch {
			// Diagnostic callbacks are observers and must not interrupt rendering.
		}
	};
	const inspection = inspectExtensions(options.extensions, report);

	const sanitize = (html: string, overrides: StaticSanitizeOptions = {}) => {
		const baseSanitize = options.sanitize ?? {};
		let allowedAttributes: StaticSanitizeOptions['allowedAttributes'];
		if (overrides.allowedAttributes === false || baseSanitize.allowedAttributes === false) {
			allowedAttributes = overrides.allowedAttributes ?? baseSanitize.allowedAttributes;
		} else {
			allowedAttributes = {};
			for (const source of [baseSanitize.allowedAttributes ?? {}, overrides.allowedAttributes ?? {}]) {
				for (const [tagName, attributes] of Object.entries(source)) {
					const current = allowedAttributes[tagName] ?? [];
					const known = new Set(
						current.map((attribute) =>
							typeof attribute === 'string' ? attribute : attribute.name
						)
					);
					for (const attribute of attributes) {
						const name = typeof attribute === 'string' ? attribute : attribute.name;
						if (!known.has(name)) current.push(attribute);
						known.add(name);
					}
					allowedAttributes[tagName] = current;
				}
			}
		}
		const attributeValidators = { ...(baseSanitize.attributeValidators ?? {}) };
		for (const [tagName, validators] of Object.entries(overrides.attributeValidators ?? {})) {
			attributeValidators[tagName] = {
				...(attributeValidators[tagName] ?? {}),
				...validators
			};
		}

		return sanitizeWithInspection(
			html,
			inspection,
			{
				...baseSanitize,
				...overrides,
				allowedTags:
					overrides.allowedTags === false || baseSanitize.allowedTags === false
						? overrides.allowedTags ?? baseSanitize.allowedTags
						: [
								...(baseSanitize.allowedTags ?? []),
								...(overrides.allowedTags ?? [])
							],
				allowedAttributes,
				attributeValidators
			},
			report
		);
	};
	const engine = createEnhancementEngine({
		inspection,
		rawNodeViews: options.rawNodeViews,
		nodeViewRuntimes: options.nodeViewRuntimes,
		editor: options.editor,
		prepareHTML: sanitize,
		report,
		onError: options.onError
	});

	return {
		get diagnostics() {
			return diagnostics;
		},
		sanitize,
		enhance(target) {
			return engine.enhance(target);
		},
		mount(target, html) {
			return engine.mount(target, html);
		}
	};
}
