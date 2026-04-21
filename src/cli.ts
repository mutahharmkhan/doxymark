#!/usr/bin/env node

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./parser/index.js";
import { validateRefs } from "./parser/symbol-index.js";
import { render } from "./renderer/renderer.js";
import { markdownTemplates } from "./renderer/templates/markdown.js";
import { fumadocsPreset } from "./renderer/presets/fumadocs.js";
import type { TemplateSet } from "./renderer/types.js";

interface CliOptions {
  input: string;
  output?: string;
  index?: string;
  preset: string;
  dumpIr?: string;
  validate: boolean;
  verbose: boolean;
  dryRun: boolean;
  autoGroup: boolean;
  sourceUrl?: string;
  rootIntro?: string;
  generateTemplates?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    input: "",
    preset: "markdown",
    validate: false,
    verbose: false,
    dryRun: false,
    autoGroup: false,
  };

  function nextArg(flag: string): string {
    const val = args[++i];
    if (val === undefined || val.startsWith("-")) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(1);
    }
    return val;
  }

  let i: number;
  for (i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--input":
      case "-i":
        options.input = nextArg(arg);
        break;
      case "--output":
      case "-o":
        options.output = nextArg(arg);
        break;
      case "--index":
        options.index = nextArg(arg);
        break;
      case "--preset":
        options.preset = nextArg(arg);
        break;
      case "--dump-ir":
        options.dumpIr = nextArg(arg);
        break;
      case "--validate":
        options.validate = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--auto-group":
        options.autoGroup = true;
        break;
      case "--source-url":
        options.sourceUrl = nextArg(arg);
        break;
      case "--root-intro":
        options.rootIntro = nextArg(arg);
        break;
      case "--generate-templates":
        options.generateTemplates = nextArg(arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
doxymark — Convert Doxygen XML to Markdown/MDX

Usage:
  doxymark --input <dir> --output <dir> [options]

Options:
  --input, -i <dir>           Doxygen XML output directory (required)
  --output, -o <dir>          Output directory for markdown files
  --index <file>              Path to write api-index.json
  --preset <name>             Template preset: markdown (default), fumadocs
  --dump-ir <file>            Dump parsed IR to JSON file
  --validate                  Check for unresolved cross-references
  --verbose, -v               Detailed logging
  --auto-group                Group getter/setter functions in tabs
  --source-url <base>         Base URL for source code links (e.g., https://github.com/lvgl/lvgl/blob/master/src)
  --root-intro <file>         MDX file whose content is inserted at top of root index page
  --dry-run                   Preview without writing files
  --generate-templates <dir>  Dump default templates for customization
  --help, -h                  Show this help
`);
}

function getTemplateSet(preset: string): TemplateSet {
  switch (preset) {
    case "fumadocs":
      return fumadocsPreset;
    case "markdown":
    default:
      return markdownTemplates;
  }
}

function log(verbose: boolean, ...args: unknown[]): void {
  if (verbose) {
    console.log(...args);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // Handle --generate-templates early (doesn't require --input)
  if (options.generateTemplates) {
    generateTemplates(options.generateTemplates, options.dryRun);
    return;
  }

  if (!options.input) {
    console.error("Error: --input is required");
    printHelp();
    process.exit(1);
  }

  if (!existsSync(options.input)) {
    console.error(`Error: Input directory does not exist: ${options.input}`);
    process.exit(1);
  }

  if (!options.output && !options.dumpIr) {
    console.error("Error: At least one of --output or --dump-ir is required");
    process.exit(1);
  }

  // Parse
  log(options.verbose, "Parsing Doxygen XML from:", options.input);
  const parseResult = await parse(options.input);
  log(
    options.verbose,
    `Parsed ${parseResult.files.length} files, ${Object.keys(parseResult.index).length} symbols`,
  );

  // Display warnings
  if (parseResult.warnings.length > 0) {
    console.warn(`${parseResult.warnings.length} warnings during parsing`);
    if (options.verbose) {
      for (const warning of parseResult.warnings) {
        console.warn(`[warn] ${warning}`);
      }
    }
  }

  // Dump IR
  if (options.dumpIr) {
    if (options.dryRun) {
      console.log(`[dry-run] Would write IR to: ${options.dumpIr}`);
    } else {
      mkdirSync(dirname(options.dumpIr), { recursive: true });
      writeFileSync(options.dumpIr, JSON.stringify(parseResult, null, 2));
      log(options.verbose, "Wrote IR to:", options.dumpIr);
    }
  }

  // Validate
  if (options.validate) {
    const { unresolvedCount, unresolvedRefs } = validateRefs(parseResult.compounds);
    for (const ref of unresolvedRefs) {
      console.warn(`Unresolved ref: ${ref.name} (refid: ${ref.refid})`);
    }

    if (unresolvedCount > 0) {
      console.warn(`\n${unresolvedCount} unresolved references found`);
    } else {
      console.log("All cross-references resolved successfully");
    }

    if (parseResult.warnings.length > 0) {
      console.warn(`${parseResult.warnings.length} parser warnings`);
    }
  }

  // Render
  if (options.output) {
    const templates = getTemplateSet(options.preset);
    log(options.verbose, `Using preset: ${options.preset}`);

    let rootIntroContent: string | undefined;
    if (options.rootIntro) {
      if (!existsSync(options.rootIntro)) {
        console.error(`Error: Root intro file does not exist: ${options.rootIntro}`);
        process.exit(1);
      }
      rootIntroContent = readFileSync(options.rootIntro, "utf-8");
      log(options.verbose, "Using root intro from:", options.rootIntro);
    }

    const output = render(parseResult, templates, {
      autoGroupFunctions: options.autoGroup,
      sourceUrlBase: options.sourceUrl,
      rootIntroContent,
    });

    log(options.verbose, `Rendering ${output.files.length} files`);

    for (const file of output.files) {
      const filePath = join(options.output, file.path);
      if (options.dryRun) {
        console.log(`[dry-run] ${filePath}`);
      } else {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, file.content);
        log(options.verbose, `Wrote: ${filePath}`);
      }
    }

    if (!options.dryRun) {
      console.log(`Wrote ${output.files.length} files to ${options.output}`);
    }
  }

  // Write index
  if (options.index) {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const indexOutput = {
      meta: {
        generator: "doxymark",
        version: pkg.version as string,
        generatedAt: new Date().toISOString(),
        symbolCount: Object.keys(parseResult.index).length,
      },
      symbols: parseResult.index,
    };

    if (options.dryRun) {
      console.log(`[dry-run] Would write index to: ${options.index}`);
    } else {
      mkdirSync(dirname(options.index), { recursive: true });
      writeFileSync(options.index, JSON.stringify(indexOutput, null, 2));
      console.log(
        `Wrote api-index.json with ${Object.keys(parseResult.index).length} symbols to ${options.index}`,
      );
    }
  }
}

function generateTemplates(dir: string, dryRun: boolean): void {
  const templateContent = `// Custom template set for doxymark
// Modify these functions to customize the output format.
// See the default templates at src/renderer/templates/markdown.ts

import type { TemplateSet } from "doxymark";

export const customTemplates: Partial<TemplateSet> = {
  extension: ".md",

  // Override page wrapper
  // page(file, renderedSections) { ... },

  // Override class page rendering (receives RenderContext for symbol index access)
  // classPage(cls, renderedSections, ctx) { ... },

  // Override namespace page rendering (receives RenderContext for symbol index access)
  // namespacePage(ns, renderedSections, ctx) { ... },

  // Override group page rendering
  // groupPage(group, renderedSections, ctx) { ... },

  // Override documentation page rendering (for \\page / \\example)
  // docsPage(page) { ... },

  // Override function rendering
  // function(fn, ctx) { ... },

  // Override enum rendering
  // enum(en, ctx) { ... },

  // Override struct rendering
  // struct(st, ctx) { ... },

  // Override macro rendering
  // macro(mac, ctx) { ... },

  // Override typedef rendering
  // typedef(td, ctx) { ... },

  // Override variable rendering
  // variable(v, ctx) { ... },

  // Override friend rendering
  // friend(f, ctx) { ... },

  // Override symbol reference formatting
  // symbolRef(ref, displayText) { ... },

  // Override section headings
  // sectionHeading(title, level) { ... },

  // Override anchor rendering
  // anchor(id) { ... },
};
`;

  const filePath = join(dir, "templates.ts");
  if (dryRun) {
    console.log(`[dry-run] Would write template to: ${filePath}`);
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, templateContent);
    console.log(`Generated template file at: ${filePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
