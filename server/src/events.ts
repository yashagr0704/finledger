import { EventEmitter } from 'node:events';
import type { Db } from './db';

const CHANNEL = 'ledgerflow_events';

/**
 * Change notifications. Each instance keeps local subscribers (SSE
 * connections); with Postgres, NOTIFY fans changes out to other instances.
 */
export class Events {
  private bus = new EventEmitter();
  private instanceId = Math.random().toString(36).slice(2);

  constructor(private db: Db) {
    this.bus.setMaxListeners(0);
  }

  async start() {
    await this.db.listen(CHANNEL, (payload) => {
      const [origin, firmId, version] = payload.split(':');
      if (origin !== this.instanceId) this.bus.emit(firmId, Number(version));
    });
  }

  async publish(firmId: string, version: number) {
    this.bus.emit(firmId, version);
    await this.db.notify(CHANNEL, `${this.instanceId}:${firmId}:${version}`).catch(() => {});
  }

  subscribe(firmId: string, cb: (version: number) => void) {
    this.bus.on(firmId, cb);
    return () => this.bus.off(firmId, cb);
  }
}
