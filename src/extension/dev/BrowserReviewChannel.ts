import type { ServerResponse } from 'node:http';
import type { ReviewPanelController } from '../panels/review/ReviewPanelController';

/** Uses the editor's Review controller with a separate, authenticated browser stream. */
export class BrowserReviewChannel {
  private response: ServerResponse | null = null;
  private review: Pick<ReviewPanelController, 'open' | 'handleMessage' | 'dispose'> | null = null;
  constructor(private readonly createReview: (post: (message: unknown) => void) => Pick<ReviewPanelController, 'open' | 'handleMessage' | 'dispose'>) {}

  connect(response: ServerResponse): void {
    this.dispose();
    this.response = response;
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    });
    response.write(': connected\n\n');
    this.review = this.createReview(message => {
      if (this.response === response && !response.destroyed) response.write(`data: ${JSON.stringify(message)}\n\n`);
    });
    this.review.open();
    response.on('close', () => { if (this.response === response) this.dispose(); });
  }
  handleMessage(message: unknown): void { this.review?.handleMessage(message); }
  keepAlive(): void { this.response?.write(': keepalive\n\n'); }
  dispose(): void {
    const response = this.response;
    this.response = null;
    this.review?.dispose();
    this.review = null;
    response?.end();
  }
}
