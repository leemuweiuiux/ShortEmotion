import { $, setText, toast } from "/account/common.js?v=11";

const choices = $("#purchase-packages");
const status = $("#purchase-status");
const orders = $("#purchase-orders");
const recheck = $("#purchase-recheck");
const orderNo = new URLSearchParams(location.search).get("order") || "";
const isOrder = /^SE[A-F0-9]{18}$/;
const endpoint = "/api/ecpay-sandbox";
let polls = 0;

async function request(query = "", body) {
  const response = await fetch(endpoint + query, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });
  const payload = await response.json();
  if (payload.code === "login_required") {
    location.replace("/login?next=" + encodeURIComponent(location.pathname + location.search));
  }
  if (!response.ok) throw new Error(payload.error || "暂时无法读取，请稍后再试");
  return payload;
}

async function pay(pack) {
  choices.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    const checkout = await request("", { points: pack.points });
    const form = document.createElement("form");
    form.method = "POST";
    form.action = checkout.checkoutUrl;
    for (const [key, value] of Object.entries(checkout.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  } catch (error) {
    toast(error.message, true);
    choices.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
}

function orderStatus(order) {
  return order.credited_at ? "已到账 " + order.points + " 测试积分" : "等待付款确认";
}

function showOrders(history) {
  orders.replaceChildren(...history.map((order) => {
    const row = document.createElement("li");
    row.className = "ledger-empty";
    const text = order.order_no + " · " + order.points + " 积分 · RMB " + order.price_cny + " · " + orderStatus(order);
    if (order.credited_at) {
      setText(row, text);
    } else {
      const link = document.createElement("a");
      link.className = "row-link";
      link.href = "?order=" + order.order_no;
      setText(link, text);
      row.append(link);
    }
    return row;
  }));
}

async function loadOrder(manual = false) {
  const query = "?order=" + orderNo + (manual ? "&recheck=1" : "");
  const result = await request(query, manual ? {} : undefined);
  const order = result.history[0];
  setText(status, orderStatus(order));
  recheck.hidden = Boolean(order.credited_at);
  if (!order.credited_at && !manual && ++polls < 8) {
    setTimeout(() => loadOrder().catch((error) => setText(status, error.message)), 3500);
  }
  if (order.credited_at || manual) showOrders((await request()).history);
}

recheck.addEventListener("click", async () => {
  recheck.disabled = true;
  try {
    await loadOrder(true);
  } catch (error) {
    toast(error.message, true);
  } finally {
    recheck.disabled = false;
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) choices.querySelectorAll("button").forEach((button) => { button.disabled = false; });
});

if (location.hostname === "exp.lfjmwl.com") {
  request().then(({ email, packages, history }) => {
    setText($("#purchase-account"), "积分将发放至 " + email);
    for (const pack of packages) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-primary";
      const amount = document.createElement("strong");
      const settlement = document.createElement("small");
      setText(amount, pack.points + " 积分 · RMB " + pack.priceCny);
      setText(settlement, "测试结算 NT$" + pack.chargeTwd);
      button.append(amount, settlement);
      button.addEventListener("click", () => pay(pack));
      choices.append(button);
    }
    showOrders(history);
    setText(status, history.length ? "最近 " + history.length + " 笔测试订单" : "暂无测试订单");
    if (isOrder.test(orderNo)) return loadOrder();
  }).catch((error) => setText(status, error.message));
} else {
  location.replace("/account");
}
