/** A bound shared across scopes, including reads abandoned by a closed Webview. */
export class ReviewReadQueue {
  private running = 0;
  private readonly waiting: Array<{ selected(): boolean; start(): void }> = [];
  run<T>(load: () => Promise<T>, selected: () => boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ selected, start: () => {
        this.running++;
        void load().then(resolve, reject).finally(() => { this.running--; this.drain(); });
      } });
      this.drain();
    });
  }
  private drain(): void {
    while (this.running < 4 && this.waiting.length) {
      const index = this.waiting.findIndex(item => item.selected());
      this.waiting.splice(Math.max(0, index), 1)[0]!.start();
    }
  }
}
