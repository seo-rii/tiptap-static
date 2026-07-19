import { createEnhancementEngine } from './engine.js';
import { inspectExtensions } from './extensions.js';
import type {
	LightRenderer,
	LightRendererOptions,
	StaticDiagnostic
} from './types.js';

export type { LightRenderer, LightRendererOptions } from './types.js';

export function createLightRenderer(options: LightRendererOptions): LightRenderer {
	const diagnostics: StaticDiagnostic[] = [];
	const report = (diagnostic: StaticDiagnostic) => {
		diagnostics.push(diagnostic);
		try {
			options.onDiagnostic?.(diagnostic);
		} catch {
			// Diagnostic callbacks are observers and must not interrupt enhancement.
		}
	};
	const inspection = inspectExtensions(options.extensions, report);
	const engine = createEnhancementEngine({
		inspection,
		rawNodeViews: options.rawNodeViews ?? false,
		nodeViewRuntimes: options.nodeViewRuntimes,
		editor: options.editor,
		report,
		onError: options.onError
	});

	return {
		get diagnostics() {
			return diagnostics;
		},
		enhance: engine.enhance,
		mount: engine.mount
	};
}
