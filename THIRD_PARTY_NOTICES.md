# 鲸笺版权与第三方素材声明

鲸笺拟以非商业项目形式公开源码与程序。项目原创代码的具体使用、修改和分发条款以随发布提供的代码许可证为准。下列角色、动画、图标、字体及依赖各自适用其来源和许可。分发时请保留本声明及相关署名、许可链接和修改说明。

## 固定大肥鱼动画

本程序采用 PC2005-cloud/dsh-pet 的 14 段透明 WebM 动画。形象原型「溟月」由上善无形创作，女仆鲸鱼娘由 ZipZipPipe 设计，属于社区二创。

- [动画来源](https://github.com/PC2005-cloud/dsh-pet) · [固定提交的素材条款](https://github.com/PC2005-cloud/dsh-pet/blob/f8fc9a8a18dafb9b3545b56b701ad7bc0fce2e89/README.md#许可)
- [原型作者上善无形](https://space.bilibili.com/4456176) · [设计作者 ZipZipPipe](https://space.bilibili.com/4168597) · [形象许可声明](https://www.bilibili.com/opus/1247156596114456581)
- [形象许可 CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) · [协议全文](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.zh-hans)
- 完整随包声明：[NOTICE](public/mascot/dafeiyu/NOTICE.md)
- 逐文件来源与校验值：[manifest](public/mascot/dafeiyu/manifest.json)

形象许可要求署名和非商业使用。公开分享对该形象的演绎成果时，按许可保留相同方式共享条件。动画上游另行说明允许开源使用、禁止商用，并要求公开页面附上原作者仓库链接。该说明未明确仅限非商业用途的源码发布是否属于其所说的「开源使用」，随程序分发这些动画前应确认这一点。

视频文件未改动字节，仅重命名；静态封面来自待机视频第一帧。窗口内播放器及本应用的历史检索、模型请求由本项目实现。MerZlin/dsh-pet-indesktop 用于实现方式研究，未将其独立 Python 应用打包进本程序。

## 代码依赖

前端与桌面依赖版本见 `package-lock.json` 与 `src-tauri/Cargo.lock`。各依赖沿用其上游许可，发布时按实际分发的文件附上适用的版权与许可文本。

## 0.2.5 离线字体

思源黑体、思源宋体、霞鹜文楷、朱雀仿宋和更纱等宽来源、固定版本、原始许可及常用字子集/WOFF2转换记录见 public/fonts/NOTICE.md 与 manifest.json。应用字体内部名称已改为 DFY 系列，字形设计不变。原始版权与许可文件随程序保留。

## 0.2.7 鲸笺图标

项目使用用户提供的鲸鱼与书页图样。据用户说明，原图由 AI 生成，设计灵感参考 DeepSeek。原图的生成平台、适用输出条款和是否使用了第三方参考素材尚待确认，公开再分发许可仍待核实。[图标来源及处理记录](public/brand/NOTICE.md)

## 0.2.8 图标背景适配与字标

用户确认保留鲸鱼与书页主体、适配背景与留白后，通过内置图像编辑工具制作透明底衍生图，系统图标加浅灰容器。完整原图仍保留；编辑不能产生原图的公开再分发许可。字标由随程序提供的霞鹜文楷字形导出，保留字形轮廓并调整组合排版。文件校验、处理提示与原始来源见 public/brand/NOTICE.md、public/brand/manifest.json；字体原始 OFL 及来源见 public/fonts/NOTICE.md。

## 0.2.10 英文字标与工作动作

WhaleQuill 英文字标采用 Cormorant，字体原文件及 SIL Open Font License 1.1 随 public/brand/Cormorant-Variable.ttf、Cormorant-OFL.txt 保留，来源和 SHA-256 见同目录 manifest.json。新增“轻快记录”连续动作来自上述固定版本动画仓库，未修改原视频字节；仅在对话面板内呈现。字体许可不改变角色、图标或本项目代码各自的许可边界。
