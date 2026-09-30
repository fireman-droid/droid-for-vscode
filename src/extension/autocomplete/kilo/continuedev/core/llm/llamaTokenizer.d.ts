/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
export declare class LlamaTokenizer {
  vocabById: string[]
  vocabByString: Map<string, number>
  merges: Map<string, number>
  constructor(vocab_base64?: string, merges_binary?: string)
  public encode(
    prompt: string,
    add_bos_token?: boolean,
    add_preceding_space?: boolean,
    log_performance?: boolean,
  ): number[]
  public decode(tokenIds: number[], add_bos_token?: boolean, add_preceding_space?: boolean): string
  runTests(tests?: (tokenizer: LlamaTokenizer) => boolean): void
}
export declare const llamaTokenizer: LlamaTokenizer
