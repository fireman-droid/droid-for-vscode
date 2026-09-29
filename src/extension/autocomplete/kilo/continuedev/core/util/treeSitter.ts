/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import fs from "node:fs"
import path from "path"

import { AsyncLocalStorage } from 'node:async_hooks';
import Parser from "web-tree-sitter"
type Language = Parser.Language
type SyntaxNode = Parser.SyntaxNode
type Query = Parser.Query
type Tree = Parser.Tree
import { getUriFileExtension } from "./uri"

export enum LanguageName {
  CPP = "cpp",
  C_SHARP = "c_sharp",
  C = "c",
  CSS = "css",
  PHP = "php",
  BASH = "bash",
  JSON = "json",
  TYPESCRIPT = "typescript",
  TSX = "tsx",
  ELM = "elm",
  JAVASCRIPT = "javascript",
  PYTHON = "python",
  ELISP = "elisp",
  ELIXIR = "elixir",
  GO = "go",
  EMBEDDED_TEMPLATE = "embedded_template",
  HTML = "html",
  JAVA = "java",
  LUA = "lua",
  OCAML = "ocaml",
  QL = "ql",
  RESCRIPT = "rescript",
  RUBY = "ruby",
  RUST = "rust",
  SYSTEMRDL = "systemrdl",
  TOML = "toml",
  SOLIDITY = "solidity",
}

const supportedLanguages: { [key: string]: LanguageName } = {
  cpp: LanguageName.CPP,
  hpp: LanguageName.CPP,
  cc: LanguageName.CPP,
  cxx: LanguageName.CPP,
  hxx: LanguageName.CPP,
  cp: LanguageName.CPP,
  hh: LanguageName.CPP,
  inc: LanguageName.CPP,
  // Depended on this PR: https://github.com/tree-sitter/tree-sitter-cpp/pull/173
  // ccm: LanguageName.CPP,
  // c++m: LanguageName.CPP,
  // cppm: LanguageName.CPP,
  // cxxm: LanguageName.CPP,
  cs: LanguageName.C_SHARP,
  c: LanguageName.C,
  h: LanguageName.C,
  css: LanguageName.CSS,
  php: LanguageName.PHP,
  phtml: LanguageName.PHP,
  php3: LanguageName.PHP,
  php4: LanguageName.PHP,
  php5: LanguageName.PHP,
  php7: LanguageName.PHP,
  phps: LanguageName.PHP,
  "php-s": LanguageName.PHP,
  bash: LanguageName.BASH,
  sh: LanguageName.BASH,
  json: LanguageName.JSON,
  ts: LanguageName.TYPESCRIPT,
  mts: LanguageName.TYPESCRIPT,
  cts: LanguageName.TYPESCRIPT,
  tsx: LanguageName.TSX,
  // vue: LanguageName.VUE,  // tree-sitter-vue parser is broken
  // The .wasm file being used is faulty, and yaml is split line-by-line anyway for the most part
  // yaml: LanguageName.YAML,
  // yml: LanguageName.YAML,
  elm: LanguageName.ELM,
  js: LanguageName.JAVASCRIPT,
  jsx: LanguageName.JAVASCRIPT,
  mjs: LanguageName.JAVASCRIPT,
  cjs: LanguageName.JAVASCRIPT,
  py: LanguageName.PYTHON,
  // ipynb: LanguageName.PYTHON, // It contains Python, but the file format is a ton of JSON.
  pyw: LanguageName.PYTHON,
  pyi: LanguageName.PYTHON,
  el: LanguageName.ELISP,
  emacs: LanguageName.ELISP,
  ex: LanguageName.ELIXIR,
  exs: LanguageName.ELIXIR,
  go: LanguageName.GO,
  eex: LanguageName.EMBEDDED_TEMPLATE,
  heex: LanguageName.EMBEDDED_TEMPLATE,
  leex: LanguageName.EMBEDDED_TEMPLATE,
  html: LanguageName.HTML,
  htm: LanguageName.HTML,
  java: LanguageName.JAVA,
  lua: LanguageName.LUA,
  luau: LanguageName.LUA,
  ocaml: LanguageName.OCAML,
  ml: LanguageName.OCAML,
  mli: LanguageName.OCAML,
  ql: LanguageName.QL,
  res: LanguageName.RESCRIPT,
  resi: LanguageName.RESCRIPT,
  rb: LanguageName.RUBY,
  erb: LanguageName.RUBY,
  rs: LanguageName.RUST,
  rdl: LanguageName.SYSTEMRDL,
  toml: LanguageName.TOML,
  sol: LanguageName.SOLIDITY,

  // jl: LanguageName.JULIA,
  // swift: LanguageName.SWIFT,
  // kt: LanguageName.KOTLIN,
  // scala: LanguageName.SCALA,
}

export const IGNORE_PATH_PATTERNS: Partial<Record<LanguageName, RegExp[]>> = {
  [LanguageName.TYPESCRIPT]: [/.*node_modules/],
  [LanguageName.JAVASCRIPT]: [/.*node_modules/],
}

// Droid adapter: resolve bundled WASM/query assets explicitly and use the pinned 0.24 API.
const resourceScope = new AsyncLocalStorage<Set<{ delete(): void }>>();
export function ownParserResource<T extends { delete(): void }>(resource: T): T {
  resourceScope.getStore()?.add(resource); return resource;
}
export async function withParserResources<T>(action: () => Promise<T>): Promise<T> {
  return resourceScope.run(new Set(), async () => {
    try { return await action(); }
    finally { for (const resource of [...resourceScope.getStore()!].reverse()) resource.delete(); }
  });
}
let assetsPath = path.join(__dirname, 'autocomplete');
let initialized: Promise<void> | undefined;
const languageCache = new Map<string, Promise<Language>>();
export function configureParserAssets(directory: string): void { assetsPath = directory; }
function extension(input: string): string {
  return input.includes('://') || input.startsWith('file:') ? getUriFileExtension(input)
    : path.extname(input).slice(1).toLowerCase();
}
export const getFullLanguageName = (filepath: string) => supportedLanguages[extension(filepath)];
async function languageFor(filepath: string): Promise<Language | undefined> {
  const name = getFullLanguageName(filepath);
  if (!name) return undefined;
  initialized ??= Parser.init({ locateFile: (file: string) => path.join(assetsPath, file) });
  await initialized;
  let result = languageCache.get(name);
  if (!result) {
    result = Parser.Language.load(path.join(assetsPath, 'grammars', 'tree-sitter-' + name + '.wasm'));
    languageCache.set(name, result);
    result.catch(() => languageCache.delete(name));
  }
  return result;
}
export async function getParserForFile(filepath: string): Promise<Parser | undefined> {
  const language = await languageFor(filepath);
  if (!language) return undefined;
  const parser = new Parser(); parser.setLanguage(language); return parser;
}
export async function getQueryForFile(filepath: string, queryPath: string): Promise<Query | undefined> {
  const source = path.join(assetsPath, 'queries', queryPath);
  if (!fs.existsSync(source)) return undefined;
  const language = await languageFor(filepath);
  return language && ownParserResource(language.query(fs.readFileSync(source, 'utf8')));
}
