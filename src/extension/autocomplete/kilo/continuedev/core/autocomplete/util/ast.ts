/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import type Parser from "web-tree-sitter"
type SyntaxNode = Parser.SyntaxNode
type Tree = Parser.Tree

import { getParserForFile, ownParserResource } from "../../util/treeSitter"

export type AstPath = SyntaxNode[]

export async function getAst(filepath: string, fileContents: string): Promise<Tree | undefined> {
  const parser = await getParserForFile(filepath)

  if (!parser) {
    return undefined
  }

  try {
    const ast = parser.parse(fileContents)
    return ast ? ownParserResource(ast) : undefined
  } finally {
    parser.delete()
  }
}

export async function getTreePathAtCursor(ast: Tree, cursorIndex: number): Promise<AstPath> {
  const path = [ast.rootNode]
  while (path[path.length - 1].childCount > 0) {
    let foundChild = false
    for (const child of path[path.length - 1].children) {
      if (child && child.startIndex <= cursorIndex && child.endIndex >= cursorIndex) {
        path.push(child)
        foundChild = true
        break
      }
    }

    if (!foundChild) {
      break
    }
  }

  return path
}
