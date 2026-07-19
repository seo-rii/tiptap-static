import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	renderBundleSizeMarkdown,
	runBundleSizeBenchmark
} from './bundle-size.mjs';
import { renderPerformanceMarkdown, runRenderBenchmark } from './render.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDirectory = resolve(projectRoot, 'benchmark-results');

async function capture(name, run, renderMarkdown) {
	try {
		const result = await run();
		return { result, markdown: renderMarkdown(result), passed: result.passed };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return {
			result: {
				schemaVersion: 1,
				benchmark: name,
				generatedAt: new Date().toISOString(),
				passed: false,
				error: message
			},
			markdown: `## ${name}\n\n> Benchmark failed before producing metrics: ${message}\n`,
			passed: false
		};
	}
}

await mkdir(resultsDirectory, { recursive: true });
const render = await capture(
	'render-performance',
	runRenderBenchmark,
	renderPerformanceMarkdown
);
const bundleSize = await capture(
	'bundle-size',
	runBundleSizeBenchmark,
	renderBundleSizeMarkdown
);
const summary = ['# Tiptap comparison', '', render.markdown, bundleSize.markdown].join('\n');

await Promise.all([
	writeFile(
		resolve(resultsDirectory, 'render.json'),
		`${JSON.stringify(render.result, null, 2)}\n`
	),
	writeFile(resolve(resultsDirectory, 'render.md'), `${render.markdown}\n`),
	writeFile(
		resolve(resultsDirectory, 'bundle-size.json'),
		`${JSON.stringify(bundleSize.result, null, 2)}\n`
	),
	writeFile(resolve(resultsDirectory, 'bundle-size.md'), `${bundleSize.markdown}\n`),
	writeFile(resolve(resultsDirectory, 'summary.md'), `${summary}\n`)
]);

if (process.env.GITHUB_STEP_SUMMARY) {
	await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

console.log(summary);
if (!render.passed || !bundleSize.passed) process.exitCode = 1;
