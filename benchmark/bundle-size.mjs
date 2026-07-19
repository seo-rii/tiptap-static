import { readFile } from 'node:fs/promises';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build, version as esbuildVersion } from 'esbuild';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(benchmarkDirectory, '..');
const buildOptions = {
	bundle: true,
	minify: true,
	treeShaking: true,
	platform: 'browser',
	format: 'esm',
	target: 'es2022',
	legalComments: 'none',
	sourcemap: false,
	write: false,
	metafile: true,
	absWorkingDir: projectRoot
};

function round(value, digits = 4) {
	return Number(value.toFixed(digits));
}

function formatBytes(bytes) {
	return `${(bytes / 1024).toFixed(2)} KiB`;
}

async function bundleEntry(name, contents) {
	const result = await build({
		...buildOptions,
		outfile: `${name}.js`,
		stdin: {
			contents,
			resolveDir: projectRoot,
			sourcefile: `${name}.js`
		}
	});
	const output = result.outputFiles.find((file) => file.path.endsWith('.js'));
	if (!output) throw new Error(`esbuild did not emit JavaScript for ${name}.`);
	return {
		bytes: output.contents,
		inputModules: Object.keys(result.metafile.inputs).length
	};
}

function summarizeBundle(bundle) {
	return {
		rawBytes: bundle.bytes.byteLength,
		gzipBytes: gzipSync(bundle.bytes, {
			level: 9,
			strategy: zlibConstants.Z_DEFAULT_STRATEGY
		}).byteLength,
		inputModules: bundle.inputModules
	};
}

function makeCheck(id, actual, limit) {
	return {
		id,
		actual: round(actual, Number.isInteger(actual) ? 0 : 6),
		limit,
		operator: '<=',
		passed: actual <= limit
	};
}

export async function runBundleSizeBenchmark() {
	const [budgets, packageManifest] = await Promise.all([
		readFile(resolve(benchmarkDirectory, 'budgets.json'), 'utf8').then(JSON.parse),
		readFile(resolve(projectRoot, 'package.json'), 'utf8').then(JSON.parse)
	]);
	const entries = {
		light: "export { createLightRenderer } from './dist/light.js';",
		tiptap: "export { Editor } from '@tiptap/core';"
	};
	const [light, repeatedLight, tiptap, repeatedTiptap] = await Promise.all([
		bundleEntry('tiptap-static-light', entries.light),
		bundleEntry('tiptap-static-light-repeat', entries.light),
		bundleEntry('tiptap-editor', entries.tiptap),
		bundleEntry('tiptap-editor-repeat', entries.tiptap)
	]);
	if (
		Buffer.compare(light.bytes, repeatedLight.bytes) !== 0 ||
		Buffer.compare(tiptap.bytes, repeatedTiptap.bytes) !== 0
	) {
		throw new Error('Repeated esbuild output was not byte-for-byte deterministic.');
	}

	const lightSize = summarizeBundle(light);
	const tiptapSize = summarizeBundle(tiptap);
	const rawRatio = lightSize.rawBytes / tiptapSize.rawBytes;
	const gzipRatio = lightSize.gzipBytes / tiptapSize.gzipBytes;
	const configured = budgets.bundleSize;
	const checks = [
		makeCheck('bundle.light.raw.max', lightSize.rawBytes, configured.maxLightRawBytes),
		makeCheck('bundle.light.gzip.max', lightSize.gzipBytes, configured.maxLightGzipBytes),
		makeCheck(
			'bundle.light-to-tiptap.raw-ratio.max',
			rawRatio,
			configured.maxLightToTiptapRawRatio
		),
		makeCheck(
			'bundle.light-to-tiptap.gzip-ratio.max',
			gzipRatio,
			configured.maxLightToTiptapGzipRatio
		)
	];

	return {
		schemaVersion: 1,
		benchmark: 'bundle-size',
		generatedAt: new Date().toISOString(),
		environment: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			ci: process.env.CI === 'true'
		},
		tool: {
			name: 'esbuild',
			version: esbuildVersion,
			options: {
				platform: buildOptions.platform,
				format: buildOptions.format,
				target: buildOptions.target,
				minify: buildOptions.minify,
				treeShaking: buildOptions.treeShaking,
				external: []
			},
			compression: { name: 'gzip', level: 9 },
			deterministicRepeat: true
		},
		inputs: {
			light: {
				specifier: './dist/light.js',
				export: 'createLightRenderer',
				packageVersion: packageManifest.version
			},
			tiptap: {
				specifier: '@tiptap/core',
				export: 'Editor',
				packageVersion: packageManifest.devDependencies['@tiptap/core']
			}
		},
		bundles: {
			tiptapStaticLight: lightSize,
			tiptapEditor: tiptapSize
		},
		comparison: {
			rawRatio: round(rawRatio, 6),
			gzipRatio: round(gzipRatio, 6),
			rawSavingsPercent: round((1 - rawRatio) * 100, 2),
			gzipSavingsPercent: round((1 - gzipRatio) * 100, 2)
		},
		checks,
		passed: checks.every((check) => check.passed)
	};
}

export function renderBundleSizeMarkdown(result) {
	const status = result.passed ? 'PASS' : 'FAIL';
	return [
		'## Browser bundle size',
		'',
		'Both public APIs are bundled independently with the same minified browser ESM esbuild configuration. No dependency is externalized.',
		'',
		'| Bundle | Minified | gzip | Input modules |',
		'| --- | ---: | ---: | ---: |',
		`| Tiptap Editor | ${formatBytes(result.bundles.tiptapEditor.rawBytes)} | ${formatBytes(result.bundles.tiptapEditor.gzipBytes)} | ${result.bundles.tiptapEditor.inputModules} |`,
		`| tiptap-static/light | ${formatBytes(result.bundles.tiptapStaticLight.rawBytes)} | ${formatBytes(result.bundles.tiptapStaticLight.gzipBytes)} | ${result.bundles.tiptapStaticLight.inputModules} |`,
		'',
		`Light/Tiptap ratio: **${(result.comparison.rawRatio * 100).toFixed(2)}% minified**, **${(result.comparison.gzipRatio * 100).toFixed(2)}% gzip** — **${status}**`,
		''
	].join('\n');
}

async function main() {
	const result = await runBundleSizeBenchmark();
	console.log(renderBundleSizeMarkdown(result));
	if (!result.passed) process.exitCode = 1;
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === executedPath) await main();
