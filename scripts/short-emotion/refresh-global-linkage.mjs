import { refreshGlobalLinkage } from "../../api/_lib/short-emotion/global-linkage.js";
import { getStore } from "../../api/_lib/short-emotion/store.js";
import { getApiKeys } from "../../api/_lib/short-emotion/wind-client.js";

if (!getApiKeys().length) throw new Error("WIND_API_KEY 未配置");

const result = await refreshGlobalLinkage(getStore("cn"));
if (result.skipped) throw new Error(result.reason);
const { tradingDate, stats } = result.value;
console.log(JSON.stringify({ tradingDate, stats }, null, 2));
