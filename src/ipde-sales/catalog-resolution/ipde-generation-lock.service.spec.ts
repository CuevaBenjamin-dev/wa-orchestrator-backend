import { IpdeGenerationLockService } from './ipde-generation-lock.service';

describe('IpdeGenerationLockService', () => {
  it('serializes work for the same subject key', async () => {
    const service = new IpdeGenerationLockService();
    let active = 0;
    let maximum = 0;
    const action = () =>
      service.withLock('IPDE:andrologia', async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      });

    await Promise.all([action(), action()]);
    expect(maximum).toBe(1);
  });

  it('releases the lock after a failure', async () => {
    const service = new IpdeGenerationLockService();
    await expect(
      service.withLock('IPDE:iva', () => Promise.reject(new Error('failure'))),
    ).rejects.toThrow('failure');
    await expect(
      service.withLock('IPDE:iva', () => Promise.resolve('released')),
    ).resolves.toBe('released');
  });

  it('allows different subjects to execute independently', async () => {
    const service = new IpdeGenerationLockService();
    let active = 0;
    let maximum = 0;
    const action = (key: string) =>
      service.withLock(key, async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      });

    await Promise.all([action('IPDE:civil'), action('IPDE:penal')]);
    expect(maximum).toBe(2);
  });
});
