// 过热与偏热沿用限额收紧的看跌口径，也兼容尚未写入方向的快照。
const defaultDirection = { overheat: "down", warm: "down" };

export const expectedDirection = (signal) => signal.expect ?? defaultDirection[signal.id] ?? null;
