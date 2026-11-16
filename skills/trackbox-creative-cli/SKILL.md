---
name: trackbox-creative-cli
description: 底层系统与集成协作。创意助手的画布 JSON 工具规程。查节点、建待运行节点、改参数、运行和入库时读取。只给创意 Agent。日常单次编辑和单张反推不要读。
---

# trackbox-creative-cli

只给创意助手。参数是 JSON，按工具名调用。`node_key` 必须是当前画布上的节点 id，不能编造。

创建和更新不生成、不扣费，并直接写入画布，不要出确认卡。只有 `run_node` 进入确认和扣费。询问模式下运行只出确认，队列尚未执行时不要声称已经生成。

## 查找与读取

- `search_canvas_nodes`：按 `type`（image / video / audio / text）、`name`、`tag`、`status` 筛选。`tag` 匹配标题或所在分组名。
- `get_node_details`：入参 `node_key`。返回提示词、模型、比例、引用和产物。不在当前板就失败。
- `list_canvas_boards`：列出当前项目全部子画板。返回 `board_id`、名称，以及哪一块是用户正在看的。
- `get_canvas_board`：传入 `board_id`，读取那一块上的节点摘要。只读。之后的创建、连线和生成仍写在用户当前打开的板。

这几步不改画布。

## 创建与修改

- `create_image_node` / `create_video_node` / `create_audio_node`：写入 `title`、`prompt`、`model`、`ratio`、`duration`、`reference_nodes`。节点状态是待运行，没有产物。
- `update_image_node` / `update_video_node` / `update_audio_node`：用 `node_key` 改参数。类型必须和节点一致。
- `disconnect_nodes`：`links` 里每条是 `source` 指向 `target` 的 `node_key`。只拆这个方向，反向边保留。两端没有这条边会失败。直接写入，不扣费。
- `create_canvas_board`：传入 `name`，在当前项目新建一块空的子画板。不切换用户正在看的板。
- `update_canvas_board`：传入 `board_id` 和 `name`，只改子画板名称。
- `delete_canvas_board`：传入 `board_id`，删除该子画板及其节点。至少保留一块。只在用户明确要求删除该子画板时调用。

提示词里可以用 `{{node_key}}` 引用已有节点。服务端会换成该节点的产物地址或标题。引用不存在则整次失败。

## 运行与入库

- `run_node`：只传 `node_key`。节点必须是待运行且还没有产物。音频节点会失败，因为当前没有可用音频模型。图片和视频在询问模式下先出确认卡，确认后才入队，产物写回同一个节点。
- `save_asset`：传入 `node_key` 和 `folder_id`，把已有产物写入项目资产库。没有产物不能入库。
- `rename_asset_file`：改已入库文件的文件名。传 `node_key` 或 `asset_id`，以及新文件名 `name`。节点还没入库会失败。
- `create_asset_folder`：在项目资产库新建文件夹。`name` 必填。不传 `parent_folder_id` 时建在项目根下。
- `rename_asset_folder`：重命名自定义文件夹。传 `folder_id` 和 `name`。预设文件夹不能改。
- `view_media`：解读视频。只传 `node_key`。视频生成节点和上传节点里的视频文件都可以，不要因为节点类型是 upload 就当成图片。走 302.AI Video-Understanding，不要把视频发给当前对话模型。

不要调用导演台、视频剪辑、音频后期、成片拼接或复合主体。这些工具不存在。
