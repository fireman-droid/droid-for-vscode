/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import { Range } from "../index.js"

export function getRangeInString(content: string, range: Range): string {
  const lines = content.split("\n")

  if (range.start.line === range.end.line) {
    return lines[range.start.line]?.substring(range.start.character, range.end.character) ?? ""
  }

  const firstLine = lines[range.start.line]?.substring(range.start.character, lines[range.start.line].length) ?? ""
  const middleLines = lines.slice(range.start.line + 1, range.end.line)
  const lastLine = lines[range.end.line]?.substring(0, range.end.character) ?? ""

  return [firstLine, ...middleLines, lastLine].join("\n")
}
