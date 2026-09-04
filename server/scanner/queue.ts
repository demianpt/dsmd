import type { ScanMeta } from '../types/domain.js';
import { log } from '../lib/log.js';
import { runScan } from './run.js';

class LocalScanQueue {
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;

  enqueue(meta: ScanMeta): void {
    this.queued += 1;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        this.queued = Math.max(0, this.queued - 1);
        await runScan(meta);
      })
      .catch((error) => {
        log.error(`Uncaught queue error for ${meta.slug}`, error);
      });
  }

  size(): number {
    return this.queued;
  }
}

export const scanQueue = new LocalScanQueue();
