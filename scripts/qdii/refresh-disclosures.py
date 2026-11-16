"""QDII 限额温度计：每天发现场外纳指100 / 标普500 QDII 基金家族，解析新的限额公告（东方财富公告镜像）。
认不出的公告留待核对，不影响其他基金。
用法：python refresh-disclosures.py <种子 curated.json> <状态 curated.json>
"""

from datetime import date, datetime, timedelta
from io import BytesIO
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from pypdf import PdfReader


HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://fundf10.eastmoney.com/"}
CN_DATE = r"(20\d{2})年(\d{1,2})月(\d{1,2})日"
AMOUNT = r"([\d,]+(?:\.\d+)?)(万)?(?:元|人民币)"
HOLIDAY = re.compile(r"(?:节假日|假期|圣诞节|春节|劳动节|国庆节|中秋节|端午节|清明节|非港股通|非交易日|海外休市)")
CAP_TITLE = re.compile(r"(?:申购|定期定额).*(?:业务|金额|调整|上限|限制|公告)|(?:调整|暂停|恢复|限制).*(?:申购|定期定额)")
REPORT_TITLE = re.compile(r"20\d{2}年(?:第[一二三四1234]季度|中期|年度|半年度)报告$")


def download(url):
    with urlopen(Request(url, headers=HEADERS), timeout=25) as response:
        return response.read()


def compact(text):
    return re.sub(r"\s+", "", text).replace("，", ",")


def to_date(groups):
    return date(*map(int, groups)).isoformat()


AGENCY = re.compile(r"代销|非直销|直销(?:渠道|机构|平台)?以外")


def limit_amounts(text, code):
    """限额金额按渠道分组：代销优先，其次未分渠道，最后直销。返回 [(渠道, 金额, 所在句)]；只针对 C/D/E/I 类或美元份额的金额不计入。"""
    found = []
    for match in re.finditer(r"(?:业务限额为|申购限额为|单日限额为|申购上限为|限制金额为|不超过|不得超过|超过)(?:人民币)?" + AMOUNT, text):
        # 只看金额所在的这一句（上一个；或。之后），避免长句里的渠道、份额类别看不到或看串
        start = max(text.rfind(mark, 0, match.start()) for mark in "；。;") + 1
        sentence = text[max(start, match.start() - 260):match.start()]
        clause = sentence[max(sentence.rfind(mark) for mark in "，,") + 1:]
        if "美元" in sentence[-30:] or not re.search(r"申购|定期定额|转换转入|限制金额", sentence):
            continue
        if re.search(r"[DEI]类", sentence) and not re.search(r"A类|" + code, sentence):
            continue
        if re.search(r"[CDEI]类", clause) and not re.search(r"A类|" + code, clause):
            continue  # 同一句里分别写 A、C 类时，只取 A 类那一段
        channel = "agency" if AGENCY.search(sentence) else "direct" if "直销" in sentence else "any"
        number, unit = match.groups()
        found.append((channel, float(number.replace(",", "")) * (10_000 if unit else 1), text[max(start, match.start() - 260):match.end()]))
    for channel in ("agency", "any", "direct"):
        picked = [item for item in found if item[0] == channel]
        if picked:
            return picked
    return []


def parse_limit(title, text, code, published):
    if "继续暂停" in title or HOLIDAY.search(title) or "销售机构" in title or "转换业务" in title:
        return None
    # 银行卡、支付渠道、费率类通知与额度无关
    if re.search(r"借记卡|通联支付|直联|费率", title):
        return None
    # 同时暂停赎回的是境外休市（节假日），不是额度变化
    if "暂停" in title and "赎回" in title:
        return None
    # 只调整基金公司直销渠道的公告：代销限额不变
    if "直销" in title and not re.search(r"代销|非直销", title):
        return None
    if ("美元份额" in title or "美元现汇" in title or re.search(r"[CEI]类(?:基金)?份额", title)) and "人民币" not in title and "A类" not in title:
        return None
    if code not in text:
        raise ValueError("正文未找到对应基金代码")
    found = re.search(r"(?:暂停申购(?:业务)?起始日|恢复申购(?:业务)?(?:起始)?日|(?:恢复/)?限制申购(?:业务)?起始日|(?:限制|暂停|调整)大额申购(?:业务金额限制)?起始日|恢复大额申购(?:起始)?日|自)" + CN_DATE, text)
    if not found:
        raise ValueError("缺少限额生效日")
    effective = to_date(found.groups())
    if effective < published:
        raise ValueError("限额生效日早于公告日")
    details = re.split(r"(?:2[.．、]其他需要提示的事项|其他需要提示的事项)", text, maxsplit=1)[-1]
    # 直销、代销限额不同时取代销（大多数人通过代销平台申购，2026-11-16）
    candidates = limit_amounts(details, code) or limit_amounts(text, code)  # 金额只写在第 1 节「注」里时退回全文
    amounts = {amount for _, amount, _ in candidates}
    if len(amounts) > 1:
        # 正文同时提到旧、新金额时，取写明本次生效日的那一句
        y, m, d = effective.split("-")
        dated = {amount for _, amount, sentence in candidates if re.search(f"{y}年0?{int(m)}月0?{int(d)}日", sentence)}
        amounts = dated or amounts
    if "暂停申购" in title and "大额" not in title and "恢复" not in title:
        return effective, 0
    # 恢复大额申购 / 取消限制：不再限额（正文里提到的旧金额不算）
    if re.search(r"恢复大额|取消", title) and re.search(r"取消.{0,160}(?:限制|限额)", details):
        return effective, "unlimited"
    if len(amounts) == 1:
        return effective, amounts.pop()
    if not amounts and re.search(r"(?:取消|解除).{0,30}(?:申购金额限制|大额申购限制|限额)", details):
        return effective, "unlimited"
    if not amounts and "恢复大额" in title:
        return effective, "unlimited"
    if not amounts and "恢复" in title and not re.search(r"限制|大额", title):
        return effective, "unlimited"
    raise ValueError("限额规则或金额需核实")


FALLBACK_AMOUNT = r"(?:人民币)?([\d,]+(?:\.\d+)?)(万|千)?元"
UNIT = {"万": 10_000, "千": 1_000}


def amount(number, unit):
    return float(number.replace(",", "")) * UNIT.get(unit, 1)


def parse_notice(title, text, code, published):
    """parse_limit 认不出时的补充规则（2026-11-16 回填全部基金时整理）：返回 (生效日, 限额) 或 None；仍认不出则抛错。"""
    try:
        return parse_limit(title, text, code, published)
    except ValueError as error:
        if "生效日早于" in str(error):
            raise
        reason = error
    if re.search(r"起点|最低|总规模|申购赎回清单|固有资金|开放日|银联|支付|快付|美元(?:现汇|现钞)?份额", title) and "人民币" not in title:
        return None
    found = re.search(r"(?:起始日|自)" + CN_DATE, text)
    effective = to_date(found.groups()) if found and to_date(found.groups()) >= published else published
    if "暂停申购" in title and "大额" not in title and "恢复" not in title:
        return effective, 0
    # 「由 X 调整为 Y」：取调整后的金额
    changed = re.search(r"调整为[^。；;]{0,80}?(?:限额为|不超过|上限为|限额应不超过)" + FALLBACK_AMOUNT, text)
    if changed:
        return effective, amount(*changed.groups())
    values = set()
    for match in re.finditer(r"(?:限额为|不超过|上限为)" + FALLBACK_AMOUNT, text):
        start = max(text.rfind(mark, 0, match.start()) for mark in "；。;") + 1
        sentence = text[start:match.end()]
        if re.search(r"美元|总规模|起点|最低", sentence) or (re.search(r"[CDEI]类", sentence) and "A类" not in sentence):
            continue
        values.add(amount(*match.groups()))
    values = {value for value in values if value < 10_000_000_000}
    if len(values) == 1:
        return effective, values.pop()
    if not values and re.search(r"恢复大额|取消", title):
        return effective, "unlimited"
    raise reason


# ---- 基金家族：A/C/I/D、人民币/美元份额合并为一个家族，取一个代表份额解析 ----
INDEX = [("ndx", re.compile(r"纳斯达克100|纳指100|纳斯达克一百")), ("spx", re.compile(r"标普500|标准普尔500"))]
EXCLUDE = re.compile(r"等权|增强|科技|信息|红利|价值|成长|动量|质量|做多|杠杆|货币|债")
FOREIGN = re.compile(r"美元|美钞|美汇|现汇|现钞")


def family_key(name):
    key = re.sub(r"\(.*?\)|（.*?）", "", name)
    key = re.sub(r"美元现汇|美元现钞|美元汇|人民币|美元|美钞|美汇|现汇|现钞|发起式|发起|型", "", key).replace("纳指", "纳斯达克").replace("标准普尔", "标普")
    return re.sub(r"[A-Z]+$", "", key)


def discover():
    text = download("https://fund.eastmoney.com/js/fundcode_search.js").decode("utf-8")
    rows = json.loads(text[text.index("["):text.rindex("]") + 1])
    groups = {}
    for code, _, name, kind, *_ in rows:
        index = next((key for key, pattern in INDEX if pattern.search(name)), None)
        if not index or not ("QDII" in name + kind or "海外" in kind) or EXCLUDE.search(name):
            continue
        if "ETF" in name and "联接" not in name:
            continue  # 场内 ETF 没有每人每日限额
        groups.setdefault(family_key(name), {"index": index, "members": []})["members"].append((code, name))
    out = {}
    for key, group in groups.items():
        members = sorted(group["members"], key=lambda m: (bool(FOREIGN.search(m[1])), not re.search(r"A(?:人民币|\(人民币\))?$|[^A-Z]$", m[1]), m[0]))
        out[key] = {"key": key, "index": group["index"], "code": members[0][0], "name": members[0][1], "members": sorted(m[0] for m in members)}
    return out


def notice_rows(code, since):
    rows = []
    for page in range(1, 60):
        response = json.loads(download(f"https://api.fund.eastmoney.com/f10/JJGG?fundcode={code}&pageIndex={page}&pageSize=50&type=0"))
        batch = response["Data"] if isinstance(response.get("Data"), list) else []
        if page == 1 and not batch:
            raise ValueError("公告源未返回有效列表")
        rows.extend(batch)
        if len(batch) < 50 or batch[-1]["PUBLISHDATEDesc"] < since:
            break
    return sorted(rows, key=lambda row: (row["PUBLISHDATEDesc"], row["ID"]))


SKIP_TITLE = re.compile(r"继续暂停|销售机构|转换业务|借记卡|通联支付|直联|费率|快付|渠道|新增.{0,20}销售|开通|首次公开发行|不开放|起点|最低")


def refresh_family(family, since, today):
    """解析 since 之后的新公告；事件 [公告日, 生效日, 限额, 公告链接, 标题]。缺链接的旧事件按公告日 + 标题补上。"""
    missing = [event for event in family["events"] if not event[3]]
    rows = notice_rows(family["code"], min([since] + [event[0] for event in missing]))
    links = {(row["PUBLISHDATEDesc"], row["TITLE"]): f"https://pdf.dfcfw.com/pdf/H2_{row['ID']}_1.pdf" for row in rows if re.fullmatch(r"AN\d+", row["ID"])}
    for event in missing:
        event[3] = links.get((event[0], event[4]))
    if family.get("opened") is None:
        family["opened"] = next((row["PUBLISHDATEDesc"] for row in rows if re.search(r"开放日常申购|开放申购|基金合同生效", row["TITLE"])), rows[0]["PUBLISHDATEDesc"] if rows else today)
    processed = set(family.get("processed", []))
    review = []
    for row in rows:
        title, published, identifier = row["TITLE"], row["PUBLISHDATEDesc"], row["ID"]
        if published < since or published > today or identifier in processed or not re.fullmatch(r"AN\d+", identifier):
            continue
        if not CAP_TITLE.search(title) or REPORT_TITLE.search(title) or HOLIDAY.search(title) or SKIP_TITLE.search(title):
            processed.add(identifier)
            continue
        source = f"https://pdf.dfcfw.com/pdf/H2_{identifier}_1.pdf"
        try:
            body = compact("".join(page.extract_text() or "" for page in PdfReader(BytesIO(download(source))).pages))
            parsed = parse_notice(title, body, family["code"], published)
            if parsed is not None:
                effective, cap = parsed
                previous = family["events"][-1][2] if family["events"] else "unlimited"
                if cap != previous:
                    family["events"].append([published, effective, cap, source, title])
            processed.add(identifier)
        except Exception as error:
            review.append({"date": published, "title": title, "source": source})
            print(f"{family['code']} {published} 待核对：{error}", flush=True)
    family["events"].sort(key=lambda event: (event[0], event[1]))
    family["review"] = review
    family["checkedThrough"] = today
    family["processed"] = sorted(identifier for identifier in processed if identifier >= "AN" + since.replace("-", "")[:6])


def main():
    seed, state = map(Path, sys.argv[1:3])
    curated = json.loads(seed.read_text())
    previous = json.loads(state.read_text()) if state.exists() else {}
    known = {family["key"]: family for family in curated["families"]}
    for family in previous.get("families", []):
        if family.get("checkedThrough", "") >= known.get(family["key"], {}).get("checkedThrough", ""):
            known[family["key"]] = family
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    excluded = set(curated.get("excluded", []))
    try:
        for key, found in discover().items():
            if key in excluded:
                continue
            family = known.setdefault(key, {"key": key, "events": [], "opened": None})
            family.update({k: found[k] for k in ("index", "code", "name", "members")} if not family.get("code") else {"members": found["members"]})
    except Exception as error:
        print(f"基金列表读取失败，沿用已知家族：{error}", flush=True)
    for family in known.values():
        if family["key"] in excluded:
            continue
        since = family.get("checkedThrough") or curated["historyFrom"]
        try:
            refresh_family(family, since, today)
        except Exception as error:
            print(f"{family['code']} 公告列表读取失败：{error}", flush=True)
    curated["families"] = sorted((family for key, family in known.items() if key not in excluded), key=lambda family: (family["index"], family["key"]))
    curated["verifiedOn"] = today
    state.write_text(json.dumps(curated, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
