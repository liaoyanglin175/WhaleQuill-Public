# 鲸笺 · WhaleQuill

一个本地优先的 Windows 记事本。随手记下当下的想法，在星海里重读过去的记录，把接下来要做的事放进桌面便签。

## 下载与运行

**[下载鲸笺 · Windows x64](https://github.com/liaoyanglin175/WhaleQuill-Public/releases/latest)**

在发布页展开 **Assets**，下载并双击运行 `.exe`。程序需要 Microsoft Edge WebView2 Runtime。发布版首次打开会创建自己的空白笔记本。已有笔记可按需通过备份导入。

## 功能

- **随记**　打开就能写，标题和标签可选。支持文字样式、重点和手动保存。
- **星海回顾**　历史随记会轮换为星点。悬停时，左侧显示对应的摘要，点击星点可打开原文。
- **日程与桌面便签**　管理待办和行程。便签可贴边收起，应用后台运行时可继续提醒。
- **笺间对话**　本地查找原文。连接 DeepSeek 后，可预览并确认发送所选笔记片段，用于问答或精简。
- **本地备份**　笔记和日程存放在设备上，支持完整备份和导入恢复。

## 开始使用

1. 打开鲸笺，在首页输入一条随记并保存。
2. 在记录时间线切换列表或星图，点开旧记录回看。
3. 在「日程」添加待办，再按需打开桌面便签。

## 从源码构建

使用 Windows x64、Node.js 24、Rust MSVC 工具链和 Visual Studio 的 C++ 生成工具。在仓库根目录执行：

```powershell
npm ci
npm test
npm run desktop:build
```

构建结果位于 `src-tauri/target/release/dafeiyu-notebook.exe`。如果设置了 `CARGO_TARGET_DIR`，则位于该目录下的 `release` 文件夹。开发预览可用 `npm run dev`，浏览器预览有独立的本地数据。

## 许可与素材

鲸笺原创代码以 [PolyForm Noncommercial 1.0.0](LICENSE) 公开，供非商业用途使用、修改和分发。角色动画来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。原型「溟月」由上善无形创作，女仆鲸鱼娘设计来自 ZipZipPipe，形象适用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。图标、字体、动画和依赖的来源及条款详见[版权与第三方素材声明](THIRD_PARTY_NOTICES.md)。

[Windows 构建依赖的版权与许可文本](DEPENDENCY_NOTICES.txt)
