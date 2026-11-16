---
name: trackbox-gpt-image-prompting
description: 为 GPT Image 2 与 2.5 撰写生图或改图提示词。用户点名 gpt-image，或生成模型卡片选中 GPT Image、Flare、Sunburst 时使用。只写提示词，不调用外部 CLI。
---

# GPT Image 提示词

在 TrackBox 里，本技能只负责把提示词写对。不要调用 `gpt-image`、`uv`、`uvx` 或 `scripts/generate.py`，不要读取或写入 `OPENAI_API_KEY`，也不要自己请求 OpenAI 图片接口。提示词写完后，交给平台已有的图片生成流程。

生成模型卡片已经选中具体模型时，按该模型写，不要再追问 Flare、Sunburst 或 Image 2。只有用户说的模型含糊（例如只说「GPT 2.5」）时，才问一次，并给出这三项的取舍。

## 模型与提示词路线

| 选择 | 模型 | 提示词怎么写 |
|---|---|---|
| Flare | `gpt-image-2.5-flare` | 快速草稿和一般出图。简报已经具体时，不必先翻资料。 |
| Sunburst | `gpt-image-2.5-sunburst` | 参考图编辑和需要细控的成片。 |
| Image 2 | `gpt-image-2` | 沿用 Image 2 的图库案例和工艺。 |

不要把 `gpt-image-2.5` 当成模型 id。模型确认、尺寸和画质留在生成参数里，不要写进最终提示词正文。保留用户给出的原文、主体、参考身份和编辑时不能改的部分。默认只出一张，不要擅自换模型或并列多版。

## 按需读取资料

只读和当前任务直接相关的一份，不要整包读入。

- **Image 2**：先读 `references/gallery.md`，再读一份对得上的 `references/gallery-*.md`，用里面的真实提示词。只有缺一块工艺时，再读 `references/craft.md` 或 `references/openai-cookbook.md` 的对应小节。
- **Image 2.5**：简报已经具体时可以不读资料。需要补充时只选一份：照片、产品和插画读 `references/openai-image-2.5-generation.md`；文字、界面、图表和分栏读 `references/openai-image-2.5-layout-and-text.md`；参考图、蒙版和局部修改读 `references/openai-image-2.5-editing.md`。
- **参数或迁移问题**：`references/models.md` 管参数；`references/openai-image-2.5-migration.md` 管从 Image 2 迁到 2.5。`references/templates-gpt-image-2.5.md` 只作补充灵感，不是已验证成品。

历史图库例子不能压过用户已经确定的模型和内容。改写例子时保留原文里的 Curated 或 Author + Source 标记。
