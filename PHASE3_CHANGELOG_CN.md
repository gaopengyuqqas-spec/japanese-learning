# Phase 3 变更记录

- 新增 `vocabulary-advanced-business.json`：420 个 N2～N1 高级商务词汇。
- 新增 `dialogues-advanced-business.json`：80 个高级商务和 IT 场景。
- 对话覆盖提案、风险、客户确认、日程、故障、架构、质量与治理。
- 每个新增词汇提供 3 条商务／IT 例句。
- 新增 N2、N1 筛选。
- App 改为按 `packType` 动态加载内容包，后续扩充无需再硬编码内容包 ID。
- Service Worker 缓存升级为 Phase 3 独立版本。

- 语言抽样后重写全部 30 个高级动词和 30 个正式表达例句。
- 修正 80 个对话首句，确保日语字段不混入中文场景说明。
