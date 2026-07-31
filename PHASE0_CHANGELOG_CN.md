# Phase 0 变更说明

## 数据层
- vocabulary 从“汉字组内嵌词汇”改为唯一 master 词汇。
- kanji group 仅保存 wordIds。
- 重复词汇合并，所有旧 ID 保留 alias。
- 内容拆为 kanji / vocabulary / dialogue packs。

## 状态层
- IndexedDB 为主存储。
- 自动迁移旧 localStorage。
- 引入 schemaVersion、migrationHistory 和本地快照。

## 更新层
- Service Worker 不再无提示强制覆盖。
- catalog 使用 network-first；教材包使用 stale-while-revalidate。
- 新 Service Worker 安装完成后提示用户应用更新。

## 校验层
- ID 唯一性。
- 引用完整性。
- 必填字段。
- 重复词汇主记录。
- 重复例句警告。
- pack SHA-256 与数量。
- catalog 汇总数量。
