日语随身学 PWA（Prototype 1.0）
================================

一、包含功能
- 汉字分组学习
- 同一汉字的训读词、音读词关联
- 单词与例句日语朗读、慢速朗读
- 日常生活对话与 IT 工作对话
- 逐句播放与完整对话播放
- 收藏、熟练度和间隔复习
- 学习天数与基础统计
- 深色模式
- 学习记录导入、导出
- PWA 离线缓存

二、最简单的部署方法
1. 解压 ZIP。
2. 登录 Cloudflare。
3. 进入 Workers & Pages → Create → Pages → Direct Upload。
4. 上传整个 japanese-learning-pwa 文件夹内的所有文件。
5. 部署完成后，用 iPhone Safari 打开生成的网址。
6. 点击 Safari 分享按钮 → 添加到主屏幕。

注意：不要直接在 Windows 上双击 index.html。浏览器会限制 JSON 读取。
本地预览可在该文件夹内运行：
  python -m http.server 8000
然后浏览器访问：
  http://localhost:8000

三、教材修改
- data/vocabulary.json：汉字、训读、音读、例句
- data/dialogues.json：日常与 IT 对话

四、学习记录
学习记录保存在当前浏览器的 localStorage 中。
更换网址、清除 Safari 网站数据或换手机前，请在“设置”中导出学习记录。
