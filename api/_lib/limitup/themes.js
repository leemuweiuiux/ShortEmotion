// 涨停情绪 · 题材词表
//
// 原样取自 lfjDashboard「涨停事件工作台20261027」的 engine.js（题材家族、归一与资讯反推），
// 只给涨停情绪用。短线情绪（v4 评分、题材雷达）仍用 ../short-emotion/engine.js 里的旧版词表，
// 两边分开维护，互不影响；题材名偶尔对不上属于预期。

const anomalyThemeName = (value) => String(value || "").replace(/^[[^]]+]/, "").replace(/(?:Wind)?(?:概念)?指数$|概念板块$|板块$|精选$/g, "").trim();
// Specific families win before broader ones. Exclusions prevent shared words such
// as "消费" and "材料" from silently merging unrelated industries.
const ANOMALY_THEME_FAMILIES = [
  { id: "agriculture", name: "农业产业链", test: /中农发系|央企农业|农业农村部系|种植业|大豆|生物育种|一号文件|粮食|农机|农垦|种业|农业|猪产业|生猪|养殖|畜牧|禽产业|水产/, exclude: /农业银行|农商行|农业保险/ },
  { id: "robotics", name: "机器人产业链", test: /人形机器人|机器人|减速器|执行器|机器视觉|丝杠|关节|伺服系统/, business: /机器人|减速器|伺服|数控|自动化|智能装备|机械/ },
  { id: "semiconductor", name: "半导体产业链", test: /半导体|存储|HBM|芯片|集成电路|先进封装|晶圆|光刻|碳化硅|氮化镓|磷化铟/, business: /半导体|芯片|集成电路|封装|晶圆|光刻|电子元器件|微电子/ },
  { id: "aerospace-defense", name: "航空航天与军工", test: /商业航天|卫星|航天|航空发动机|低空经济|军工|国防|无人机/ },
  { id: "healthcare", name: "医药产业链", test: /医药|医疗|医院|创新药|CRO|CXO|ADC|中药|疫苗|医疗器械|生物制药|化学制药/ },
  { id: "power-grid", name: "电力与电网产业链", test: /电力设备|智能电网|电网|特高压|发电运营|核电|虚拟电厂|电力运营/ },
  { id: "new-energy", name: "新能源产业链", test: /光伏|风电|锂电|储能|新能源车|电动车|充电桩|固态电池|钠离子电池|氢能/ },
  { id: "automotive", name: "汽车智能化产业链", test: /华为汽车|汽车配件|智能驾驶|无人驾驶|汽车电子|车联网|汽车零部件|整车/ },
  { id: "ai-app", name: "AI应用与软件产业链", test: /^AI$|人工智能|AI应用|AI手机|AI穿戴|多模态|智能体|AIGC|大模型|数字经济|云计算|信创|AI软件/, business: /人工智能|大模型|AIGC|算法|机器学习|自然语言|计算机视觉|智能语音|软件|信息技术|云计算|数据服务|数字化|信息系统|智能体/ },
  { id: "compute-comm", name: "算力与通信产业链", test: /算力|AI算力|液冷|服务器|光通信|CPO|光模块|数据中心|高速铜连接|铜缆高速连接|5G|6G|射频|天线|毫米波|通信设备/, business: /服务器|数据中心|光模块|光通信|通信|射频|天线|交换机|路由器|算力|液冷|散热|温控|铜缆|网络设备/ },
  { id: "consumer-electronics", name: "消费电子产业链", test: /消费电子|TWS|PCB|智能穿戴|折叠屏|面板/, business: /消费电子|电子|耳机|可穿戴|智能穿戴|面板|显示|PCB|智能终端|声学|光学/ },
  { id: "nonferrous", name: "有色金属产业链", test: /有色|稀土|贵金属|黄金|白银|工业金属|铜矿|铝业/ },
  { id: "advanced-materials", name: "新材料产业链", test: /碳纤维|超导|新材料|超硬材料|金属非金属新材料/, exclude: /半导体材料|医药材料|建筑材料/ },
  { id: "consumer", name: "消费产业链", test: /白酒|啤酒|食品饮料|食品|饮料|零售|旅游|酒店|免税|家电|乳业|调味品|餐饮|百货|商贸|预制菜|宠物经济/, exclude: /消费电子|电子消费|消费建材|医药消费|医疗消费/ },
  { id: "fintech", name: "金融科技", test: /金融科技|互联网金融|互金|第三方支付|移动支付|数字货币|数字人民币|稳定币/ },
  { id: "securities", name: "券商", test: /证券|券商/ },
  { id: "bank", name: "银行", test: /银行|农商行/ },
  { id: "insurance", name: "保险", test: /保险/ },
  { id: "property-infrastructure", name: "地产与基建产业链", test: /房地产|地产开发|物业管理|城市更新|建筑施工|基础设施|基建/ },
  { id: "energy", name: "传统能源产业链", test: /石油|天然气|油气|煤炭|页岩气|炼化/ }
];
const NON_NARRATIVE_ANOMALY_PATTERN = /^(?:TMT|大消费|新质生产力综合|三新|双循环|先进制造|老经济|新经济|资源股|成长|价值|质量|规模|均衡)$|(?:大|中|小|微)盘(?:成长|价值|均衡|风格|股)?|(?:大|中|小|微)市值(?:成长|价值|均衡)?|成长(?:风格|股|指数|精选)?$|价值(?:风格|股|指数|精选)?$|质量风格|规模风格|高盈利成长|低估值|高估值|蓝筹|白马|核心资产|茅指数|高贝塔|低贝塔|高波动|低波动|顺周期|逆周期|转融券|融资融券|场外期权|挂钩标的|证券公司.*业务|股权激励|全样本|样本池|样本|金股|券商推荐|机构推荐|超涨|超跌|市场情绪|情绪指数|打板|连板|首板|涨停|跌停|炸板|破板|一字板|反包|领涨|龙头|中军|补涨|跟风|竞价|抢筹|趋势股|突破股|放量股|缩量股|高开|低开|非.?ST|ST股|强势股|活跃股|高换手|低换手|高价股|低价股|微盘股|小盘股|大盘股|绩优股|亏损股|昨日|近\d+日|龙虎榜|陆股通|基金重仓|机构重仓|北向重仓|高股息|红利|低波|动量|等权|全A|百元股|次新股|解禁|破净|破发|风格指数|成交额|成交量|换手率|振幅|涨速|量比|市值|市盈率|市净率|排名|排行|榜单|股票池|精选组合|策略指数|因子指数|点位贡献|预增|预减|含可转债|可转债正股|行业龙头|地方国企|华为平台|举牌/i;
const VERIFIED_STANDALONE_THEME_PATTERN = /首发经济|两岸融合|一带一路|统一大市场|自贸区|自贸港|国企改革|供销社|乡村振兴|西部大开发|东北振兴|成渝特区|粤港澳大湾区|长三角|海洋经济|新型城镇化|设备更新|以旧换新|碳中和|碳交易|文化传媒|影视|院线|游戏|短剧|出版|教育产业|体育产业|物流|航运|港口|机场|铁路|轨道交通|水泥|玻璃|建筑材料|化工|化肥|农药|造纸|纺织|服装|工程机械|工业母机|机床|船舶|环保|水务|燃气|数据要素|网络安全|工业互联网|物联网/;
function anomalyFamily(name) {
  const value = String(name || "").trim();
  if (!value) return null;
  // 族名本身不一定命中自己的匹配式（如「汽车智能化」不在 automotive 的 test 里），
  // 但资讯反推出来的就是族名，必须能回到同一族，否则同一件事会被拆成两行
  const byLabel = ANOMALY_THEME_FAMILIES.find((rule) => {
    const label = rule.name.replace(/产业链$/, "");
    return (value === rule.name || value === label) && !rule.exclude?.test(value);
  });
  if (byLabel) return byLabel;
  return ANOMALY_THEME_FAMILIES.find((rule) => rule.test.test(value) && !rule.exclude?.test(value)) || null;
}
// 从新闻 / 主营文本反推题材族：仅用于 Wind「所属概念板块」为空的个股兜底
// 资讯署名与披露套话含「证券」，不剔除会把普通个股误判成券商题材
const NEWS_THEME_BOILERPLATE = /证券之星|证券时报|证券日报|证券代码|证券简称|证券交易所|证券营业部|证券公司|中国证券报|上海证券报|券商中国|证监会|中国人民银行|人民银行|银行间|银行卡|银行贷款|商业银行|银行理财/g;
function detectThemeFamilies(text) {
  const source = String(text || "").replace(NEWS_THEME_BOILERPLATE, " ");
  if (source.length < 4) return [];
  const names = [];
  for (const family of ANOMALY_THEME_FAMILIES) {
    family.test.lastIndex = 0;
    if (!family.test.test(source)) continue;
    if (family.exclude) {
      family.exclude.lastIndex = 0;
      if (family.exclude.test(source)) continue;
    }
    names.push(family.name.replace(/产业链$/, ""));
  }
  return names;
}
function isEligibleNarrativeTheme(name) {
  const value = anomalyThemeName(name);
  if (!value || NON_NARRATIVE_ANOMALY_PATTERN.test(value)) return false;
  return Boolean(anomalyFamily(value) || VERIFIED_STANDALONE_THEME_PATTERN.test(value));
}

export {
  ANOMALY_THEME_FAMILIES,
  NON_NARRATIVE_ANOMALY_PATTERN,
  VERIFIED_STANDALONE_THEME_PATTERN,
  anomalyThemeName,
  anomalyFamily,
  detectThemeFamilies,
  isEligibleNarrativeTheme
};
