# tiptap-static

Render read-only Tiptap HTML without creating an `Editor` or a ProseMirror schema. The library accepts the existing extension objects produced by `Node.create()`, `.extend()`, and `.configure()` through structural inspection; it has no runtime dependency on `@tiptap/core` or `@tiptap/pm`.

The full entry point performs three jobs:

1. Inspect `parseHTML`, `addAttributes`, `addGlobalAttributes`, `renderHTML`, and `addNodeView` on the supplied extensions with Tiptap-compatible parent binding.
2. Sanitize the stored HTML, deriving simple custom tags and rendered attribute names from those extensions.
3. Replace matching elements with static NodeViews and recursively move their original content into `contentDOM`.

There are no `/svelte`, `/react`, or `/vue` entry points. Framework integration stays in the existing Tiptap adapter library and is exposed to this package through one versioned NodeView hook.

| Import | Purpose | Loaded module graph |
| --- | --- | --- |
| `tiptap-static/protocol` | Attach or inspect static NodeView hooks | None |
| `tiptap-static/light` | Enhance trusted HTML with static NodeViews | No sanitizer, Tiptap, or ProseMirror |
| `tiptap-static` | Sanitize and enhance untrusted/stored HTML | Includes `sanitize-html` |

These are import/bundle boundaries. Because npm installs dependencies per package, `sanitize-html` is still installed with `tiptap-static`, but it is not loaded into `/protocol` or `/light` consumers.

The Svelte, React, and Vue adapters used by the integration suite are dev-only fixtures; the emitted runtime does not import them.

## Usage

```ts
import { createStaticRenderer } from 'tiptap-static';
import Card from './extensions/card';
import Collapsable from './extensions/collapsable';
import File from './extensions/file';

const readOnly = createStaticRenderer({
  extensions: [Card.configure({ upload: 'board' }), Collapsable, File],
  sanitize: {
    // Active content is never inferred automatically.
    allowedTags: ['embed'],
    allowedAttributes: {
      embed: ['src', 'type', 'width', 'height']
    },
    attributeValidators: {
      'tiptap-card': {
        background: value =>
          value.startsWith('#') || value.startsWith('linear-gradient(')
      }
    }
  }
});

const session = readOnly.mount(element, storedHTML);

// Sanitizes again, destroys the old NodeViews, and mounts the new tree.
session.update(nextHTML);

// Destroys NodeViews from child to parent and restores sanitized static HTML.
session.destroy();
```

`enhance(element)` is available when the element already contains trusted, sanitized HTML. `sanitize(html)` can also be used independently during SSR; DOM enhancement only runs in the browser.

## Light runtime

Use the light entry when HTML was already sanitized at a trusted boundary:

```ts
import { createLightRenderer } from 'tiptap-static/light';

const readOnly = createLightRenderer({
  extensions: [Card, Collapsable, File],
  nodeViewRuntimes: [frameworkStaticRuntime]
});

const session = readOnly.mount(element, trustedSanitizedHTML);
session.update(nextTrustedSanitizedHTML);
```

`createLightRenderer` never sanitizes `mount()` or `session.update()` input. Do not pass user-controlled or merely stored HTML to it unless the content was sanitized elsewhere. It disables raw NodeView fallback by default; set `rawNodeViews: true` only for a deliberate compatibility migration.

Both renderers use the same enhancement engine. A new full or light session takes ownership of its target from the previous session, and `destroy()` restores the original enhanced nodes rather than recreating them with `innerHTML`.

## Existing NodeViews

The current `svelte-tiptap@2.2.0` `SvelteNodeViewRenderer` works through the full renderer's read-only compatibility facade. This path is covered by an integration test using its real `NodeViewWrapper` and `NodeViewContent` components.

Compatibility fallback supplies the subset commonly read by NodeViews:

- `editor.options.editable === false`, `isEditable`, `state.selection`, `on`, and `off`
- read-only command and chain proxies
- `extensionManager.attributes` and `extensionStorage`
- `node.attrs`, `textContent`, `type.spec`, `isLeaf`, `isAtom`, and `content`
- `view`, `getPos`, decorations, and rendered `HTMLAttributes`

It is deliberately not a fake ProseMirror editor. A NodeView that dispatches transactions or requires a real schema/view is left as sanitized source HTML when mounting fails. Set `rawNodeViews: false` to allow only the lightweight hook. The light entry already uses that setting by default.

## Adapter hook for Svelte, React, and Vue

Adapter libraries can attach a lightweight mount implementation directly to the renderer returned by their existing `NodeViewRenderer` function:

```ts
import { setStaticNodeViewHook } from 'tiptap-static/protocol';

function FrameworkNodeViewRenderer(component) {
  const renderer = props => createEditorNodeView(component, props);

  return setStaticNodeViewHook(renderer, props => {
    const mounted = mountFrameworkComponent(component, props);

    return {
      dom: mounted.dom,
      contentDOM: mounted.contentDOM,
      destroy: mounted.destroy
    };
  });
}
```

The underlying identity is `Symbol.for('@tiptap-static/node-view-renderer/v1')`, so duplicate package installations still agree on the hook. A hook always wins over raw fallback; a failed hook is not retried as a raw NodeView because that could mount a component twice.

The hook returns the same framework-neutral DOM lifecycle for Svelte, React, and Vue. The adapter remains responsible for its own `mount`/`unmount`, React root, or Vue app lifecycle.

When the extension declaration must stay separate from the framework runtime, attach an opaque descriptor instead:

```ts
import { setStaticNodeViewRuntime } from 'tiptap-static/protocol';

export const FRAMEWORK_STATIC_RUNTIME = Symbol.for(
  'framework-adapter/static-node-view-runtime/v1'
);

function FrameworkNodeViewRenderer(component, options) {
  const editorRenderer = props => createEditorNodeView(component, props, options);

  return setStaticNodeViewRuntime(
    editorRenderer,
    FRAMEWORK_STATIC_RUNTIME,
    { component, options }
  );
}

export const frameworkStaticRuntime = {
  key: FRAMEWORK_STATIC_RUNTIME,
  mount({ value, props }) {
    const mounted = mountFrameworkComponent(value.component, props, value.options);
    return {
      dom: mounted.dom,
      contentDOM: mounted.contentDOM,
      destroy: mounted.destroy
    };
  }
};
```

Pass `frameworkStaticRuntime` through `nodeViewRuntimes`. A descriptor always wins over raw fallback. A missing or failing runtime preserves the source element and emits a diagnostic; the editor renderer is never retried, preventing a double mount. Runtime keys belong to adapter packages and should use `Symbol.for(...)` with a versioned adapter-specific name.

Static props include `selected: false` plus no-op `updateAttributes()` and `deleteNode()`, matching the read-only subset shared by the Svelte, React, and Vue NodeView component contracts.

## Sanitizer policy

Automatic inference is intentionally conservative:

- Simple selectors such as `tiptap-card` and `pre[data-kind]` contribute their tag. Selector-required attributes, classes, and IDs still need explicit narrow sanitizer rules.
- `rendered !== false` attributes contribute their serialized name. Attribute-level `renderHTML` is probed once to discover mappings such as `study` to `data-study`.
- Global attributes are applied to the target extension's parsed tags.
- Complex selectors, style-only rules, and ProseMirror-context rules emit diagnostics and require explicit sanitizer configuration.
- `script`, `style`, `on*`, and `srcdoc` are denied. Protocol-relative URLs are denied by default.
- `iframe`, `embed`, and `object` require explicit opt-in. Define hostname and custom value validators as appropriate.
- Inline `style` is not inferred. Use narrow `allowedStyles` rules if it is genuinely needed.

Attribute names are not value policies. If a component interprets an opaque attribute such as `background`, `data-url`, or an embed identifier as CSS or a URL, validate it with `attributeValidators`.

## What “no Tiptap dependency” means

The `/protocol` output has no runtime imports. The transitive `/light` output excludes `sanitize-html`, Tiptap, and ProseMirror. Only the full root entry loads the sanitizer. Passing an already-created extension object does not make this library load Tiptap.

However, importing today's application extension module may itself load `@tiptap/core`, ProseMirror, syntax highlighters, and its framework adapter before the object reaches this library. For the smallest read-only chunk, the producer modules must also have a light path: adapter libraries can implement the static hook without runtime editor imports, and heavy editor-only options/plugins should be moved behind the dynamically imported editor boundary.

The raw compatibility fallback proves that existing objects are usable. It cannot retroactively remove modules that the application already imported to create those objects.

## Verified behavior

The test suite covers:

- real Tiptap 2.27.2 `Node.create().extend().configure()` objects
- inherited fields, defaults, global attributes, rule priorities, and duplicate detection
- nested NodeViews and child-first destruction
- CodeBlock's `pre > code > 0` serialization hole
- the real `svelte-tiptap@2.2.0` renderer compatibility fallback
- the same extension objects rendered through real Tiptap `Editor`/`EditorContent` and `/light`, comparing Svelte, React, and Vue component output without invoking the raw editor renderer in light mode
- the upstream svelte-tiptap leaf/atom and editable-content shapes, plus empty containers, siblings, ordinary framework child components, and recursively nested NodeViews
- real `svelte-tiptap`, `@tiptap/react`, and `@tiptap/vue-3` Wrapper/Content components through `/light`, including reactive updates and framework unmount lifecycle
- direct-hook and descriptor-runtime precedence, hook-only mode, and lifecycle cleanup
- sanitizer-free light input, full-renderer sanitization, and atomic failed updates
- original DOM node/listener restoration after enhancement
- active content, URL schemes, event attributes, mapped attributes, and custom validators
- emitted `/protocol` and `/light` dependency-graph boundaries

## Tiptap comparison benchmarks

Run the complete comparison locally with:

```sh
pnpm benchmark
```

The command builds the package, writes reports under the ignored `benchmark-results/` directory, and fails when a budget in `benchmark/budgets.json` is exceeded. `pnpm benchmark:render` and `pnpm benchmark:size` run the individual comparisons.

The render benchmark gives the real Tiptap `Editor` and `createLightRenderer()` the same extension objects and the same nested HTML. It validates the mounted NodeView count first, warms both paths, alternates their execution order, and records 25 samples of six synchronous mounts. Component creation, DOM validation, and teardown happen identically around both paths; only synchronous mount is timed. The CI gate uses the paired median Tiptap/light ratio rather than an absolute millisecond limit, because shared-runner hardware changes absolute timings.

The bundle benchmark uses the same pinned esbuild configuration for both browser ESM entry points:

- `tiptap-static/light` exporting `createLightRenderer`
- `@tiptap/core` exporting `Editor`

It minifies the complete dependency graphs without externals, repeats each build to prove byte-for-byte determinism, and compares raw and gzip sizes. Framework code and application extensions are excluded from both bundles, so the result isolates the runtime choice and gives Tiptap the conservative baseline.

GitHub Actions runs type checks, all tests, package validation, render performance, and bundle-size budgets on Node 22. Each comparison run is written to the Job Summary and retained as a `benchmark-results` artifact containing JSON and Markdown reports.

Run `pnpm test`, `pnpm check`, `pnpm pack:check`, and `pnpm benchmark` before publishing.
