# doxymark

A tool for helping C and C++ projects modernize their documentation. `doxymark` takes the XML output that [Doxygen](https://www.doxygen.nl/) already produces and turns it into a tree of Markdown or MDX pages, plus a searchable symbol index (`api-index.json`), ready to drop into a modern documentation site.

It sits in the same neighbourhood as [Moxygen](https://github.com/sourcey/moxygen) and [Doxybook2](https://github.com/matusnovak/doxybook2), but is specifically built with [Fumadocs](https://fumadocs.vercel.app/) in mind — the default MDX preset emits rich, React-backed components (`<ApiLink>`, `<ApiTabs>`, `<Callout>`, and others) that feel native in a Fumadocs site. A plain Markdown preset ships alongside it for any other static-site generator.

## What it does

Point it at a directory of Doxygen-generated XML and it produces a tree of `.md` or `.mdx` files — one per header, struct, class, namespace, or group — with cross-references resolved, source links optional, and a preset system so the output shape matches the documentation site you're building.

Two presets ship by default:

- **`markdown`** — plain Markdown suitable for static-site generators like MkDocs, Docusaurus, or Hugo.
- **`fumadocs`** — MDX with [Fumadocs](https://fumadocs.vercel.app/) components (`<ApiLink>`, `<ApiTabs>`, `<Callout>`, and others) for a rich, React-based API reference site.

The template layer is pluggable — if neither preset fits, `--generate-templates` dumps a scaffold you can customise against the `TemplateSet` interface.

## Quick start

Requires Node.js 18.17 or newer.

```bash
# Generate Doxygen XML first (in your C/C++ project's Doxyfile set GENERATE_XML = YES and EXTRACT_ALL = YES)
doxygen

# Then run doxymark against the XML directory
npx doxymark --input path/to/doxygen/xml --output docs/api --preset fumadocs
```

## CLI flags

| Flag | Description |
|------|-------------|
| `--input, -i <dir>` | Doxygen XML output directory (required) |
| `--output, -o <dir>` | Output directory for generated files |
| `--index <file>` | Path to write `api-index.json` |
| `--preset <name>` | Template preset: `markdown` (default) or `fumadocs` |
| `--auto-group` | Group getter/setter functions into tabs or subheadings |
| `--source-url <base>` | Base URL for source code links; enables per-symbol source links |
| `--root-intro <file>` | Content to insert at the top of the root index page |
| `--dump-ir <file>` | Dump the parsed intermediate representation as JSON |
| `--validate` | Check for unresolved cross-references |
| `--verbose, -v` | Detailed logging |
| `--dry-run` | Preview without writing files |
| `--generate-templates <dir>` | Dump default templates for customization |
| `--help, -h` | Show help |

## Building from source

```bash
npm install
npm run build   # compiles TypeScript to dist/
npm test        # runs the vitest suite
```

## Inspired by

`doxymark` follows a path first cut by earlier tools in this space. It owes a lot to:

- **[Moxygen](https://github.com/sourcey/moxygen)** — for showing that Doxygen XML → Markdown could be a short, focused pipeline.
- **[Doxybook](https://github.com/matusnovak/doxybook)** and **[Doxybook2](https://github.com/matusnovak/doxybook2)** — for demonstrating a richer, templated approach and a multi-preset architecture.

Where doxymark differs is its focus on MDX, its first-class Fumadocs preset, and a cross-reference analyzer that wires up `<ApiLink>`, `<TypeUsedBy>`, and related components without any post-processing on the site side.

## License

MIT — see [LICENSE](./LICENSE).
