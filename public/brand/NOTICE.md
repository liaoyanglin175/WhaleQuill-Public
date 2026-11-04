# 鲸笺应用图标来源

2026-10-29，用户指定使用其提供的鲸鱼书页原图。据用户后续说明，原图由 AI 生成，设计灵感参考 DeepSeek。

- 原文件名：codex-clipboard-3b6aad68-e479-4b50-a099-405717dca675.jpg。
- 本机应用源：jingjian-original.jpg；原文件 SHA-256 为 `9e134f87ae0d8cfa23b692304b60c9f64efdcd15d41007be553f55bed5c36de6`。
- 0.2.7 直接采用原 JPG；原文件继续完整保留。
- 0.2.8 按用户确认的背景适配要求，使用内置图像编辑工具从原图制作 jingjian-transparent.png。以保留鲸鱼与书页造型为约束去除蓝底并收紧留白；这是模型编辑的衍生图，不能视为逐像素无损抠图，也不产生原图的再分发授权。处理提示与校验见 manifest.json。
- jingjian-app-icon.svg 将透明底衍生图等比例放入浅灰色圆角容器，用于深浅任务栏中的辨认；原生格式由 Tauri icon 转换。未采用此前被否决的另一个鲸鱼 SVG 造型。
- jingjian-wordmark.svg 基于随程序提供的霞鹜文楷字形生成，保留原字形轮廓并调整两个字的大小、间隔和基线；字体来源与 OFL 许可见 ../fonts/NOTICE.md。可复现脚本：scripts/make-jingjian-wordmark.py。
- 公开分发依据尚待核实。需要登记原图生成平台、适用输出条款，以及生成时如有采用第三方参考素材，其许可是否涵盖随程序分发。该核对同时适用于原图、透明底图和内置于 EXE 的图标。

0.2.10 英文字标：用户选定 Whale Quill，使用 Cormorant 600 字重。Cormorant-Variable.ttf 来自 Google Fonts 的 ofl/cormorant/Cormorant[wght].ttf，原字体字节未修改；OFL 原文随同目录 Cormorant-OFL.txt 保留，逐文件来源与校验见 manifest.json。中文鲸笺字标和鲸鱼主体沿用。

2026-11-02：用户确认同版本调整，当前英文显示为 WhaleQuill，W、Q大写；沿用 Cormorant 600 与原图标，仅收紧英文侧栏尺寸和间距。素材与字体原始字节及许可不变。
