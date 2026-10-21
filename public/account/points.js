// 积分流水 /account/points：全部记录，每次 20 笔，「加载更多」往前翻。
import { $, toast, readPoints, readPointsBefore, renderLedger } from "/account/common.js?v=5";

const list = $("#ledger");
const more = $("#ledger-more");
let oldestId = null;

function show(rows, append) {
  renderLedger(list, rows, { append });
  if (rows.length) oldestId = rows.at(-1).id;
  more.hidden = rows.length < 20;
}

more.addEventListener("click", async () => {
  more.disabled = true;
  try {
    show((await readPointsBefore(oldestId)).history || [], true);
  } catch (error) {
    toast(error.message, true);
  } finally {
    more.disabled = false;
  }
});

readPoints()
  .then((payload) => show(payload.history || [], false))
  .catch((error) => {
    list.textContent = "";
    toast(error.message, true);
  });
