import { it, expect, vi } from 'vitest';
import { analysisFlight } from '../api/_lib/analysis-flight.js';
it('shares concurrent work for one user and releases the flight on completion', async () => {
  let finish;
  const work=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const a=analysisFlight('user-a:stock',work), b=analysisFlight('user-a:stock',work);
  await Promise.resolve(); expect(work).toHaveBeenCalledOnce();
  finish({status:200,payload:{}}); expect(await a).toEqual(await b);
  await analysisFlight('user-a:stock',()=>42).then(value=>expect(value).toBe(42));
});
it('isolates users and clears rejected work so failures can be retried', async () => {
  const a=analysisFlight('user-a:stock',()=>Promise.reject(new Error('failed')));
  const b=analysisFlight('user-b:stock',()=>7);
  await expect(a).rejects.toThrow('failed'); expect(await b).toBe(7);
  expect(await analysisFlight('user-a:stock',()=>8)).toBe(8);
});
