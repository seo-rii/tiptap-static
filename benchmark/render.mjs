import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(benchmarkDirectory, '..');

function installDOM() {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		pretendToBeVisual: true,
		url: 'https://benchmark.invalid/'
	});
	const { window } = dom;
	const values = {
		window,
		document: window.document,
		navigator: window.navigator,
		Node: window.Node,
		Element: window.Element,
		HTMLElement: window.HTMLElement,
		Text: window.Text,
		DocumentFragment: window.DocumentFragment,
		DOMParser: window.DOMParser,
		DOMRect: window.DOMRect,
		MutationObserver: window.MutationObserver,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		KeyboardEvent: window.KeyboardEvent,
		MouseEvent: window.MouseEvent,
		getComputedStyle: window.getComputedStyle.bind(window),
		getSelection: window.getSelection.bind(window),
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
	};

	for (const [name, value] of Object.entries(values)) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value
		});
	}

	return dom;
}

function percentile(values, fraction) {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
	return sorted[index];
}

function round(value, digits = 3) {
	return Number(value.toFixed(digits));
}

function summarize(samples) {
	const medianMs = percentile(samples, 0.5);
	return {
		p25Ms: round(percentile(samples, 0.25)),
		medianMs: round(medianMs),
		p75Ms: round(percentile(samples, 0.75)),
		p95Ms: round(percentile(samples, 0.95)),
		minMs: round(Math.min(...samples)),
		maxMs: round(Math.max(...samples)),
		operationsPerSecond: round(1000 / medianMs, 1)
	};
}

function readPositiveInteger(name, fallback) {
	const configured = process.env[name];
	if (configured === undefined) return fallback;
	const value = Number(configured);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return value;
}

function makeHTML(outerCards) {
	return Array.from(
		{ length: outerCards },
		(_, index) =>
			`<benchmark-card title="outer-${index}"><p>before ${index}</p><benchmark-card title="inner-${index}"><p>inside ${index}</p></benchmark-card><p>after ${index}</p></benchmark-card>`
	).join('');
}

function createNodeViewDOM(props) {
	const dom = document.createElement('article');
	dom.dataset.benchmarkNodeView = '';
	dom.dataset.title = String(props.node.attrs.title ?? '');
	const label = document.createElement('strong');
	label.textContent = String(props.node.attrs.title ?? '');
	const contentDOM = document.createElement('section');
	contentDOM.dataset.benchmarkContent = '';
	dom.append(label, contentDOM);
	return { dom, contentDOM };
}

function measureBatch(createRender, batchSize, expectedNodeViews) {
	let elapsed = 0;
	for (let index = 0; index < batchSize; index += 1) {
		const start = performance.now();
		const rendered = createRender();
		elapsed += performance.now() - start;
		const nodeViewCount = rendered.target.querySelectorAll(
			'[data-benchmark-node-view]'
		).length;
		if (nodeViewCount !== expectedNodeViews) {
			rendered.destroy();
			throw new Error(
				`Expected ${expectedNodeViews} NodeViews, received ${nodeViewCount}.`
			);
		}
		rendered.destroy();
	}
	return elapsed / batchSize;
}

export async function runRenderBenchmark() {
	const dom = installDOM();
	try {
		const [{ Editor, Node }, { createLightRenderer }, { setStaticNodeViewHook }] =
			await Promise.all([
				import('@tiptap/core'),
				import('../dist/light.js'),
				import('../dist/protocol.js')
			]);
		const [budgets, packageManifest] = await Promise.all([
			readFile(resolve(benchmarkDirectory, 'budgets.json'), 'utf8').then(JSON.parse),
			readFile(resolve(projectRoot, 'package.json'), 'utf8').then(JSON.parse)
		]);
		const outerCards = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_OUTER_CARDS',
			budgets.render.outerCards
		);
		const warmupIterations = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_WARMUP',
			budgets.render.warmupIterations
		);
		const sampleCount = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_SAMPLES',
			budgets.render.samples
		);
		const batchSize = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_BATCH',
			budgets.render.batchSize
		);
		const html = makeHTML(outerCards);
		const expectedNodeViews = outerCards * 2;
		let rawRendererCalls = 0;
		let staticHookCalls = 0;

		const TestDocument = Node.create({
			name: 'doc',
			topNode: true,
			content: 'block*'
		});
		const TestText = Node.create({
			name: 'text',
			group: 'inline'
		});
		const TestParagraph = Node.create({
			name: 'paragraph',
			group: 'block',
			content: 'inline*',
			parseHTML() {
				return [{ tag: 'p' }];
			},
			renderHTML() {
				return ['p', 0];
			}
		});
		const BenchmarkCard = Node.create({
			name: 'benchmarkCard',
			group: 'block',
			content: 'block*',
			addAttributes() {
				return { title: { default: '' } };
			},
			parseHTML() {
				return [{ tag: 'benchmark-card' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['benchmark-card', HTMLAttributes, 0];
			},
			addNodeView() {
				const editorRenderer = (props) => {
					rawRendererCalls += 1;
					return createNodeViewDOM(props);
				};
				return setStaticNodeViewHook(editorRenderer, (props) => {
					staticHookCalls += 1;
					return createNodeViewDOM(props);
				});
			}
		});
		const extensions = [TestDocument, TestText, TestParagraph, BenchmarkCard];
		const lightRenderer = createLightRenderer({ extensions });

		const renderTiptap = () => {
			const target = document.createElement('div');
			const editor = new Editor({
				element: target,
				extensions,
				content: html,
				editable: false,
				injectCSS: false
			});
			return {
				target,
				destroy() {
					editor.destroy();
					target.remove();
				}
			};
		};
		const renderStatic = () => {
			const target = document.createElement('div');
			const session = lightRenderer.mount(target, html);
			return {
				target,
				destroy() {
					session.destroy();
					target.remove();
				}
			};
		};

		const rawCallsBeforeStaticProbe = rawRendererCalls;
		measureBatch(renderStatic, 1, expectedNodeViews);
		if (rawRendererCalls !== rawCallsBeforeStaticProbe || staticHookCalls === 0) {
			throw new Error('The light benchmark did not stay on the static NodeView hook.');
		}
		const rawCallsBeforeTiptapProbe = rawRendererCalls;
		measureBatch(renderTiptap, 1, expectedNodeViews);
		if (rawRendererCalls <= rawCallsBeforeTiptapProbe) {
			throw new Error('The Tiptap benchmark did not invoke the editor NodeView renderer.');
		}

		for (let index = 0; index < warmupIterations; index += 1) {
			if (index % 2 === 0) {
				measureBatch(renderTiptap, 1, expectedNodeViews);
				measureBatch(renderStatic, 1, expectedNodeViews);
			} else {
				measureBatch(renderStatic, 1, expectedNodeViews);
				measureBatch(renderTiptap, 1, expectedNodeViews);
			}
		}

		const tiptapSamples = [];
		const staticSamples = [];
		for (let sample = 0; sample < sampleCount; sample += 1) {
			if (sample % 2 === 0) {
				tiptapSamples.push(measureBatch(renderTiptap, batchSize, expectedNodeViews));
				staticSamples.push(measureBatch(renderStatic, batchSize, expectedNodeViews));
			} else {
				staticSamples.push(measureBatch(renderStatic, batchSize, expectedNodeViews));
				tiptapSamples.push(measureBatch(renderTiptap, batchSize, expectedNodeViews));
			}
		}

		const tiptap = summarize(tiptapSamples);
		const light = summarize(staticSamples);
		const tiptapToStaticMedianRatio = tiptap.medianMs / light.medianMs;
		const pairedRatios = tiptapSamples.map(
			(tiptapSample, index) => tiptapSample / staticSamples[index]
		);
		const pairedMedianRatio = percentile(pairedRatios, 0.5);
		const minimumRatio = budgets.render.minTiptapToStaticMedianRatio;
		const check = {
			id: 'render.paired-median-ratio.min',
			actual: round(pairedMedianRatio, 4),
			limit: minimumRatio,
			operator: '>=',
			passed: pairedMedianRatio >= minimumRatio
		};
		const result = {
			schemaVersion: 1,
			benchmark: 'render-performance',
			generatedAt: new Date().toISOString(),
			environment: {
				node: process.version,
				platform: process.platform,
				arch: process.arch,
				cpu: cpus()[0]?.model ?? 'unknown',
				ci: process.env.CI === 'true'
			},
			versions: {
				tiptapStatic: packageManifest.version,
				tiptapCore: packageManifest.devDependencies['@tiptap/core'],
				jsdom: packageManifest.devDependencies.jsdom
			},
			methodology: {
				measuredPhase: 'synchronous mount; destroy runs after each timed operation',
				alternatingOrder: true,
				lightRendererPreparedOnce: true,
				tiptapEditorCreatedPerRender: true,
				sameExtensionObject: true,
				sameHTML: true
			},
			workload: {
				outerCards,
				nodeViews: expectedNodeViews,
				htmlBytes: Buffer.byteLength(html),
				warmupIterations,
				samples: sampleCount,
				batchSize
			},
			results: {
				tiptapEditor: tiptap,
				tiptapStaticLight: light
			},
			comparison: {
				tiptapToStaticMedianRatio: round(tiptapToStaticMedianRatio, 4),
				pairedMedianRatio: round(pairedMedianRatio, 4),
				pairedP25Ratio: round(percentile(pairedRatios, 0.25), 4),
				pairedP75Ratio: round(percentile(pairedRatios, 0.75), 4),
				staticSavingsPercent: round((1 - 1 / pairedMedianRatio) * 100, 2)
			},
			checks: [check],
			passed: check.passed
		};

		return result;
	} finally {
		dom.window.close();
	}
}

export function renderPerformanceMarkdown(result) {
	const status = result.passed ? 'PASS' : 'FAIL';
	return [
		'## Render performance',
		'',
		'Identical nested HTML and the same extension object are rendered in jsdom. Timings cover synchronous mount only; teardown happens after every sample.',
		'',
		'| Renderer | Median | p95 | Operations/s |',
		'| --- | ---: | ---: | ---: |',
		`| Tiptap Editor | ${result.results.tiptapEditor.medianMs} ms | ${result.results.tiptapEditor.p95Ms} ms | ${result.results.tiptapEditor.operationsPerSecond} |`,
		`| tiptap-static/light | ${result.results.tiptapStaticLight.medianMs} ms | ${result.results.tiptapStaticLight.p95Ms} ms | ${result.results.tiptapStaticLight.operationsPerSecond} |`,
		'',
		`Paired Tiptap/static median ratio: **${result.comparison.pairedMedianRatio}×** (budget ≥ ${result.checks[0].limit}×) — **${status}**`,
		''
	].join('\n');
}

async function main() {
	const result = await runRenderBenchmark();
	console.log(renderPerformanceMarkdown(result));
	if (!result.passed) process.exitCode = 1;
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === executedPath) await main();
