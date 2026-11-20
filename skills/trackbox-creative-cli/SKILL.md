---
name: trackbox-creative-cli
description: 底层系统与集成协作。创意助手的画布 JSON 工具规程。查节点、上传参考图落板、建待运行节点、改参数、运行和入库时读取。只给创意 Agent。日常单次编辑和单张反推不要读。
---

# trackbox-creative-cli

参数是 JSON，按工具名调用。`node_key` 必须是当前画布上的真实节点 ID，不能编造。

创建、上传参考素材和更新节点都不生成、不扣费，并直接写入画布。生成必须走两步：`run_node` 只返回估价与一次性确认令牌，`confirm_canvas_run` 在用户明确同意后才扣费入队。若当前凭证是旧版仅含 `canvas:read canvas:write` 签发的，看不到 `run_node` 和 `confirm_canvas_run`，请先重新执行 `trackbox login`（默认已包含 `canvas:read canvas:write canvas:run`）。在用户明确同意之前不要调用 `confirm_canvas_run`，队列尚未完成时也不要声称已经出片。

## 第一步：先选定或创建画布项目

外部 MCP / CLI 没有“当前正在打开的画布”。调用上传、建节点或运行工具前，必须先调用 `list_canvas_projects`：

- **没有项目**：调用 `create_ai_project`（传入 `name`）新建一块画布项目并自动创建默认子画板。不要编造 `project_id`，也不要在别的项目下建子画板冒充新项目。
- **已有项目**：把项目名称列表展示给用户，等用户明确选定后再使用对应的 `project_id`。不要自行代选项目，即使用户只有一个项目。
- 选定 `project_id` 后，后续工具全部带上该 `project_id`（`board_id` 省略时服务端默认落到该项目的默认子画板）。

## 第二步：参考图 / 多张参考图 / 图+视频混合先放到画布上，再连线生成新节点

如果用户提供了产品实拍图、多张角色/场景参考图、首帧图或参考视频/参考音频，**不能**把外部路径或外链直接塞进生成节点参数，必须按以下两步先落画布、再连线：

1. **先把 1 个或多个参考素材落成画布独立 `upload` 节点，拿到 `node_key` / `node_keys`**：
   - **本机单文件或多文件批量直传（推荐 CLI 一键上传，支持多图及图+视频+音频混传）**：终端可用 `trackbox` 时，直接运行（单次最多 20 个文件）：
     - 单文件：`trackbox upload ./product.jpg --project <project_id> [--board <board_id>] [--title <标题>] --json`
     - 多图或图+视频混合：`trackbox upload ./role1.png ./scene2.jpg ./motion.mp4 --project <project_id> [--board <board_id>] --json`
     该命令会自动并发完成预签名、二进制 PUT 直传与单次原子 `create_upload_node` 落板，每个素材落为一个独立 `upload` 节点并竖排对齐，返回有序 `node_keys: ["upload-...", ...]`。
   - **本机文件（纯 MCP 工具调用）**：
     - 单文件传顶层 `file_name` + `mime_type` + `file_size`；多图或图+视频+音频混合传 `files: [{ file_name, mime_type, file_size }, ...]` 调用 `prepare_canvas_upload`，拿到 `upload_url`（或批量 `items`）。
     - 对每个 `upload_url` 执行 HTTP PUT（原样携带对应 `headers`）上传二进制，返回 200 后调用一次 `create_upload_node`（单文件传顶层字段，多文件传 `files` 数组），一次性拿到 `node_keys`。
   - **公网 URL 或小体积内联素材**：直接调用 `create_upload_node`，单文件传 `file_url` / `file_base64`，多文件传 `files: [{ file_url }, ...]`，返回 `node_keys`。
2. **用 `reference_nodes` 连线创建新的待运行生成节点或处理节点**：
   - **图片生成（支持 1 张或多张参考图）**：调用 `create_image_node`，将图片节点的 `node_keys` 填入 `reference_nodes: ["upload-1", "upload-2"]`。注意：**图片生成节点仅接受图片或文本参考**，不能把视频/音频节点塞进 `create_image_node`（否则会报 400）。
   - **视频生成（支持单图首帧、多张参考图、以及图+视频+音频混合参考）**：调用 `create_video_node`，将全部参考节点的 `node_keys` 填入 `reference_nodes: ["upload-img1", "upload-img2", "upload-vid1"]`。服务端会按各源节点的真实媒体类型自动建立连线（图片连 `input_images`，视频连 `input_video`，音频连 `input_audio`；单张参考图生成视频在确认运行时自动对齐到 `first_frame` 首帧口）。
   - 支持视频生成模式的模型（可通过 `list_models(modality="video")` 查看 `video_generation_types`）还可在 `create_video_node` / `update_video_node` 中传入 `video_generation_type`（`frame` 单图首帧、`omni` 多图或图+视频/音频全能参考、`edit` 基于源视频改画面、`extend` 视频续写延长）与 `generate_audio`（`true` / `false`）。

## 查找与读取

- `list_canvas_projects`：列出可见画布项目及默认子画板 ID。只读。
- `list_models`：按可选 `modality`（`image` / `video` / `audio` / `image-processing` / `video-processing`）和 `project_id` 列出当前订阅可用的模型、支持时长/比例及默认模型 ID。生成模型用前三种，处理模型用后两种。指定 `model` 前必须先调用，不要猜测模型名；省略 `model` 建节点时自动选用该类型的默认可用模型。
- `list_canvas_boards`：传入 `project_id`，列出该项目全部子画板。
- `get_canvas_board`：传入 `board_id`（可选 `project_id`），读取子画板上的节点摘要。只读。
- `search_canvas_nodes`：传入 `board_id`，按 `type`（`image` / `video` / `audio` / `text` / `image-processing` / `video-processing`）、`name`、`tag`、`status` 筛选节点。
- `get_node_details`：传入 `board_id` 和 `node_key`，读取提示词或文本正文、模型、比例、时长、引用节点及产物地址 `artifact_url`。

## 创建与修改

- `create_ai_project`：传入 `name`（可选 `description`），新建画布项目与默认子画板。
- `prepare_canvas_upload` / `create_upload_node`：支持单个文件或批量 `files` 数组（最多 20 个，支持多张参考图及图+视频+音频混合上传），单次原子落入画布独立 `upload` 节点并返回有序 `node_keys`。
- `create_image_node` / `create_video_node` / `create_audio_node`：传入 `project_id`、`title`、`prompt`，可选 `board_id`、`model`、`ratio`、`duration`（秒，如 10 秒视频传 `10`）、`reference_nodes`；视频节点还支持可选 `video_generation_type`（`omni` / `frame` / `edit` / `extend`）与 `generate_audio`（布尔值）。节点坐标由服务端自动避让与分列排布，不要传 `position`。创建后状态为 `PENDING_RUN`，不扣费。
- `create_text_node`：传入 `text`，可选 `project_id`、`board_id`、`title`。写入已完成的文本节点，不生成、不调用 `run_node`。不要传 `position`。
- `create_image_processing_node` / `create_video_processing_node`：传入 `project_id` 和 `reference_nodes`（图片处理接上游图片，视频处理接上游视频），可选 `title`、`model`、`board_id`。只建节点并连线，不扣费。不要传 `position`。
- `update_image_node` / `update_video_node` / `update_audio_node`：传入 `project_id`、`board_id`、`node_key` 修改待运行节点参数。
- `update_text_node`：传入 `project_id`、`board_id`、`node_key`，改标题或较短正文。已有正文达到 80 字时不能整段覆盖。
- `update_image_processing_node` / `update_video_processing_node`：传入 `project_id`、`board_id`、`node_key`，可改标题、模型或 `reference_nodes`。
- `connect_nodes`：传入 `project_id`、`board_id`、`links`（`{ source, target }` 数组），连接已有节点。桩位由服务端按类型选择。
- `disconnect_nodes`：传入 `project_id`、`board_id`、`links`（`{ source, target }` 数组），只拆该方向连线。
- `create_canvas_board` / `update_canvas_board` / `delete_canvas_board`：在指定项目下新建、重命名或删除子画板（至少保留一块，仅在用户明确要求操作子画板时调用）。

提示词里可以用 `{{node_key}}` 引用当前画板已有节点，服务端会替换成该节点的产物地址或标题；引用不存在则整次失败。

## 两段确认运行、轮询结果与资产入库

- `run_node`：传入 `project_id`、`node_key`（可选 `board_id`、视频处理的 `duration` 秒数）。图片、视频、音频生成节点必须是 `PENDING_RUN` 且尚无产物；图片处理和视频处理节点同样走这里估价。若需运行音频节点，可先用 `list_models(modality="audio")` 确认当前账号有可用音频模型；处理节点分别用 `modality="image-processing"` 或 `"video-processing"`。本步只返回预估盒子币、`run_id` 和一次性 `confirmation_token`，不扣费。
- `confirm_canvas_run`：向用户展示预估消耗并获得明确同意后，传入 `project_id`、`board_id`、`run_id` 和 `confirmation_token` 正式扣费入队。返回 `{ status: "queued" }` 后，图片通常数十秒、视频通常 1～3 分钟完成；可间隔调用 `get_node_details` 轮询直至 `status` 变为 `COMPLETED`，读取 `artifact_url` 交付给用户。
- `save_asset` / `rename_asset_file` / `create_asset_folder` / `rename_asset_folder`：将已完成产物的节点存入项目资产库文件夹或整理命名。

不要调用视频理解、导演台、多镜头剪辑拼接、字幕压制、音画合成导出或复合主体工具，这些工具当前未开放。
