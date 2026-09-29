/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import { Disposable, IDE, RangeInFileWithContents } from "../.."
import { ContextLookupTimeout } from "../../util/contextLookupTimeout"
import { getFullLanguageName, getParserForFile, getQueryForFile, ownParserResource, withParserResources } from "../../util/treeSitter"
import { findUriInDirs } from "../../util/uri"

interface FileInfo {
  imports: { [key: string]: RangeInFileWithContents[] }
}

export class ImportDefinitionsService {
  static N = 10

  private readonly cache = new Map<string, { signature: string; info: FileInfo }>()
  private generation = 0
  private readonly disposable: Disposable | void

  constructor(private readonly ide: IDE) {
    this.disposable = ide.onDidChangeActiveTextEditor((filepath) => {
      void this.initializeForFile(filepath).catch((e) => {
        if (!(e instanceof ContextLookupTimeout) && e?.name !== "AbortError") {
          console.warn(`Failed to initialize ImportDefinitionService: ${e.message}`)
        }
      })
    })
  }

  dispose(): void {
    this.disposable?.dispose()
    this.invalidate()
  }

  get(filepath: string): FileInfo | undefined {
    return this.cache.get(filepath)?.info
  }

  invalidate(changedFile?: string): void {
    this.generation++
    // Any other file may depend on this file's exports. Its own imports are
    // re-parsed and checked before reuse, so body-only edits need no LSP query.
    for (const key of this.cache.keys()) if (key !== changedFile) this.cache.delete(key)
  }

  async initializeForFile(filepath: string): Promise<void> {
    await withParserResources(() => this._getFileInfo(filepath))
  }

  private async _getFileInfo(filepath: string): Promise<FileInfo | null> {
    const generation = this.generation
    if (filepath.endsWith(".ipynb")) {
      // Commenting out this line was the solution to https://github.com/continuedev/continue/issues/1463
      return null
    }

    // Skip non-file URIs (e.g. output:tasks, vscode:, untitled:) — these are
    // VS Code virtual documents that have no parseable source.
    if (/^[a-zA-Z][\w+.-]*:/.test(filepath) && !filepath.startsWith("file:") && !filepath.startsWith("/")) {
      return null
    }

    const parser = await getParserForFile(filepath)
    if (!parser) {
      return {
        imports: {},
      }
    }

    try {
    let fileContents: string | undefined = undefined
    try {
      const { foundInDir } = findUriInDirs(filepath, await this.ide.getWorkspaceDirs())
      if (!foundInDir) {
        return null
      } else {
        fileContents = await this.ide.readFile(filepath)
      }
    } catch {
      // File removed
      return null
    }

    const ast = parser.parse(fileContents, undefined, {
      includedRanges: [
        {
          startIndex: 0,
          endIndex: 10_000,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 100, column: 0 },
        },
      ],
    })

    if (!ast) {
      return {
        imports: {},
      }
    }

    ownParserResource(ast)
    const language = getFullLanguageName(filepath)
    const query = await getQueryForFile(filepath, `import-queries/${language}.scm`)
    if (!query) {
      return {
        imports: {},
      }
    }

    const matches = query.matches(ast.rootNode)
    // Include the entire import statement (module path and aliases), plus the
    // lookup position. Editing or inserting imports cannot reuse old bindings.
    const signature = JSON.stringify(matches.map(match => {
      const node = match.captures[0].node
      let statement = node
      while (statement.parent?.parent) statement = statement.parent
      return [node.startPosition, statement.text]
    }))
    if (generation !== this.generation) throw new DOMException('Import context changed.', 'AbortError')
    const cached = this.cache.get(filepath)
    if (cached?.signature === signature) {
      this.cache.delete(filepath); this.cache.set(filepath, cached)
      return cached.info
    }
    this.cache.delete(filepath)

    const fileInfo: FileInfo = {
      imports: {},
    }
    for (const match of matches) {
      const startPosition = match.captures[0].node.startPosition
      const defs = await this.ide.gotoDefinition({
        filepath,
        position: {
          line: startPosition.row,
          character: startPosition.column,
        },
      })
      fileInfo.imports[match.captures[0].node.text] = await Promise.all(
        defs.map(async (def) => ({
          ...def,
          contents: await this.ide.readRangeInFile(def.filepath, def.range),
        })),
      )
    }

    if (generation === this.generation) {
      this.cache.set(filepath, { signature, info: fileInfo })
      if (this.cache.size > ImportDefinitionsService.N) this.cache.delete(this.cache.keys().next().value!)
    }
    return fileInfo
    } finally { parser.delete() }
  }
}
