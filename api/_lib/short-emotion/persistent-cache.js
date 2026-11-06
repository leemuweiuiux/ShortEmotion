// 跨次运行的取数缓存（2026-11-06，计费按返回数据量）。
//
// GitHub Actions 每次都是新程序，模块里的 Map 每轮清空，同一只股票的「主营业务」「所属概念」会被反复取。
// 这里的缓存由 service.js 在运行开始时从数据分支读入、结束时写回（kv/cache_*.json），按天数过期、按条数封顶。
// 只缓存变化很慢的资料；行情、名单、消息不放这里。

const DAY_MS = 86_400_000;
const dayValue = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));

export class PersistentCache {
  constructor({ ttlDays, maxEntries }) {
    this.ttlDays = ttlDays;
    this.maxEntries = maxEntries;
    this.entries = new Map(); // key → { value, day }
    this.dirty = false;
  }

  fresh(entry, today) {
    return entry && /^\d{8}$/.test(entry.day || "") && (dayValue(today) - dayValue(entry.day)) / DAY_MS < this.ttlDays;
  }

  get(key, today) {
    const entry = this.entries.get(key);
    return this.fresh(entry, today) ? entry.value : undefined;
  }

  has(key, today) {
    return this.get(key, today) !== undefined;
  }

  set(key, value, today) {
    this.entries.delete(key);
    this.entries.set(key, { value, day: today });
    this.dirty = true;
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  /** 从数据分支读入：过期的丢掉；格式不对整体忽略。 */
  import(saved, today) {
    if (!saved || typeof saved.entries !== "object") return;
    for (const [key, entry] of Object.entries(saved.entries)) {
      if (this.fresh(entry, today) && !this.entries.has(key)) this.entries.set(key, { value: entry.value, day: entry.day });
    }
  }

  export(today) {
    const entries = {};
    for (const [key, entry] of this.entries) if (this.fresh(entry, today)) entries[key] = entry;
    return { ttlDays: this.ttlDays, count: Object.keys(entries).length, entries };
  }

  clear() {
    this.entries.clear();
    this.dirty = false;
  }
}

// 主营业务与核心产品：短线情绪（候选补充）与涨停情绪（品牌概念复核）问的是同一句，共用一份，30 天有效。
export const stockProfileCache = new PersistentCache({ ttlDays: 30, maxEntries: 800 });
// 个股所属概念板块：7 天有效（新概念上线时最多晚一周反映；当天新涨停的股票照常现取）。
export const conceptCache = new PersistentCache({ ttlDays: 7, maxEntries: 1500 });

export const PERSISTENT_CACHE_KEYS = {
  stockProfile: "cache:stock-profile",
  concepts: "cache:concepts"
};
const CACHES = { stockProfile: stockProfileCache, concepts: conceptCache };

export async function loadPersistentCaches(store, today) {
  for (const [name, cache] of Object.entries(CACHES)) {
    const saved = (await store.kvGet(PERSISTENT_CACHE_KEYS[name]).catch(() => null))?.value;
    cache.import(saved, today);
    cache.dirty = false;
  }
}

export async function savePersistentCaches(store, today) {
  for (const [name, cache] of Object.entries(CACHES)) {
    if (!cache.dirty) continue;
    await store.kvSet(PERSISTENT_CACHE_KEYS[name], cache.export(today));
    cache.dirty = false;
  }
}

/** 主营业务文本：两边引擎共用。fetchText 只在缓存缺失时调用。 */
export async function loadStockProfileText(day, code, fetchText) {
  const cached = stockProfileCache.get(code, day);
  if (cached !== undefined) return cached;
  const text = await fetchText();
  if (text) stockProfileCache.set(code, text, day); // 空结果不缓存，下次再取
  return text;
}
