-- 使用统计纳入「美股 QDII 温度计」(/qdiitrend) 与「关注」(/watchlist) 两个页面。
alter table usage_private.events drop constraint events_feature_check;
alter table usage_private.events add constraint events_feature_check check(feature in
 ('home','about','login','shortemotion','anomalies','technicalanalysis','sectorflow','etfflow','qdii','watchlist','redemption','limitup','kandian','article','account','signin','points','settings','profile','invite','legal'));
