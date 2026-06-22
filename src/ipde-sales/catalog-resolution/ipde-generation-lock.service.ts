import { Injectable } from '@nestjs/common';

@Injectable()
export class IpdeGenerationLockService {
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    this.locks.set(key, queued);

    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) {
        this.locks.delete(key);
      }
    }
  }
}
