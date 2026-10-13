/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import { IDE } from "../.."
import { AutocompleteCodeSnippet, AutocompleteSnippetType, AutocompleteStaticSnippet } from "../types"
import { HelperVars } from "../util/HelperVars"

import { ImportDefinitionsService } from "./ImportDefinitionsService"
import { getSymbolsForSnippet } from "./ranking"
import { RootPathContextService } from "./root-path-context/RootPathContextService"
import { StaticContextService } from "./static-context/StaticContextService"
import { ContextLookupTimeout } from "../../util/contextLookupTimeout"

export class ContextRetrievalService {
  private importDefinitionsService: ImportDefinitionsService
  private rootPathContextService: RootPathContextService
  private staticContextService: StaticContextService

  constructor(private readonly ide: IDE) {
    this.importDefinitionsService = new ImportDefinitionsService(this.ide)
    this.rootPathContextService = new RootPathContextService(this.importDefinitionsService, this.ide)
    this.staticContextService = new StaticContextService(this.ide)
  }

  public async getSnippetsFromImportDefinitions(helper: HelperVars, related: AutocompleteCodeSnippet[] = []): Promise<AutocompleteCodeSnippet[]> {
    if (helper.options.useImports === false) {
      return []
    }

    const importSnippets: AutocompleteCodeSnippet[] = []
    const fileInfo = this.importDefinitionsService.get(helper.filepath)
    if (fileInfo) {
      const { imports } = fileInfo
      // Look for imports of any symbols around the current range
      // A body can be far below its parameter/return types. Keep the enclosing
      // signatures in scope even when those imports are absent from nearby lines.
      const signatures = (helper.treePath ?? []).map(node => {
        const body = node.childForFieldName("body")
        return body ? node.text.slice(0, body.startIndex - node.startIndex).slice(0, 2000) : ""
      }).join("\n")
      const textAroundCursor = signatures + "\n" + related.map(snippet => snippet.content).join("\n") + "\n" +
        helper.fullPrefix.split("\n").slice(-20).join("\n") + helper.fullSuffix.split("\n").slice(0, 5).join("\n")
      const symbols = Array.from(getSymbolsForSnippet(textAroundCursor)).filter(
        (symbol) => !helper.lang.topLevelKeywords.includes(symbol),
      )
      const visited = new Set<string>()
      for (const symbol of symbols) {
        if (visited.has(symbol)) continue
        visited.add(symbol)
        const rifs = imports[symbol]
        if (Array.isArray(rifs)) {
          const snippets: AutocompleteCodeSnippet[] = rifs.map((rif) => {
            return {
              filepath: rif.filepath,
              content: rif.contents,
              type: AutocompleteSnippetType.Code,
            }
          })

          importSnippets.push(...snippets)
          // Resolve dependencies already present in the current file's import
          // cache (e.g. User -> Role), without extra language-server requests.
          for (const snippet of snippets) {
            for (const dependency of getSymbolsForSnippet(snippet.content)) {
              if (imports[dependency] && !visited.has(dependency)) symbols.push(dependency)
            }
          }
        }
      }
    }

    return importSnippets
  }

  public async getRootPathSnippets(helper: HelperVars): Promise<AutocompleteCodeSnippet[]> {
    if (!helper.treePath) {
      return []
    }

    return this.rootPathContextService.getContextForPath(helper.filepath, helper.treePath)
  }

  public async getStaticContextSnippets(helper: HelperVars): Promise<AutocompleteStaticSnippet[]> {
    return this.staticContextService.getContext(helper)
  }

  public dispose(): void {
    this.importDefinitionsService.dispose()
  }

  public invalidate(changedFile?: string): void {
    this.importDefinitionsService.invalidate(changedFile)
    this.rootPathContextService = new RootPathContextService(this.importDefinitionsService, this.ide)
    this.staticContextService = new StaticContextService(this.ide)
  }

  /**
   * Initialize the import definitions cache for a file.
   * This is normally done automatically when the active text editor changes,
   * but needs to be called manually when using context fetching outside the normal flow.
   */
  public async initializeForFile(filepath: string): Promise<void> {
    try {
      await this.importDefinitionsService.initializeForFile(filepath)
    } catch (e) {
      if (!(e instanceof ContextLookupTimeout)) throw e
    }
  }
}
