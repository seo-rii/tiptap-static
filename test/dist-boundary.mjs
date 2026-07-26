import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(packageRoot, 'dist');

async function collectGraph(entry) {
	const pending = [resolve(distRoot, entry)];
	const modules = new Map();
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || modules.has(file)) continue;
		const source = await readFile(file, 'utf8');
		modules.set(file, source);

		const specifiers = new Set();
		for (const pattern of [
			/\b(?:from|import\s*\()\s*['"](\.[^'"]+)['"]/g,
			/\bimport\s*['"](\.[^'"]+)['"]/g
		]) {
			for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
		}
		for (const specifier of specifiers) pending.push(resolve(dirname(file), specifier));
	}
	return modules;
}

test('protocol entry has no runtime imports and works without DOM globals', async () => {
	const graph = await collectGraph('protocol.js');
	assert.equal(graph.size, 1);
	const protocol = await import(pathToFileURL(resolve(distRoot, 'protocol.js')).href);
	const renderer = () => undefined;
	const value = { component: 'fixture' };
	protocol.setStaticNodeViewRuntime(renderer, Symbol.for('fixture/runtime/v1'), value);
	assert.equal(protocol.getStaticNodeViewHook(renderer).value, value);
});

test('light entry transitively excludes sanitizer, Tiptap, and ProseMirror', async () => {
	const graph = await collectGraph('light.js');
	const source = [...graph.values()].join('\n');
	assert.doesNotMatch(source, /sanitize-html|@tiptap\/|(?:^|['"])prosemirror-/m);
	assert.ok(![...graph.keys()].some((file) => file.endsWith('/sanitize.js')));
	await import(pathToFileURL(resolve(distRoot, 'light.js')).href);
});

test('hydrate entry is standalone and imports without DOM globals', async () => {
	const graph = await collectGraph('hydrate.js');
	const source = [...graph.values()].join('\n');
	assert.equal(graph.size, 1);
	assert.doesNotMatch(
		source,
		/sanitize-html|@tiptap\/|(?:^|['"])prosemirror-|\.\/engine\.js|\.\/extensions\.js/m
	);
	const hydrate = await import(pathToFileURL(resolve(distRoot, 'hydrate.js')).href);
	assert.equal(typeof hydrate.createHydrator, 'function');
	assert.equal(typeof hydrate.defineStaticNode, 'function');
});

test('sanitize entry excludes the NodeView engine and works without DOM globals', async () => {
	const graph = await collectGraph('sanitize.js');
	const source = [...graph.values()].join('\n');
	assert.doesNotMatch(source, /@tiptap\/|(?:^|['"])prosemirror-/m);
	assert.ok(![...graph.keys()].some((file) => file.endsWith('/engine.js')));
	const sanitize = await import(pathToFileURL(resolve(distRoot, 'sanitize.js')).href);
	assert.equal(sanitize.sanitizeTiptapHTML('<p onclick="x()">safe</p>', []), '<p>safe</p>');
});

test('root and protocol entries expose identical protocol bindings', async () => {
	const [root, protocol] = await Promise.all([
		import(pathToFileURL(resolve(distRoot, 'index.js')).href),
		import(pathToFileURL(resolve(distRoot, 'protocol.js')).href)
	]);
	assert.equal(root.STATIC_NODE_VIEW, protocol.STATIC_NODE_VIEW);
	assert.equal(root.createStaticNodeViewHook, protocol.createStaticNodeViewHook);
	assert.equal(root.createStaticNodeViewRuntimeHook, protocol.createStaticNodeViewRuntimeHook);
	assert.equal(root.setStaticNodeViewHook, protocol.setStaticNodeViewHook);
	assert.equal(root.setStaticNodeViewRuntime, protocol.setStaticNodeViewRuntime);
});

test('package exports point at every emitted subpath declaration', async () => {
	const packageJSON = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
	assert.deepEqual(packageJSON.exports['./light'], {
		types: './dist/light.d.ts',
		import: './dist/light.js',
		default: './dist/light.js'
	});
	assert.deepEqual(packageJSON.exports['./protocol'], {
		types: './dist/protocol.d.ts',
		import: './dist/protocol.js',
		default: './dist/protocol.js'
	});
	assert.deepEqual(packageJSON.exports['./hydrate'], {
		types: './dist/hydrate.d.ts',
		import: './dist/hydrate.js',
		default: './dist/hydrate.js'
	});
	assert.deepEqual(packageJSON.exports['./sanitize'], {
		types: './dist/sanitize.d.ts',
		import: './dist/sanitize.js',
		default: './dist/sanitize.js'
	});
});

test('published source maps embed every referenced source', async () => {
	const mapFiles = (await readdir(distRoot)).filter((file) => file.endsWith('.map'));
	assert.ok(mapFiles.length > 0);

	for (const file of mapFiles) {
		const map = JSON.parse(await readFile(resolve(distRoot, file), 'utf8'));
		assert.equal(map.sourcesContent?.length, map.sources.length, `${file} sourcesContent`);
		assert.ok(map.sourcesContent.every((source) => typeof source === 'string'), file);
	}
});
