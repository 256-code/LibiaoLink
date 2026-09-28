#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：日报「关联任务 → 关联阶段」+「日报记录列收窄」+「导航栏图标 / 吸顶」+「分点提示 / 归类多选 / 记录口径 / 暂存保留」（业务口径 2026-09-28 · Push 198 / 199 / 200 / 201 / 202）
 *
 * 业务口径：「日报这里关联任务改成关联阶段」——「日报填写」表单的「关联任务」多选（原列项目现有任务 + 负责人）
 * 改为「关联阶段」多选：选项 = 九个施工阶段（与项目总览分组 / 两块看板同一份口径、固定顺序 售前规划 → 验收），
 * 不再列具体任务；「日报记录」列头同步 = 「关联阶段」。
 * 本脚本用**真实鼠标 / 真实键盘**（CDP Input，不是合成 click()）在真机浏览器上验五组事：
 *   ① 项目详情「日报及问题 → 日报填写」：字段标题 = 「关联阶段」，说明不再提「关联任务 / 回写」；
 *      页内导航栏「问题看板」项图标 = 业务给的面性圆环感叹号 SVG（16×16，其余三项照旧描边）；
 *   ② 多选项 = 恰好九枚（顺序 = 售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 / 试运行 / 生产阶段 / 验收），
 *      **不再列任务名**（对照组：真实项目任务「布局定档」不出现在表单里）；
 *   ③ 真实鼠标勾选「硬件实施」「试运行」→ 填「当日完成工作」→ 点「提交日报」：自动切到「日报记录」；
 *   ④ 「日报记录」表头 = 收窄后的**六列**（时间 / 填写者 / 关联阶段 / 当日完成工作 / 明日计划 / 现场工作附图；
 *      不再含「关联任务 / 今日施工人数 / 现场发现问题 / 解决方案或建议」，行 = 6 个单元格）；
 *      最新一行关联阶段列 = 「硬件实施、试运行」、状态 = 已提交；
 *   ⑤ 回「日报填写」表单已复位（勾选清零 / 完成工作清空）；跑完零残留（撤销临时会话；日报仍是内存态 —— 库内 daily_reports 不增行）。
 *
 * Push 199 追加（业务口径 2026-09-28「日报记录里面不需要体现这两个 以及施工人数」+「只保留 填写者 / 关联任务 /
 *   当日完成工作 / 明日计划 / 现场附图」）：「日报记录」列表收窄为**六列** —— 时间 / 填写者 / 关联阶段 / 当日完成工作 /
 *   明日计划 / 现场工作附图；「今日施工人数 / 现场发现问题 / 解决方案或建议」三列从列表展示去掉（只改列表展示：
 *   表单字段与 A3-09 问题生成口径不变）。④ 组断言随之更新（列数 = 6 + 不含四词 + 行内下标前移 + 问题探针清零）；
 *   同批：「问题看板」项图标换业务给 SVG（① 组新增 3 项断言 —— 新图标就位 / 旧竖列图标下架 / 其余三项仍描边）。
 *
 * Push 200 追加（业务口径 2026-09-28「做吸顶效果」+「问题追溯改成这个 但是不能照搬 应该要修改」（实指「问题追踪」项））：
 *   ① 「问题追踪」项图标换业务给样 —— 「文件 + 警示圈」（原 512×512 实心版首跑后业务反馈「不好看」→ 改浅版：文件描边走
 *      1.8px + 小警示环，与「问题看板」徽章同一套语言）；② 页内导航栏整排**吸顶** —— 滚动时停在顶栏（h-16 = 64px）正下方
 *      （站灰底 + 毛玻璃）。断言：① 组 +2（问题追踪新图标就位 / 旧表格图标下架）并把「其余仍描边」收成 2 项；
 *      ⑥ 组 +1（缩小视口 → 滚动 → 粘在顶栏下方）。
 *
 * Push 201 追加（业务口径 2026-09-28「这个也做吸顶效果吧 图二吸顶后有bug」+「把问题看板的svg给问题追溯 /
 *   问题看板的svg 改成这个（放大镜）」）：① **主标签栏吸顶** —— 项目详情页五视图标签整条横幅粘在顶栏（64px）正下方，
 *   自身 59px（pt-3 12 + 标签 46 + 底边 1），页面里其它吸顶元素一律叠在它下面（top = 64 + 59 = 123px）：
 *   项目总览任务表头（[data-board-head]）与「日报及问题」页内导航栏；② 页内导航栏**修投影外溢** —— 下内衬 8 → 16px
 *   （键帽立体投影最深 ≈ 12px，原来糊到下方「日报记录」标题上、标题还被横幅下沿切一刀），z 20 → 10（不反压主标签栏）；
 *   ③ 图标对调 —— 「问题追踪」改用原「问题看板」的「圆环 + 感叹号」徽章，「问题看板」改业务给样「放大镜」
 *   （24 视框 · fillRule evenodd · fill=currentColor）。断言：① 组三条改写（放大镜就位 / 徽章让位 / 文件 + 警示圈下架）；
 *   ⑥ 组重写为 4 项（主标签栏吸顶 / 页内条叠放 + 内衬兜住投影 / 项目总览任务表头叠放）。
 *
 * Push 201 补（业务口径 2026-09-28「这里的字被吞掉了」，问题看板截图）：页内导航栏上一版用负下边距抵消内衬，
 *   而 Tailwind v4 的 space-y-5 走的是**元素自身 margin-bottom** —— 负 mb 把下面第一块内容拽进横幅里，
 *   区块标题被横幅盖住 16px、只剩几像素的残影。改为 mb-1（4px = 20 space-y − 16 pb）：横幅下沿与下方内容留 4px，
 *   键帽 / 横幅 / 内容三者位置同时回到设计值；⑥ 组补 2 项断言（日报填写 / 问题看板 各一条：未吸顶时下一个兄弟 top ≥ 横幅下沿 +2px）。
 *
 * Push 201 再补（业务口径 2026-09-28「这个中间有条缝可以有办法解决一下吗」，项目总览截图）：吸顶条下边框在带缩放的屏
 *   （Windows 150% 等）被按设备像素吸附成 0.67px —— 栏高 59 → 58.67、下沿实际落在 122.67；下面两层吸顶元素钉 123
 *   会露 0.33px 缝，滚动时白行 / 蓝色徽章从缝里闪过去。两张吸顶表（项目总览任务表头 / 日报及问题页内导航栏）
 *   top 123 → **122px（向上多叠 1px）**，项目总览表头 z 20 → 19（低于主标签栏 z-20：叠压时下边框仍画在表头上）；
 *   ⑥ 组两条叠放断言升级为「缝不变量」：叠层 top ≤ 主标签栏下沿 − 下边框宽（覆盖缩放屏下边框变细的情形）。
 *
 * Push 202 追加（业务口径 2026-09-28「填日报文字提示如图分点」+「问题归类可以多选」+「日报记录英文加上 如图所示」
 *   +「时间格式也要年月日 具体提交时间不需要 已提交状态也不要」+「点击暂存草稿就暂存在日报填写页面吧 … 暂存就保留
 *   表单里面填的内容皆可」）：① 「日报填写」的「当日完成工作Work completed today」「明日计划Tomorrow's plan」
 *   「现场发现问题Problem」三个多行框**补英文表头**（三行分点占位提示先落、随后业务看后撤回：「算了 不要提示文字了」——
 *   最终三框**无占位提示文字**、行数回到原口径）；② 「问题归类」改**多选**（弹层点选不关闭、选中项绿勾、触发器顿号连接），
 *   原型存储口径 = 多值顿号连接；③ 「日报记录」六列表头改**中英拼写**、时间列改**年月日**、撤「提交 HH:MM」小字与状态签；
 *   ④ 「暂存草稿」不写记录、不切子视图、不清表单（只保留表单内容 + 顶部提示）。
 *   另：「现场发现问题」撤琥珀色特殊底 / 字色（「这个也不用搞特殊 样式和别的保持一致」）、表单字段标题统一加粗
 *   （「标题都标标粗」）。
 *   断言：② 组 +3（双语表头 / 三框无占位提示 / 标题加粗）、④ 组 1 条状态断言拆成 2 条（时间列年月日 + 无状态签 · 净 +1）、
 *   ⑤b 组新增 9 项（多选弹层 / 两项绿勾 / 触发器顿号 / Esc 关闭 / 暂存提示 / 悬停背景 / 内容保留 / 不切视图 / 不写记录）；
 *   另：「暂存草稿」悬停反馈加明显（「鼠标放到暂存草稿的ui效果不太明显」——描边 200 → 400、背景 zinc-100、字色转深）；累计 60 项。
 *
 * Push 202 同批续（业务口径 2026-09-28「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」）：两个附图区
 *   （现场工作附图 / 当前问题附图）改 AttachmentPicker —— **粘贴为主入口**（点一下虚线区拿到焦点，Ctrl+V 直接粘图；
 *   剪贴板图没有名字时按「剪贴板图片-N.png」命名；附件胶囊可逐个移除）、「选择文件」降为次入口（原生文件框仍在）。
 *   ⑤c 组新增 12 项（两区常驻 + 次入口仍在 / 点一下进就绪态 / 粘贴出胶囊 / × 可移除 / 第二区同套生效 / 缩略图预览 / 点开大图 / Esc 关预览 / 点名字进编辑 / Esc 取消改名 / 回车自定义名 / 记录列表出缩略图）；
 *   同批续二（业务口径「图片要可以预览」+「图片名称可以自定义」）：胶囊出**缩略图**（`URL.createObjectURL`）、点开**大图预览层**（点任意处 / Esc 关）、**点名字可自定义**（回车 / 失焦提交、Esc 取消）；
 *   粘贴优先走**真实剪贴板 + 真实 Ctrl+V**（CDP 授权 clipboardReadWrite + Input.dispatchKeyEvent 走浏览器 paste 加速键），
 *   剪贴板不可用才回落合成 ClipboardEvent（两条路都打在真实 document 监听上）。
 *
 * Push 203（业务口径 2026-09-28「这个中间加个加号吧」→「改成Ctrl + V」）：附图「粘贴」键帽正名 —— 键帽文案 `CTRL V` → `Ctrl + V`
 *   （去掉 uppercase 变换、中间加「+」；材质与两半分半结构不变）；⑤c 组补 1 项（键帽文案 = `Ctrl + V` 且 text-transform = none），累计 61 项。
 *
 * Push 204（业务口径 2026-09-28「做成文字吧」）：附图「粘贴」入口键帽**下架、改纯文字** `Ctrl + V`（去渐变底 / 内阴影 / 圆角等
 *   键帽材质；字色随半区悬停 / 就绪态转深 —— 两半结构、两条入口与它处零改动）；⑤c 组补 1 项（左半为纯文字：无渐变底 / 无键帽投影 / 无圆角）。
 *   同批续（业务口径「位置要居中」）：左半按钮 h-full 撑满右半图标定高的 44px 行（原来文字盒只有 36px、悬在行顶，视觉偏高 ~4px）——
 *   文字中线与半区中线齐平；⑤c 组再补 1 项（文字中线 = 半区中线 ±1px 且两半等高）。
 *   同批再续（业务口径「点击ctrl v 再点右侧图标就会卡ctrl v一直被点击的bug」）：卡片撤 `tabIndex` / `onFocus` 的「兜就绪态」——点右半
 *   「选择文件」时浏览器焦点落点曾是卡片本身（label 里是 display:none 的文件框，接不了焦点），左半被重新点亮、Ctrl+V 被一直劫持；
 *   就绪态只由左半驱动（贴图区 = 点左半），右半点按显式撤销就绪态并让落点失焦。⑤c 组再补 1 项（idle 点右半仍 idle / 就绪后
 *   点右半 → 撤销 + 焦点不在卡内 + 文件框照常点得开），累计 64 项。
 *
 * Push 205（业务口径 2026-09-28「这里应该先填发现的问题 才能填另外三个」+「明日计划也是必填项」）：
 *   ① 「现场发现问题」= **前置开关** —— 为空时「问题归类 / 当前问题附图 / 解决方案或建议」三项**禁用**（灰底灰字点不开：
 *      归类按钮 disabled、附图卡整卡灰底且两半点不开 / 文件框 disabled、建议框 disabled 且占位提示换「非空后可填」），
 *      填了立即解禁、清空又回禁用；「现场工作附图」不受影响（对照组）；② 「明日计划」改**必填** —— 标签补红色必填星、
 *      未填时「提交日报」置灰且提示还差「明日计划」（提交成功后表单复位也清明日计划）。③ 组断言拆分 + ② 组补必填星，
 *      新增 ⑤d 组（前置开关 6 项：开局禁用 / 建议占位 / 对照组 / 填后解禁 / 解禁后粘贴就绪 / 清空回禁用），累计 72 项。
 *
 * Push 206（业务口径 2026-09-28「这个日报记录要大一点效果要如图二所示」+「图三还是文字提示改成图四的吧 然后用户填写后换行
 *   填到表格后也要是换行的」）：
 *   ① 「日报记录」整表放大 —— 表格字号 = 14px（text-sm）+ 行内边距 = 16px（py-4）+ 表头 = 14px（py-3.5）；
 *   ② 「当日完成工作 / 明日计划」两列 white-space: pre-line —— 回放按**真键盘 Enter** 分行填写，提交后表格里按行换行显示；
 *   ③ 「现场工作附图」列 = **大图瓦片**（128×96 · 只出图不带文件名、名字进 title —— 业务样 = 图 2）；
 *   ④ 分点提示曾按图 4 复落（1: / 2: / 3: 三行灰字）并随「这个现场问题也要同上」扩到「现场发现问题」，随后按业务口径
 *      「有了自动的扩展 那这个提示就不要了」**整体撤回** —— ② 组断言改为：全表单 0 处提示 + 空框聚焦预置 1: + 失焦还原空；
 *   ⑤ 同批追加（业务口径「自动添加序号可以做到吗」+「这个现场问题也要同上」）：「当日完成工作 / 明日计划 / 现场发现问题」
 *      三个多行框**自动序号** —— 聚焦空框预置 1: 、回车自动带下一行序号（2: / 3: …）、失焦 / 提交前统一重排
 *      （剥旧号 / 去空行 / 重编）；「1: 」不算填（清空回前置开关禁用）；
 *   ⑥ 同批再追加（业务口径「换行很多时要自动下扩」）：「日报填写」四个多行框改 GrowingTextarea 自动下扩 —— 高度随行数长
 *      （下限 = 原 rows 行）、不出内滚动条。② 组 +4（提示下架对照 + 预置 + 失焦还原 + 自动下扩），③ 组 +1（回车自动补 2:），
 *      ④ 组 +3（整表字号 / 边距 / pre-line / 明日计划换行保留），⑤c 组 +1（大图瓦片尺寸 + 名字隐去），
 *      ⑤d 组 +1（现场发现问题同套自动序号：真键盘 Enter 补 2:），累计 82 项。
 *
 * Push 206 续（业务口径 2026-09-28「写点静态数据到日报的一系列记录里面去」）：日报 / 问题演示数据由「只挂示例项目 inmu-0010」
 *   改为**所有项目共用一份**（`frontend/src/data/reports.ts`：reportsForProject / issuesForProject 不再按项目过滤）——
 *   静态日报 6 篇扩到 **9 篇**（2026年9月14日 ~ 9月21日、覆盖 已提交 / 补填 / 草稿 三态），静态问题 5 条扩到 **7 条**
 *   （Push 207 起三态：未解决 3 / 处理中 2 / 已完成 2）；演示附图由「只有名字」改为**内联 SVG 占位图**（离线可用）——
 *   「日报记录」附图列的大图瓦片对静态数据同样成立。④ 组 +1（静态序列到位：10 行 + 最旧 9月14日）、
 *   ⑤b 行数断言 1 → 10（静态 9 + 本批 1），累计 83 项。
 *
 * Push 207（业务口径 2026-09-28「责任这一栏不需要 删除吧」+「状态改成图二的三种」+「取消未分组 未分组就是未解决」+
 *   「问题归类也要用不同颜色来展示」+「格式参考这种 然后处理时限不需要 所属任务也不需要」+「文字标题参考图五的来」+
 *   「整体列表样式参考图6 项目总览页面」+「这些图标不需要」+「这个也要1 2 3 同上」）：问题侧整批改版回放 —— 新增 ⑦ 组；
 *   ① 「问题追踪」表头 = 图五六列（日期 / 问题描述 / 问题归类 / 解决方案或建议 / 问题附图 / 问题是否处理）**纯文字**
 *      （首版列头小图标 + 排序小漏斗随后按「这些图标不需要」下架）；表内无「责任 / 处理时限 / 所属任务 / 未分组」；
 *      行样式 = 图六（px-5 py-2.5 / 1px zinc-100 细线 / 真鼠标悬停 rgba(250,250,250,0.8) / 表头 zinc-50 12px zinc-400）；
 *   ② 状态三态色签 = 项目总览「任务状态」同款（未解决 bg-sky-100/text-sky-700 · 处理中 bg-amber-100/text-amber-800 · 已完成 bg-emerald-100/text-emerald-700）、归类彩色胶囊
 *      （供应商原因 / 客户原因 / 客观原因 / 机械部 / 规划部 / 物流原因 六色实证）、问题附图 40×40 缩略图 + 空行「—」；
 *   ③ 本批提交一篇带「现场发现问题 + 当前问题附图」的日报 → 自动生成的问题落表首（7 → 8 行、状态 = 未解决、
 *      描述按行换行、归类彩色胶囊、附图 blob 缩略图 —— `Issue.photos` 新数据面贯通）；
 *   ④ 问题看板 = 三列（未解决 / 处理中 / 已完成 · 四态 → 三态）、列头色签 = 图二、卡片撤三项、i-01 演示数据并进「未解决」；
 *   ⑤ ⑤e 组 +4（「解决方案或建议」解禁后同套自动序号：空框聚焦预置 1: / 真键盘 Enter 续 2: / 失焦重排三行 / 清空还原）
 *      —— 累计 105 项。
 *
 *
 * Push 209（业务口径 2026-09-28「问题看板是这样的 要这些内容 然后样式参考任务进展的」+「点击要出现抽屉 是关于这个问题的日报内容」）：
 *   问题看板整批改版回放 —— 新增 ⑨ 组；① 列壳 / 卡片材质 / 列内与列间滚动条 = 「任务进展」看板同款
 *   （280px 列宽、列高随视口封顶 52rem、列底无灰面板、ScrollArea 隐式滚动条；卡片 = 35px 圆角白壳 + 三层投影 + 6% 细纹）；
 *   ② 卡面 = 业务样「图一」四段（问题描述 / 问题归类 / 解决方案或建议 / 问题附图 · 状态签 / 提出人 / 日期词下架）；
 *   ③ 点卡片 = 「问题详情」抽屉（业务样图二：上半问题本身 + 中间「关联阶段」常显一行 + 下半来源日报 r-0921a 内容；Push 212 撤折叠区），
 *   壳 = 任务抽屉同一套全局动画类 + 打开锁滚动 + Esc / 点遮罩关闭。
 *
 * Push 210（业务口径 2026-09-28「卡片要可以拖动」）：问题看板卡片拖动回放 —— 新增 ⑩ 组；与「任务进展」看板
 *   同一套指针拖动口径（阈值 4px / 拖动卡跟手 / 目标列描边高亮 + 落点槽 / 放开改状态 / 同列不是落点 / Esc 取消），
 *   含「未过阈值仍算点击」反向实证；⑩ 组跑完把 i-01 拖回「未解决」（与 ⑧ / ⑨ 组基线一致）。
 *
 * Push 211（业务口径 2026-09-28「要加问题描述标题」）：问题看板卡面首段补「问题描述」字段名 —— ⑨ 组追加 1 项（11px 浅灰小字 / 在描述正文上方 / 首段不带上间距）；其余断言与 ⑩ 组不动。
 *
 * Push 212（业务口径 2026-09-28「只保留关联阶段 且不需要隐藏」）：问题详情抽屉撤「已隐藏 · N」折叠区 —— ⑨ 组把原
 *   「折叠区默认收起 / 点开折叠区」两断言替换为「撤折叠区（无开关 + 五枚次要字段下架 + 总数 12）」+「关联阶段常显一行
 *   （硬件实施 / 试运行 两枚色签）」。
 *   同批（业务口径「抽屉里面可以编辑内容」）+ 续（业务口径「图片也要可以增删」）：⑨ 组追加 9 项 —— 七个触发器在场 / 只读行
 *   无触发器 / 两张附图 = 可增删贴图区（compact · 不套虚线框；点 × 删 1 枚 + 点粘贴小图标 Ctrl+V 粘 1 枚实证）/ 浮层里 Esc 只关浮层 / 焦点在触发器上按
 *   Esc 也只关浮层（Push 212 续修：InlineEdit 浮层开着时拦冒泡，外层抽屉不跟着关）/ 抽屉里改「问题描述」保存落值 + 头部提出时间不变 /
 *   看板卡与「问题追踪」表联动（同一份内存态 · 含附图联动）。
 *   续（业务口径「ctrl v 的地方改成这个图标吧」）：贴图区左半「Ctrl + V」文字换成业务给的**剪贴板图标**（1024 视框 · 3 枚 path ·
 *   fill=currentColor · 20px 与右半同档；表单仍用 card 形态）—— ⑤c 原「文案 = Ctrl + V」断言改写为「左半 = 图标（文字退场）」+
 *   「左半图标为业务那枚（3 path / currentColor / 20×20）」两断言，纯文字材质与垂直居中两条照旧按**图标**口径核（条数不变）。
 *   再续（业务口径「框太大了 不需要」）：**问题详情抽屉**里两张附图改用 AttachmentPicker 的 **compact 形态** —— 不套虚线大卡，
 *   入口 = 两枚 28px 小图标（粘贴 / 选文件）；⑨ 组贴图区断言同步按「无边框（border-width=0）+ 半高 ≤ 32」核（「日报填写」表单仍是虚线卡）。
 *   再续（业务口径「两个图标不协调」）：两枚入口图标**线重归一** —— 粘贴图标（业务手绘 1024 视框）原字形只占视框 81%、线圈仅 ~41 单位
 *   （16px 下 ≈0.68px），只有右半「文件 + 云」的一半粗、且字形偏小；本批把视框收到 "40 40 944 944" 并给 strokeWidth="38"
 *   （**三条 path 形状一笔未动**）：等效线圈 ≈ (40.92 + 38) / 944 ≈ 8.36% 盒宽 ≈ 右半 2 / 24 ≈ 8.33%，字形占宽 ≈ 91.7% ≈ 右半 22 / 24；
 *   ⑨ 组 +1（两枚入口图标线重差 <1% · 同高 16px 档）。
 * 前置（四件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-report-stage-assoc-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / REPLAY_PROJECT / PG_MODULE
 *
 * 夹具：一条**临时会话**（跑完撤销）+ 真实英国项目（回放用户 = 项目经理，**只读**打开；日报提交是内存态、不落库）。
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);

const { Client } = pg;
const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9403);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const PROJECT_ID = process.env.REPLAY_PROJECT ?? "5a127946-526e-43be-8ff6-3b8d356ba70a";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
/** 换行符（Push 206「用户填写后换行 填到表格后也要是换行的」回放口径：真键盘 Enter 插入、断言单元格里保留）。 */
const LF = String.fromCharCode(10);
/** 自动序号后的预期文本（Push 206 续 renumberLines 口径 = 逐行 1: / 2: / 3: 前缀 + LF 连接）。 */
const NUMLINE = (text) => String(text).split(LF).map((line, index) => String(index + 1) + ": " + line).join(LF);
const j = (value) => JSON.stringify(value);
const STAGES = ["售前规划", "设计开发", "加工采购", "组装发货", "硬件实施", "软件部署", "试运行", "生产阶段", "验收"];
const PICK = ["硬件实施", "试运行"];
const REPORT_HEADERS = ["时间time", "填写者", "关联阶段Related stages", "当日完成工作Work completed today", "明日计划Tomorrow's plan", "现场工作附图On-site photos"];
const STATE_WORDS = ["已提交", "草稿", "补填"];
const DROPPED_HEADERS = ["今日施工人数", "现场发现问题", "解决方案或建议"];
/** Push 207：问题追踪六列表头（业务样 = 图五）+ 整表里不该再出现的四词。 */
const ISSUE_HEADERS = ["日期", "问题描述", "问题归类", "解决方案或建议", "问题附图", "问题是否处理"];
/** 问题归类字典（C9 十项 · 与前端 ISSUE_CATEGORIES 同一份口径）：⑧ 组行内多选按它现选现比。 */
const CATEGORY_NAMES = ["机械部", "采购部", "规划部", "项目部", "物流原因", "供应商原因", "客户原因", "客观原因", "生产原因", "其它"];
const ISSUE_DROPPED = ["责任", "处理时限", "所属任务", "未分组"];
const NOT_A_STAGE = "布局定档";
const DONE_TEXT = "回放·关联阶段·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + LF + "回放·完成工作第二行·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const PLAN_TEXT_0 = "回放·首篇日报·明日计划·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + LF + "回放·计划第二行·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxstage-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-report-stage-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const profile = mkdtempSync(join(tmpdir(), "pxstage-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });

async function waitTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const target = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) { /* 未就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Chrome 未就绪");
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("ws error")));
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(JSON.stringify(msg.error))); else item.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("cdp timeout: " + method)); }, 15000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const COOKIE = "ll_sid=" + token + "; ll_csrf=" + csrf;
async function api(path, method = "GET", body, extra) {
  const headers = Object.assign({ Cookie: COOKIE, "X-CSRF-Token": csrf, Accept: "application/json" }, extra || {});
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (error) { json = null; }
  return { status: res.status, json, text };
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: ok === true, detail: detail === undefined ? "" : String(detail) });
  console.log((ok === true ? "PASS  " : "FAIL  ") + name + (detail === undefined ? "" : "   [" + detail + "]"));
}

const target = await waitTarget();
const page = new Cdp(target.webSocketDebuggerUrl);
await page.ready;
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
// 无头页默认「不聚焦」——浏览器粘贴命令只在聚焦文档里可用（Push 202 同批续：真实 Ctrl+V 回放用）
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) {
    throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300) + " | 表达式：" + expression.slice(0, 160));
  }
  return reply.result.value;
};
/** 同 ev，但等页面 Promise 落地（真实剪贴板写入这类异步操作用；userGesture = 给一次瞬时激活）。 */
const evAwait = async (expression, userGesture) => {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (userGesture === true) {
    params.userGesture = true;
  }
  const reply = await page.send("Runtime.evaluate", params);
  if (reply.exceptionDetails !== undefined) {
    return "THROWN:" + JSON.stringify(reply.exceptionDetails).slice(0, 200);
  }
  return reply.result.value;
};
async function waitFor(expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await ev(expression)) === true) return true;
    await sleep(250);
  }
  return false;
}
async function openHash(hashPath) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + PROJECT_ID + hashPath });
  await sleep(5200);
}
async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(700);
}
async function rectOf(selector) {
  return await ev(
    "(() => { const node = document.querySelector(" + j(selector) + ");" +
    " if (node === null) { return null; }" +
    " node.scrollIntoView({ block: " + j("nearest") + ", inline: " + j("nearest") + " });" +
    " const box = node.getBoundingClientRect();" +
    " if (box.width === 0 || box.height === 0) { return null; }" +
    " return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; })()"
  );
}
async function clickSelector(selector) {
  const point = await rectOf(selector);
  if (point === null || point === undefined) throw new Error("点不到（元素不存在或不可见）：" + selector);
  await clickAt(point);
  return point;
}
/** 真鼠标拖拽（Push 210 卡片拖动回放）：按下 → 分步移动（真指针事件；落点判定 elementFromPoint 也成立）→
 *  midProbe 中途探针（可在探针里按 Esc 等）→ 放开；返回中途探针值。 */
async function dragCard(from, to, midProbe) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, buttons: 0 });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / 8);
    const y = Math.round(from.y + ((to.y - from.y) * step) / 8);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(45);
  }
  await sleep(260);
  const mid = typeof midProbe === "function" ? await midProbe() : null;
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(420);
  return mid;
}

async function pressKey(key, code, vk, modifiers = 0) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(350);
}
async function typeInto(selector, text) {
  await clickSelector(selector);
  await pressKey("a", "KeyA", 65, 2);
  const parts = String(text).split(LF);
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) {
      // Push 206：真键盘回车换行（textarea 里 Enter = 插入换行符；字符随 keyDown 下发）——「用户填写后换行」口径
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: String.fromCharCode(13), unmodifiedText: String.fromCharCode(13) });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await sleep(160);
    }
    await page.send("Input.insertText", { text: parts[i] });
    await sleep(160);
  }
  await sleep(420);
}
/** 1×1 红色 PNG（真实剪贴板写入用；手搓字节 + 手写 CRC32，避免引入依赖 / 依赖 Node 版本）。 */
function pngBytes() {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(Buffer.from([0, 255, 64, 32]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** 表单内某枚阶段 checkbox 的标签中心（真实鼠标点标签 = 勾选）。 */
async function clickStageLabel(text) {
  const point = await ev(
    "(function(){var box=document.querySelector(" + j('[data-field="stages"]') + ");if(box===null){return null;}" +
    "var ls=box.querySelectorAll(" + j("label") + ");for(var i=0;i<ls.length;i++){if(ls[i].textContent.trim()===" + j(text) + "){" +
    "ls[i].scrollIntoView({block:" + j("center") + "});var r=ls[i].getBoundingClientRect();" +
    "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()"
  );
  if (point === null || point === undefined) throw new Error("点不到阶段标签：" + text);
  await clickAt(point);
}
/** 表单探针：字段标题 / 说明 / 选项清单 / 勾选数。 */
function formExpr() {
  return "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
    "var box=f.querySelector(" + j('[data-field="stages"]') + ");var inputs=box===null?[]:box.querySelectorAll(" + j('input[type=checkbox]') + ");" +
    "var labels=[];var checked=0;for(var i=0;i<inputs.length;i++){if(inputs[i].checked){checked++;}" +
    "var row=inputs[i].closest(" + j("label") + ");labels.push(row===null?" + j("") + ":row.textContent.trim());}" +
    "return {text:(f.textContent||" + j("") + "),hasBox:box!==null,count:inputs.length,labels:labels,checked:checked};})()";
}

// ---------- ⓪ 偏好预置（Push 207 醒目模式回放） ----------
// 醒目模式按账号存服务端（users/me/preferences 的 focusMode）：上一轮中断可能残留 true，会把 ⑦ 组
//「正常模式色签 / 行悬停」断言污染 —— 先把基线压回 false（进厂原值记下、收尾还原），页面随本次导航读到「关」。
const prefsBefore = await api("/api/v1/users/me/preferences");
const focusOriginal = prefsBefore.status === 200 && prefsBefore.json !== null ? prefsBefore.json.focusMode === true : false;
const prefBaseline = await api("/api/v1/users/me/preferences", "PATCH", { focusMode: false });
check("⓪ 偏好预置：focusMode 压回 false（进厂原值 " + String(focusOriginal) + " · 收尾还原）—— 醒目模式按账号存服务端，保证本轮从「关」开跑",
  prefBaseline.status === 200 && prefBaseline.json !== null && prefBaseline.json.focusMode === false,
  "status=" + String(prefBaseline.status) + " · focusMode=" + (prefBaseline.json === null ? "-" : String(prefBaseline.json.focusMode)));

// ---------- ① 打开「日报及问题 → 日报填写」 ----------
await openHash("?view=daily");
const subnavReady = await waitFor("document.querySelectorAll(" + j("[data-subnav-item]") + ").length===4");
check("① 项目详情「日报及问题」打开：页内四键帽导航（日报填写 / 日报记录 / 问题追踪 / 问题看板）", subnavReady === true, String(subnavReady));
const tabIcons = await ev(
  "(function(){var out=[];var bs=document.querySelectorAll(" + j("[data-subnav-item]") + ");" +
  "for(var i=0;i<bs.length;i++){var svg=bs[i].querySelector(" + j("svg") + ");var p=svg===null?null:svg.querySelector(" + j("path") + ");" +
  "out.push({tab:bs[i].getAttribute(" + j("data-subnav-item") + "),viewBox:svg===null?null:svg.getAttribute(" + j("viewBox") + ")," +
  "stroke:svg===null?null:svg.getAttribute(" + j("stroke") + "),paths:svg===null?-1:svg.querySelectorAll(" + j("path") + ").length," +
  "rects:svg===null?-1:svg.querySelectorAll(" + j("rect") + ").length," +
  "fill:p===null?" + j("") + ":(p.getAttribute(" + j("fill") + ")||" + j("") + ")," +
  "fillRule:p===null?null:(p.getAttribute(" + j("fill-rule") + ")||p.getAttribute(" + j("fillRule") + "))," +
  "d:p===null?" + j("") + ":(p.getAttribute(" + j("d") + ")||" + j("") + ")});}return out;})()"
);
const boardIcon = Array.isArray(tabIcons) ? tabIcons.filter((item) => item.tab === "问题看板")[0] : undefined;
check("① 问题看板项图标 = 业务给样「放大镜」（24 视框 · path M9.5 17… · fill=currentColor · fillRule=evenodd · Push 201 换）",
  boardIcon !== undefined && boardIcon.viewBox === "0 0 24 24" && boardIcon.d.indexOf("M9.5 17c1.71") === 0 &&
  boardIcon.fill === "currentColor" && boardIcon.fillRule === "evenodd" && boardIcon.stroke === null,
  boardIcon === undefined ? "-" : boardIcon.viewBox + " · " + boardIcon.d.slice(0, 12) + " · fill=" + String(boardIcon.fill) + " · rule=" + String(boardIcon.fillRule));
check("① 问题看板项原「圆环 + 感叹号」徽章已让位（viewBox 不再 16×16 · d 不再 M7.493 开头）",
  boardIcon !== undefined && boardIcon.viewBox !== "0 0 16 16" && boardIcon.d.indexOf("M7.493") < 0,
  boardIcon === undefined ? "-" : boardIcon.viewBox + " · " + boardIcon.d.slice(0, 10));
const trackIcon = Array.isArray(tabIcons) ? tabIcons.filter((item) => item.tab === "问题追踪")[0] : undefined;
check("① 问题追踪项图标 = 「圆环 + 感叹号」面性徽章（16×16 · path M7.493 0.015… · fill=currentColor · 原「问题看板」样让位）",
  trackIcon !== undefined && trackIcon.viewBox === "0 0 16 16" && trackIcon.d.indexOf("M7.493 0.015") === 0 &&
  trackIcon.fill === "currentColor" && trackIcon.stroke === null,
  trackIcon === undefined ? "-" : trackIcon.viewBox + " · " + trackIcon.d.slice(0, 12) + " · fill=" + String(trackIcon.fill));
check("① 问题追踪项原「文件 + 警示圈」浅版图标已下架（无 24 视框 · 无 M13.5 3H6.75 文件页 · 无 M17.2 12.9 警示环）",
  trackIcon !== undefined && trackIcon.viewBox !== "0 0 24 24" && trackIcon.d.indexOf("M13.5 3H6.75") < 0 && trackIcon.d.indexOf("17.2 12.9") < 0,
  trackIcon === undefined ? "-" : "viewBox=" + String(trackIcon.viewBox));
const strokeTabs = Array.isArray(tabIcons) ? tabIcons.filter((item) => item.tab !== "问题看板" && item.tab !== "问题追踪") : [];
check("① 其余两项导航图标照旧描边（stroke = currentColor · 共 2 项）",
  strokeTabs.length === 2 && strokeTabs.every((item) => item.stroke === "currentColor"),
  strokeTabs.map((item) => item.tab + ":" + String(item.stroke)).join(" / "));
const formReady = await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const form0 = await ev(formExpr());
check("① 「日报填写」表单就位（默认停在第一块）", formReady === true && form0 !== null, form0 === null ? "no form" : "ok");

// ---------- ② 字段标题 / 说明 / 选项口径 ----------
check("② 字段标题 = 「关联阶段」", form0 !== null && form0.text.indexOf("关联阶段") >= 0, form0 === null ? "-" : String(form0.text.indexOf("关联阶段")));
check("② 表单不再出现「关联任务」（词已随口径移除）", form0 !== null && form0.text.indexOf("关联任务") < 0, form0 === null ? "-" : "index=" + String(form0.text.indexOf("关联任务")));
check("② 说明不再提「回写任务「项目进展描述」」", form0 !== null && form0.text.indexOf("回写") < 0, form0 === null ? "-" : "index=" + String(form0.text.indexOf("回写")));
check("② 多选项容器 [data-field=stages] 就位", form0 !== null && form0.hasBox === true, form0 === null ? "-" : String(form0.hasBox));
const labels0 = form0 === null ? [] : form0.labels;
check("② 选项 = 恰好九枚、顺序 = 售前规划 → 验收（九阶段口径）", labels0.length === 9 && STAGES.every((name, index) => labels0[index] === name), labels0.join(" / "));
check("② 选项**不再列任务名**（对照组：真实任务「" + NOT_A_STAGE + "」不在表单里）", form0 !== null && form0.labels.indexOf(NOT_A_STAGE) < 0 && form0.text.indexOf(NOT_A_STAGE) < 0, "labels=" + String(labels0.length));
check("② 开局 0 勾选", form0 !== null && form0.checked === 0, form0 === null ? "-" : "checked=" + String(form0.checked));
const holdProbe = await ev(
  "(function(){var d=document.querySelector(" + j('[data-fill-form] textarea[data-field="doneWork"]') + ");" +
  "var p=document.querySelector(" + j('[data-fill-form] textarea[data-field="plan"]') + ");" +
  "var f=document.querySelector(" + j('[data-fill-form] textarea[data-field="foundIssue"]') + ");" +
  "return {done:d===null?null:d.getAttribute(" + j("placeholder") + "),plan:p===null?null:p.getAttribute(" + j("placeholder") + "),found:f===null?null:f.getAttribute(" + j("placeholder") + ")};})()"
);
check("② 三个多行框**框内**无占位提示（placeholder 皆空 —— Push 202 撤占位；框上方静态分点提示随后也整体撤回，见下三条）",
  holdProbe !== null && holdProbe.done === null && holdProbe.plan === null && holdProbe.found === null,
  holdProbe === null ? "-" : JSON.stringify(holdProbe));
check("② 表头双语：当日完成工作Work completed today / 明日计划Tomorrow's plan / 现场发现问题Problem（图 1 / 图 3 口径）",
  form0 !== null && form0.text.indexOf("当日完成工作Work completed today") >= 0 && form0.text.indexOf("明日计划Tomorrow's plan") >= 0 && form0.text.indexOf("现场发现问题Problem") >= 0,
  form0 === null ? "-" : "ok");
const planLabelProbe = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "var ss=f.querySelectorAll(" + j("span") + ");for(var i=0;i<ss.length;i++){if(ss[i].textContent.trim().indexOf(" + j("明日计划Tomorrow's plan") + ")===0){" +
  "var kid=ss[i].querySelector(" + j("span") + ");" +
  "return {weight:getComputedStyle(ss[i]).fontWeight,star:kid===null?" + j("") + ":kid.textContent.trim(),starClass:kid===null?" + j("") + ":String(kid.className)};}}return null;})()"
);
check("② 表单字段标题加粗（「明日计划Tomorrow's plan」标签 computed font-weight = 700 · 业务口径「标题都标标粗」）",
  planLabelProbe !== null && planLabelProbe.weight === "700", planLabelProbe === null ? "-" : String(planLabelProbe.weight));
check("② 「明日计划」标签带红色必填星 *（Push 205 业务口径「明日计划也是必填项」· text-rose-500）",
  planLabelProbe !== null && planLabelProbe.star === "*" && String(planLabelProbe.starClass).indexOf("text-rose-500") >= 0,
  planLabelProbe === null ? "-" : JSON.stringify({ star: planLabelProbe.star, cls: planLabelProbe.starClass }));

const hintGoneProbe = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "return {count:f.querySelectorAll(" + j("[data-field-hint]") + ").length};})()"
);
check("② 框上方静态分点提示整体下架（Push 206 按图 4 复落的 1: / 2: / 3: 三行提示，随后按业务口径「有了自动的扩展 那这个提示就不要了」撤回 —— 全表单 [data-field-hint] = 0 处）",
  hintGoneProbe !== null && hintGoneProbe.count === 0, hintGoneProbe === null ? "-" : "count=" + String(hintGoneProbe.count));
const presetSel = "[data-fill-form] textarea[data-field=foundIssue]";
await clickSelector(presetSel);
await sleep(420);
const presetProbe = await ev("(function(){var t=document.querySelector(" + j(presetSel) + ");return t===null?null:{value:t.value,focused:document.activeElement===t};})()");
check("② 提示撤回后由自动序号兜底：空框聚焦预置「1: 」（「现场发现问题」也已并进同一套 · 业务口径「这个现场问题也要同上」）",
  presetProbe !== null && presetProbe.focused === true && String(presetProbe.value) === "1: ",
  presetProbe === null ? "-" : JSON.stringify(presetProbe));
await clickSelector("[data-fill-form] [data-field=projectName]");
await sleep(420);
const presetResetProbe = await ev("(function(){var t=document.querySelector(" + j(presetSel) + ");return t===null?null:String(t.value);})()");
check("② 空框只聚焦、没写内容 → 失焦还原为空（「1: 」不算有效内容 —— 也不把「现场发现问题」算成已填）",
  presetResetProbe === "", JSON.stringify(presetResetProbe));
// ② 续（Push 206 续 · 业务口径「换行很多时要自动下扩」）：多行框高度随行数长高且不出内滚动条
const growSel = "[data-fill-form] textarea[data-field=plan]";
const growBefore = await ev("(function(){var t=document.querySelector(" + j(growSel) + ");return t===null?null:Math.round(t.getBoundingClientRect().height);})()");
await typeInto(growSel, "甲乙丙" + LF + "第二行" + LF + "第三行" + LF + "第四行" + LF + "第五行");
const growProbe = await ev("(function(){var t=document.querySelector(" + j(growSel) + ");if(t===null){return null;}return {h:Math.round(t.getBoundingClientRect().height),sh:t.scrollHeight,ch:t.clientHeight};})()");
check("② 「明日计划」多行框自动下扩（换行多时随内容长高 · 无内滚动条：scrollHeight = clientHeight · 业务口径「换行很多时要自动下扩」）",
  growBefore !== null && growProbe !== null && Number(growProbe.h) > Number(growBefore) && Number(growProbe.sh) <= Number(growProbe.ch) + 1,
  JSON.stringify({ before: growBefore, after: growProbe }));
await clickSelector(growSel);
await pressKey("a", "KeyA", 65, 2);
await pressKey("Backspace", "Backspace", 8);
await sleep(320);
// ---------- ③ 真实鼠标勾选 + 填完成工作 + 提交 ----------
await clickStageLabel(PICK[0]);
await clickStageLabel(PICK[1]);
const form1 = await ev(formExpr());
check("③ 真实鼠标勾选「" + PICK[0] + "」「" + PICK[1] + "」→ 2 勾选", form1 !== null && form1.checked === 2, form1 === null ? "-" : "checked=" + String(form1.checked));
await typeInto("[data-fill-form] textarea[data-field=\"doneWork\"]", DONE_TEXT);
const autoNoProbe = await ev("(function(){var d=document.querySelector(" + j("[data-fill-form] textarea[data-field=doneWork]") + ");return d===null?null:{value:d.value};})()");
check("③ 「当日完成工作」回车自动补下一行序号（真键盘 Enter → 换行 + 2: 前缀 · 业务口径「自动添加序号可以做到吗」）",
  autoNoProbe !== null && String(autoNoProbe.value).indexOf(LF + "2: ") >= 0,
  autoNoProbe === null ? "-" : JSON.stringify(autoNoProbe.value));
const doneOnlyProbe = await ev(
  "(function(){var b=document.querySelector(" + j("[data-fill-form] button[data-action=\"submit\"]") + ");" +
  "var t=document.querySelector(" + j("[data-fill-hint]") + ");" +
  "return {enabled:b===null?null:b.disabled===false,hint:t===null?" + j("") + ":String(t.textContent).trim()};})()"
);
check("③ 只填「当日完成工作」→「提交日报」仍置灰、提示还差「明日计划」（Push 205「明日计划也是必填项」）",
  doneOnlyProbe !== null && doneOnlyProbe.enabled === false && String(doneOnlyProbe.hint).indexOf("明日计划") >= 0,
  doneOnlyProbe === null ? "-" : JSON.stringify(doneOnlyProbe));
await typeInto("[data-fill-form] textarea[data-field=\"plan\"]", PLAN_TEXT_0);
const submitEnabled = await ev("(function(){var b=document.querySelector(" + j("[data-fill-form] button[data-action=\"submit\"]") + ");return b===null?null:b.disabled===false;})()");
check("③ 再填「明日计划」后「提交日报」可点（必填齐：时间 + 当日完成工作 + 明日计划）", submitEnabled === true, String(submitEnabled));
await clickSelector('[data-fill-form] button[data-action="submit"]');
const switched = await waitFor("(function(){var b=document.querySelector(" + j('[data-subnav-item="日报记录"]') + ");return b!==null && b.getAttribute(" + j("aria-current") + ")===" + j("page") + ";})()");
check("③ 提交后自动切到「日报记录」子视图", switched === true, String(switched));

// ---------- ④ 日报记录：列头（Push 199 收窄后六列）/ 最新一行 ----------
const headers = await ev(
  "(function(){var ts=document.querySelectorAll(" + j("table") + ");for(var i=0;i<ts.length;i++){" +
  "var hs=ts[i].querySelectorAll(" + j("thead th") + ");var out=[];for(var k=0;k<hs.length;k++){out.push(hs[k].textContent.trim());}" +
  "if(out.indexOf(" + j("关联阶段Related stages") + ")>=0||out.indexOf(" + j("关联任务") + ")>=0){return out;}}return null;})()"
);
check("④ 日报记录表头含「关联阶段Related stages」", Array.isArray(headers) && headers.indexOf("关联阶段Related stages") >= 0, Array.isArray(headers) ? headers.join(" / ") : String(headers));
check("④ 日报记录表头不再有「关联任务」", Array.isArray(headers) && headers.indexOf("关联任务") < 0, Array.isArray(headers) ? "ok" : "-");
check("④ 日报记录表头 = 恰好六列且中英拼写（时间time / 填写者 / 关联阶段Related stages / 当日完成工作Work completed today / 明日计划Tomorrow's plan / 现场工作附图On-site photos · Push 202）",
  Array.isArray(headers) && headers.length === 6 && REPORT_HEADERS.every((name, index) => headers[index] === name),
  Array.isArray(headers) ? headers.join(" / ") : String(headers));
check("④ 日报记录表头不含「今日施工人数 / 现场发现问题 / 解决方案或建议」（Push 199 只保留内容列）",
  Array.isArray(headers) && DROPPED_HEADERS.every((word) => headers.indexOf(word) < 0), Array.isArray(headers) ? "ok" : "-");
const rowProbe = await ev(
  "(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}" +
  "var tds=r.querySelectorAll(" + j("td") + ");var t=r.closest(" + j("table") + ");var th=t===null?null:t.querySelector(" + j("thead th") + ");" +
  "return {id:r.getAttribute(" + j("data-report-row") + "),cells:tds.length,font:t===null?" + j("") + ":getComputedStyle(t).fontSize," +
  "tdPad:tds[0]===undefined?" + j("") + ":getComputedStyle(tds[0]).paddingTop,thPad:th===null?" + j("") + ":getComputedStyle(th).paddingTop," +
  "time:tds[0]===undefined?" + j("") + ":tds[0].textContent.trim()," +
  "dateWeight:tds[0]===undefined?" + j("") + ":(function(){var p=tds[0].querySelector(" + j("[data-report-date]") + ");return p===null?" + j("") + ":getComputedStyle(p).fontWeight;})()," +
  "dateClass:tds[0]===undefined?" + j("") + ":(function(){var p=tds[0].querySelector(" + j("[data-report-date]") + ");return p===null?" + j("") + ":String(p.className);})()," +
  "stage:(function(){var td=tds[2];if(td===undefined){return " + j("") + ";}var cs=td.querySelectorAll(" + j("[data-report-stage]") + ");if(cs.length===0){return td.textContent.trim();}var a=[];for(var i=0;i<cs.length;i++){a.push(cs[i].getAttribute(" + j("data-report-stage") + "));}return a.join(" + j("、") + ");})(),done:tds[3]===undefined?" + j("") + ":tds[3].textContent.trim()," +
  "doneWhite:tds[3]===undefined?" + j("") + ":getComputedStyle(tds[3]).whiteSpace," +
  "plan:tds[4]===undefined?" + j("") + ":tds[4].textContent.trim(),planWhite:tds[4]===undefined?" + j("") + ":getComputedStyle(tds[4]).whiteSpace," +
  "text:(r.textContent||" + j("") + ")};})()"
);
const issueProbes = await ev("document.querySelectorAll(" + j("[data-report-issue-link]") + ").length");
check("④ 最新一行 = 6 个单元格（与收窄后的列头一一对齐）", rowProbe !== null && rowProbe.cells === 6, rowProbe === null ? "-" : String(rowProbe.cells));
check("④ 列表已无问题记录探针 [data-report-issue-link]（该列随 Push 199 移除）", issueProbes === 0, String(issueProbes));
check("④ 最新一行关联阶段列 = 「" + PICK[0] + "、" + PICK[1] + "」", rowProbe !== null && rowProbe.stage === PICK[0] + "、" + PICK[1], rowProbe === null ? "-" : String(rowProbe.stage));
check("④ 最新一行「当日完成工作」= 回放文本（自动序号 1: / 2: + 用户换行保留 · 真键盘 Enter 分行填写）", rowProbe !== null && rowProbe.done === NUMLINE(DONE_TEXT) && rowProbe.done.indexOf(LF) >= 0, rowProbe === null ? "-" : String(rowProbe.done));
check("④ 整表放大（Push 206 业务口径「日报记录要大一点 效果如图二」）：表格字号 = 14px（text-sm）+ 行内边距 = 16px（py-4）+ 表头 = 14px（py-3.5）",
  rowProbe !== null && rowProbe.font === "14px" && rowProbe.tdPad === "16px" && rowProbe.thPad === "14px",
  rowProbe === null ? "-" : JSON.stringify({ font: rowProbe.font, tdPad: rowProbe.tdPad, thPad: rowProbe.thPad }));
check("④ 「当日完成工作 / 明日计划」两列 white-space: pre-line（用户填写换行 → 填到表格后也按行换行显示）",
  rowProbe !== null && rowProbe.doneWhite === "pre-line" && rowProbe.planWhite === "pre-line",
  rowProbe === null ? "-" : JSON.stringify({ done: rowProbe.doneWhite, plan: rowProbe.planWhite }));
check("④ 最新一行「明日计划」= 回放文本（自动序号 1: / 2: + 用户换行保留 —— 第二处 pre-line 实证）",
  rowProbe !== null && rowProbe.plan === NUMLINE(PLAN_TEXT_0) && rowProbe.plan.indexOf(LF) >= 0, rowProbe === null ? "-" : String(rowProbe.plan));
const CN_DATE = /^\d{4}年\d{1,2}月\d{1,2}日$/;
check("④ 最新一行时间列 = 年月日（YYYY年M月D日 · 业务口径「时间格式也要年月日」）且不带「提交 HH:MM」小字",
  rowProbe !== null && CN_DATE.test(rowProbe.time) && rowProbe.text.indexOf("提交") < 0, rowProbe === null ? "-" : String(rowProbe.time));
check("④ 最新一行时间列**去加粗**（Push 207 业务口径「问题追踪里面的时间不用加粗」· 业务样 = 日报记录时间列）：字重 = 400（原 font-semibold 600 下架）+ 字色对齐「问题追踪」日期列（text-zinc-700）",
  rowProbe !== null && rowProbe.dateWeight === "400" && String(rowProbe.dateClass).indexOf("font-semibold") < 0 && String(rowProbe.dateClass).indexOf("text-zinc-700") >= 0,
  rowProbe === null ? "-" : JSON.stringify({ w: rowProbe.dateWeight, cls: rowProbe.dateClass }));
check("④ 最新一行不再有状态签（已提交 / 草稿 / 补填 三词都不在行内 · 业务口径「已提交状态也不要」）",
  rowProbe !== null && STATE_WORDS.every((word) => rowProbe.text.indexOf(word) < 0), rowProbe === null ? "-" : "ok");
const seriesProbe = await ev(
  "(function(){var rows=document.querySelectorAll(" + j("[data-report-row]") + ");if(rows.length===0){return null;}" +
  "var tds=rows[rows.length-1].querySelectorAll(" + j("td") + ");" +
  "return {n:rows.length,oldest:tds[0]===undefined?" + j("") + ":tds[0].textContent.trim()};})()"
);
check("④ 日报记录带一串静态演示数据（Push 206 续「写点静态数据到日报的一系列记录里面去」）：本批提交 1 篇 + 静态 9 篇 = 10 行、最旧 = 2026年9月14日",
  seriesProbe !== null && seriesProbe.n === 10 && seriesProbe.oldest === "2026年9月14日",
  seriesProbe === null ? "-" : JSON.stringify(seriesProbe));

// ---------- ⑤ 回「日报填写」表单复位 ----------
await clickSelector('[data-subnav-item="日报填写"]');
const backReady = await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const form2 = await ev(formExpr());
check("⑤ 回「日报填写」：表单复位（勾选 0 / 完成工作与明日计划清空）", backReady === true && form2 !== null && form2.checked === 0 && form2.text.indexOf(DONE_TEXT) < 0 && form2.text.indexOf(PLAN_TEXT_0) < 0, form2 === null ? "-" : "checked=" + String(form2.checked));

// ---------- ⑤b 暂存草稿（Push 202：保留表单内容 / 不写记录 / 不切子视图）+ 问题归类多选（业务口径「问题归类可以多选」） ----------
const STAMP = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const PLAN_TEXT = "回放·明日计划·" + STAMP;
const ISSUE_TEXT = "回放·现场问题·" + STAMP;
await typeInto('[data-fill-form] textarea[data-field="plan"]', PLAN_TEXT);
await typeInto('[data-fill-form] textarea[data-field="foundIssue"]', ISSUE_TEXT);
await clickStageLabel(PICK[0]);
await clickSelector('[data-field="issueCategory"] button');
const multiOpen = await waitFor("document.querySelector(" + j("[data-multi-popover]") + ")!==null");
check("⑤b 问题归类多选弹层可打开（[data-multi-popover] 就位 · Push 202 该字段由单选改多选）", multiOpen === true, String(multiOpen));
await clickSelector('[data-multi-option="物流原因"]');
await clickSelector('[data-multi-option="供应商原因"]');
const multiProbe = await ev(
  "(function(){var pop=document.querySelector(" + j("[data-multi-popover]") + ");if(pop===null){return null;}" +
  "var sel=pop.querySelectorAll(" + j('[role="option"][aria-selected="true"]') + ");var names=[];for(var i=0;i<sel.length;i++){names.push(sel[i].getAttribute(" + j("data-multi-option") + "));}" +
  "var box=document.querySelector(" + j('[data-field="issueCategory"]') + ");" +
  "return {sel:names,trigger:box===null?" + j("") + ":box.textContent.trim()};})()"
);
check("⑤b 勾选「物流原因」「供应商原因」→ 2 项绿勾（aria-selected · 弹层点选不关闭）",
  multiProbe !== null && multiProbe.sel.length === 2 && multiProbe.sel.indexOf("物流原因") >= 0 && multiProbe.sel.indexOf("供应商原因") >= 0,
  multiProbe === null ? "-" : multiProbe.sel.join(" / "));
check("⑤b 触发器显示已选两项（顿号连接）", multiProbe !== null && multiProbe.trigger.indexOf("物流原因、供应商原因") >= 0, multiProbe === null ? "-" : String(multiProbe.trigger));
await pressKey("Escape", "Escape", 27);
const multiClosed = await waitFor("document.querySelector(" + j("[data-multi-popover]") + ")===null");
check("⑤b Esc 关闭弹层（站点浮层同一套关闭口径）", multiClosed === true, String(multiClosed));
const draftPoint = await clickSelector('[data-fill-form] button[data-action="draft"]');
await sleep(400);
const draftHoverBg = await ev("(function(){var b=document.querySelector(" + j('[data-fill-form] button[data-action="draft"]') + ");return b===null?null:getComputedStyle(b).backgroundColor;})()");
check("⑤b 暂存草稿悬停反馈明显（指针停在按钮上时背景 = zinc-100（oklch(0.967 …) / rgb(244,244,245)）· 业务口径「鼠标放到暂存草稿的ui效果不太明显」）",
  draftHoverBg !== null && (String(draftHoverBg) === "rgb(244, 244, 245)" || String(draftHoverBg).indexOf("oklch(0.967") >= 0),
  String(draftHoverBg) + (draftPoint === null ? " · no point" : ""));
const draftNotice = await ev("(function(){var n=document.querySelector(" + j("[data-subnav-notice]") + ");return n===null?null:n.textContent.trim();})()");
check("⑤b 暂存草稿 → 顶部提示「已暂存」（不写记录 / 不切视图 / 不清表单）", draftNotice !== null && draftNotice.indexOf("已暂存") >= 0, draftNotice === null ? "-" : String(draftNotice));
const keptProbe = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "var plan=f.querySelector(" + j('textarea[data-field="plan"]') + ");var issue=f.querySelector(" + j('textarea[data-field="foundIssue"]') + ");" +
  "var box=f.querySelector(" + j('[data-field="stages"]') + ");var inputs=box===null?[]:box.querySelectorAll(" + j("input[type=checkbox]") + ");var checked=0;for(var i=0;i<inputs.length;i++){if(inputs[i].checked){checked++;}}" +
  "var cat=document.querySelector(" + j('[data-field="issueCategory"]') + ");" +
  "return {plan:plan===null?" + j("") + ":plan.value,issue:issue===null?" + j("") + ":issue.value,checked:checked,cat:cat===null?" + j("") + ":cat.textContent.trim()};})()"
);
check("⑤b 暂存后表单内容保留（明日计划 / 现场发现问题都带自动序号 1: / 勾选 1 阶段 / 归类两项 · 业务口径「暂存就保留表单里面填的内容皆可」）",
  keptProbe !== null && keptProbe.plan === NUMLINE(PLAN_TEXT) && keptProbe.issue === NUMLINE(ISSUE_TEXT) && keptProbe.checked === 1 && keptProbe.cat.indexOf("物流原因、供应商原因") >= 0,
  keptProbe === null ? "-" : JSON.stringify(keptProbe));
const stillFill = await ev("(function(){var b=document.querySelector(" + j('[data-subnav-item="日报填写"]') + ");return b!==null && b.getAttribute(" + j("aria-current") + ")===" + j("page") + ";})()");
check("⑤b 暂存后仍停在「日报填写」（不再自动切「日报记录」）", stillFill === true, String(stillFill));
await clickSelector('[data-subnav-item="日报记录"]');
await waitFor("document.querySelector(" + j("[data-report-row]") + ")!==null");
const rowsAfterDraft = await ev("document.querySelectorAll(" + j("[data-report-row]") + ").length");
check("⑤b 暂存不写「日报记录」（行数 = 静态演示 9 篇 + 本批提交 1 篇 = 10 行 · 暂存不增行 · Push 206 续）", rowsAfterDraft === 10, String(rowsAfterDraft));
await clickSelector('[data-subnav-item="日报填写"]');
await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");

// ---------- ⑤c 附图：以「复制粘贴」为主入口（Push 202 同批续 · Push 204 键帽改文字 + 纯文字垂直居中 · 业务口径「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」→「做成文字吧」→「位置要居中」） ----------
const PNG_B64 = pngBytes().toString("base64");
const zonesProbe = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "var photo=f.querySelector(" + j("[data-paste-zone=photos]") + ");var issue=f.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");" +
  "var fileInputs=f.querySelectorAll(" + j("input[type=file]") + ");" +
  "var ph=photo===null?null:photo.querySelector(" + j("[data-paste-half]") + ");var fh=photo===null?null:photo.querySelector(" + j("[data-file-half]") + ");" +
  "var cap=ph===null?null:ph.querySelector(" + j("svg") + ");" +
  "var pr=ph===null?null:ph.getBoundingClientRect();var cr=cap===null?null:cap.getBoundingClientRect();var fr=fh===null?null:fh.getBoundingClientRect();" +
  "var capBox=cr===null?" + j("") + ":(Math.round(cr.width)+" + j("x") + "+Math.round(cr.height));var fsvg=fh===null?null:fh.querySelector(" + j("svg") + ");var fr2=fsvg===null?null:fsvg.getBoundingClientRect();var fileBox=fr2===null?" + j("") + ":(Math.round(fr2.width)+" + j("x") + "+Math.round(fr2.height));" +
  "return {photo:photo!==null,issue:issue!==null,files:fileInputs.length," +
  "pasteSvg:ph===null?0:ph.querySelectorAll(" + j("svg") + ").length,pastePaths:cap===null?0:cap.querySelectorAll(" + j("path") + ").length,pasteFill:cap===null?" + j("") + ":String(cap.getAttribute(" + j("fill") + ")),pasteText:ph===null?" + j("") + ":ph.textContent.trim(),pasteAria:ph===null?" + j("") + ":String(ph.getAttribute(" + j("aria-label") + "))," +
  "capBgImage:ph===null?" + j("") + ":getComputedStyle(ph).backgroundImage," +
  "capShadow:ph===null?" + j("") + ":getComputedStyle(ph).boxShadow," +
  "capRadius:ph===null?" + j("") + ":getComputedStyle(ph).borderRadius," +
  "capBox:capBox,fileBox:fileBox,pasteHalfH:pr===null?0:Math.round(pr.height*100)/100,fileHalfH:fr===null?0:Math.round(fr.height*100)/100," +
  "capMidDelta:(pr===null||cr===null)?999:Math.round(((cr.top+cr.bottom)/2-(pr.top+pr.bottom)/2)*100)/100," +
  "fileSvg:fh===null?0:fh.querySelectorAll(" + j("svg") + ").length,fileText:fh===null?" + j("") + ":fh.textContent.trim(),fileAria:fh===null?" + j("") + ":String(fh.getAttribute(" + j("aria-label") + "))};})()"
);
check("⑤c 两个附图区（现场工作附图 / 当前问题附图）常驻 = 虚线卡左右分半：左半**剪贴板图标**（Ctrl+V 主入口 · Push 212 续按业务口径「ctrl v 的地方改成这个图标吧」由文字换图）+ 右半文件 / 云图标（点击选择文件 · 原生文件框仍 2 个 · 两半无说明文字）",
  zonesProbe !== null && zonesProbe.photo === true && zonesProbe.issue === true && zonesProbe.files === 2 &&
  zonesProbe.pasteSvg === 1 && zonesProbe.pasteText === "" && zonesProbe.pasteAria.indexOf("Ctrl+V") >= 0 &&
  zonesProbe.fileSvg === 1 && zonesProbe.fileText === "" && zonesProbe.fileAria.indexOf("选择文件") >= 0,
  zonesProbe === null ? "-" : JSON.stringify(zonesProbe));
check("⑤c 左半图标 = 业务给的那枚（1024 视框 · 3 枚 path · fill=currentColor 随字色 · 20×20 与右半同档；「Ctrl + V」文字退场）",
  zonesProbe !== null && zonesProbe.capBox === "20x20" && zonesProbe.fileBox === "20x20" && zonesProbe.pastePaths === 3 && zonesProbe.pasteFill === "currentColor" && zonesProbe.pasteText === "",
  zonesProbe === null ? "-" : JSON.stringify({ capBox: zonesProbe.capBox, fileBox: zonesProbe.fileBox, paths: zonesProbe.pastePaths, fill: zonesProbe.pasteFill, text: zonesProbe.pasteText }));
check("⑤c 左半仍是裸入口（键帽材质不回来：无渐变底 / 无投影 / 无圆角 —— 「做成文字吧」的材质口径对图标同样成立）",
  zonesProbe !== null && zonesProbe.capBgImage === "none" && zonesProbe.capShadow === "none" && zonesProbe.capRadius === "0px",
  zonesProbe === null ? "-" : JSON.stringify({ bg: zonesProbe.capBgImage, shadow: zonesProbe.capShadow, radius: zonesProbe.capRadius }));
check("⑤c 左半图标垂直居中（业务口径「位置要居中」：h-full 撑满右半图标定高行 —— 图标中线 = 半区中线 ±1px、两半等高 ±1px）",
  zonesProbe !== null && Math.abs(zonesProbe.capMidDelta) <= 1 && Math.abs(zonesProbe.pasteHalfH - zonesProbe.fileHalfH) <= 1 && zonesProbe.pasteHalfH > 40,
  zonesProbe === null ? "-" : JSON.stringify({ capMidDelta: zonesProbe.capMidDelta, pasteHalfH: zonesProbe.pasteHalfH, fileHalfH: zonesProbe.fileHalfH }));
await clickSelector("[data-paste-zone=photos] [data-paste-half]");
const armedProbe = await ev(
  "(function(){var p=document.querySelector(" + j("[data-paste-zone=photos]") + ");var q=document.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");" +
  "var h=p===null?null:p.querySelector(" + j("[data-paste-hint]") + ");var h2=q===null?null:q.querySelector(" + j("[data-paste-hint]") + ");" +
  "var sink=p===null?null:p.querySelector(" + j("[data-paste-sink]") + ");var act=document.activeElement;" +
  "return {photo:h===null?null:h.getAttribute(" + j("data-paste-hint") + "),issue:h2===null?null:h2.getAttribute(" + j("data-paste-hint") + ")," +
  "sinkFocused:sink!==null && act===sink,activeTag:act===null?" + j("") + ":act.tagName};})()"
);
check("⑤c 真实鼠标点一下「现场工作附图」左半 → 就绪态（data-paste-hint=armed · 焦点落在不可见粘贴落点 INPUT 上 —— 浏览器只对有可编辑焦点的元素执行 Ctrl+V）· 未点的另一区仍 idle",
  armedProbe !== null && armedProbe.photo === "armed" && armedProbe.issue === "idle" && armedProbe.sinkFocused === true,
  armedProbe === null ? "-" : JSON.stringify(armedProbe));
// 业务口径「点击ctrl v 再点右侧图标就会卡ctrl v一直被点击的bug」：右半「选择文件」是文件入口，不置就绪态；
// 点过左半（就绪）再点右半要撤销就绪态 —— 原来卡片 tabIndex=0 + onFocus 会把浏览器焦点落点变成「点亮左半」、Ctrl+V 被一直劫持。
await ev("(function(){window.__fileHalfClicks=0;document.addEventListener(" + j("click") + ",function(e){if(e.target&&e.target.tagName===" + j("INPUT") + "&&e.target.type===" + j("file") + "){window.__fileHalfClicks+=1;}},true);return true;})()");
await clickSelector("[data-paste-zone=issuePhotos] [data-file-half]");
const fileHalfIdle = await ev(
  "(function(){var q=document.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");if(q===null){return null;}var h=q.querySelector(" + j("[data-paste-hint]") + ");" +
  "return {hint:h===null?null:h.getAttribute(" + j("data-paste-hint") + "),clicks:window.__fileHalfClicks||0};})()"
);
await clickSelector("[data-paste-zone=photos] [data-file-half]");
const fileHalfAfterArmed = await ev(
  "(function(){var p=document.querySelector(" + j("[data-paste-zone=photos]") + ");if(p===null){return null;}var h=p.querySelector(" + j("[data-paste-hint]") + ");" +
  "var sink=p.querySelector(" + j("[data-paste-sink]") + ");var act=document.activeElement;" +
  "return {hint:h===null?null:h.getAttribute(" + j("data-paste-hint") + "),sinkFocused:act===sink,inZone:p.contains(act),clicks:window.__fileHalfClicks||0};})()"
);
check("⑤c 右半「选择文件」不置就绪态：从 idle 点它仍 idle；点过左半（就绪）再点它 → 就绪态撤销（hint 回 idle · 焦点不再落在卡片 / 粘贴落点上），两半的文件框照常点得开（业务口径「点击ctrl v 再点右侧图标就会卡ctrl v一直被点击的bug」）",
  fileHalfIdle !== null && fileHalfIdle.hint === "idle" && fileHalfAfterArmed !== null && fileHalfAfterArmed.hint === "idle" &&
  fileHalfAfterArmed.sinkFocused === false && fileHalfAfterArmed.inZone === false && fileHalfIdle.clicks >= 1 && fileHalfAfterArmed.clicks >= 2,
  fileHalfIdle === null || fileHalfAfterArmed === null ? "-" : JSON.stringify({ idle: fileHalfIdle, afterArmed: fileHalfAfterArmed }));
await clickSelector("[data-paste-zone=photos] [data-paste-half]");
// 粘贴：优先「真实剪贴板 + 真实 Ctrl+V」（CDP 授权 + Input.dispatchKeyEvent，按键走浏览器 paste 加速键）；
// 剪贴板不可用（无头环境偶发）才回落合成 ClipboardEvent —— 两条路都打在真实 document 监听上。
await page.send("Browser.grantPermissions", { origin: FRONTEND, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
const clipWrite = await evAwait(
  "(async function(){try{var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
  "await navigator.clipboard.write([new ClipboardItem({" + j("image/png") + ":new Blob([arr],{type:" + j("image/png") + "})})]);return " + j("ok") + ";}catch(e){return " + j("ERR:") + "+String(e);}})()"
);
let pasteVia = "clipboard+ctrlv";
if (String(clipWrite) !== "ok") {
  pasteVia = "synthetic-event(" + String(clipWrite).slice(0, 60) + ")";
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
const chipsExpr = (zone) =>
  "(function(){var z=document.querySelector(" + j("[data-paste-zone=" + zone + "]") + ");if(z===null){return null;}" +
  "var wrap=z.parentElement;if(wrap===null){return null;}var cs=wrap.querySelectorAll(" + j("[data-attachment]") + ");var names=[];for(var i=0;i<cs.length;i++){names.push(cs[i].getAttribute(" + j("data-attachment") + "));}" +
  "return {names:names};})()";
const chipsAfterPaste = await ev(chipsExpr("photos"));
check("⑤c 粘贴一张图（" + pasteVia + "）→ 「现场工作附图」出现附件胶囊；剪贴板图无文件名 → 按「剪贴板图片-1.png」命名",
  chipsAfterPaste !== null && chipsAfterPaste.names.length === 1 && chipsAfterPaste.names[0] === "剪贴板图片-1.png",
  chipsAfterPaste === null ? "-" : JSON.stringify(chipsAfterPaste.names));
await clickSelector('[data-attachment="剪贴板图片-1.png"] button[data-action="remove-attachment"]');
const chipsAfterRemove = await ev(chipsExpr("photos"));
check("⑤c 附件胶囊可逐个移除（点 × 后「现场工作附图」回到 0 个附件）",
  chipsAfterRemove !== null && chipsAfterRemove.names.length === 0,
  chipsAfterRemove === null ? "-" : JSON.stringify(chipsAfterRemove.names));
await clickSelector("[data-paste-zone=issuePhotos] [data-paste-half]");
if (String(clipWrite) !== "ok") {
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
const chipsIssueZone = await ev(chipsExpr("issuePhotos"));
check("⑤c 「当前问题附图」同一套粘贴（点一下再 Ctrl+V）→ 该区也收到「剪贴板图片-1.png」",
  chipsIssueZone !== null && chipsIssueZone.names.length === 1 && chipsIssueZone.names[0] === "剪贴板图片-1.png",
  chipsIssueZone === null ? "-" : JSON.stringify(chipsIssueZone.names));

// ⑤c 续：图片可预览（业务口径「图片要可以预览」）—— 胶囊缩略图 / 点开大图 / Esc 关 / 记录列表出缩略图
const thumbExpr = (zone) =>
  "(function(){var z=document.querySelector(" + j("[data-paste-zone=" + zone + "]") + ");if(z===null){return null;}" +
  "var wrap=document.querySelector(" + j("[data-attachment-strip=" + zone + "]") + ");if(wrap===null){return null;}var t=wrap.querySelector(" + j("[data-attachment-thumb] img") + ");" +
  "return t===null?null:{src:String(t.getAttribute(" + j("src") + ")),alt:String(t.getAttribute(" + j("alt") + ")),w:Math.round(t.getBoundingClientRect().width)};})()";
const thumbProbe = await ev(thumbExpr("issuePhotos"));
check("⑤c 粘贴后的图片胶囊带**缩略图**（[data-attachment-thumb] <img> 预览地址 = blob: 同源地址 · 业务口径「图片要可以预览」）",
  thumbProbe !== null && String(thumbProbe.src).indexOf("blob:") === 0 && thumbProbe.w > 0,
  thumbProbe === null ? "-" : JSON.stringify(thumbProbe));
await clickSelector("[data-attachment-strip=issuePhotos] [data-attachment-thumb]");
const previewOpen = await waitFor("document.querySelector(" + j("[data-photo-preview]") + ")!==null");
const previewProbe = await ev("(function(){var p=document.querySelector(" + j("[data-photo-preview]") + ");if(p===null){return null;}var img=p.querySelector(" + j("img") + ");var r=p.getBoundingClientRect();return {src:img===null?" + j("") + ":String(img.getAttribute(" + j("src") + ")),w:Math.round(r.width),h:Math.round(r.height)};})()");
check("⑤c 点缩略图 → 大图预览层（[data-photo-preview]）打开：放大图 = 与缩略图同一 blob 地址、浮层铺满视口",
  previewOpen === true && previewProbe !== null && thumbProbe !== null && String(previewProbe.src) === String(thumbProbe.src) &&
  Number(previewProbe.w) >= 300 && Number(previewProbe.h) >= 300,
  previewProbe === null ? "-" : JSON.stringify(previewProbe));
await pressKey("Escape", "Escape", 27);
const previewClosed = await waitFor("document.querySelector(" + j("[data-photo-preview]") + ")==null");
check("⑤c Esc 关预览层（与站内浮层同一套关闭口径）", previewClosed === true, String(previewClosed));
// 记录列表也出缩略图：给「现场工作附图」再粘一张 → 填当日完成工作 → 提交 → 最新一行的附图列
await clickSelector("[data-paste-zone=photos] [data-paste-half]");
if (String(clipWrite) !== "ok") {
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
// 图片名称可以自定义（业务口径「图片名称可以自定义」）：点名字进编辑 → 改 → Enter；Esc 取消
await clickSelector("[data-attachment-strip=photos] [data-rename-attachment]");
const renameOpen = await waitFor("document.querySelector(" + j("[data-attachment-input]") + ")!==null");
check("⑤c 点附图名字进编辑态（[data-attachment-input] 就位 · 带原名）",
  renameOpen === true, String(renameOpen));
await ev("(function(){var i=document.querySelector(" + j("[data-attachment-input]") + ");if(i===null){return null;}i.select();return true;})()");
await page.send("Input.insertText", { text: "加" });
await pressKey("Escape", "Escape", 27);
await sleep(300);
const nameAfterEsc = await ev("(function(){var s=document.querySelector(" + j("[data-attachment-strip=photos]") + ");if(s===null){return null;}var b=s.querySelector(" + j("[data-rename-attachment]") + ");return b===null?null:b.getAttribute(" + j("aria-label") + ");})()");
check("⑤c Esc 取消改名：名字保持原样（" + "剪贴板图片-2.png" + "）",
  nameAfterEsc !== null && String(nameAfterEsc) === "重命名 剪贴板图片-2.png", String(nameAfterEsc));
await clickSelector("[data-attachment-strip=photos] [data-rename-attachment]");
await waitFor("document.querySelector(" + j("[data-attachment-input]") + ")!==null");
const extProbe = await ev(
  "(function(){var s=document.querySelector(" + j("[data-attachment-strip=photos]") + ");if(s===null){return null;}" +
  "var box=s.querySelector(" + j("[data-attachment]") + ");if(box===null){return null;}var inp=box.querySelector(" + j("[data-attachment-input]") + ");" +
  "return {text:box.textContent.trim(),value:inp===null?" + j("") + ":inp.value};})()"
);
check("⑤c 改名只改**主名**、后缀原位保留（业务口径「自定义把图片png格式删了怎么办」：输入框只装「剪贴板图片-2」、胶囊仍带灰字 .png）",
  extProbe !== null && String(extProbe.value) === "剪贴板图片-2" && String(extProbe.text).indexOf(".png") >= 0,
  extProbe === null ? "-" : JSON.stringify(extProbe));
await ev("(function(){var i=document.querySelector(" + j("[data-attachment-input]") + ");if(i===null){return null;}i.select();return true;})()");
await page.send("Input.insertText", { text: "滑槽磕碰-现场-01" });
await pressKey("Enter", "Enter", 13);
await sleep(300);
const renamedProbe = await ev("(function(){var s=document.querySelector(" + j("[data-attachment-strip=photos]") + ");if(s===null){return null;}var cs=s.querySelectorAll(" + j("[data-attachment]") + ");var names=[];for(var i=0;i<cs.length;i++){names.push(cs[i].getAttribute(" + j("data-attachment") + "));}return {names:names};})()");
check("⑤c 自定义图片名称：主名改成「滑槽磕碰-现场-01」（回车提交）→ 胶囊名 = 「滑槽磕碰-现场-01.png」（**后缀自动保留**）",
  renamedProbe !== null && renamedProbe.names.length === 1 && renamedProbe.names[0] === "滑槽磕碰-现场-01.png",
  renamedProbe === null ? "-" : JSON.stringify(renamedProbe.names));

const DONE_TEXT_2 = "回放·附图预览·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
await typeInto("[data-fill-form] textarea[data-field=doneWork]", DONE_TEXT_2);
await clickSelector("[data-fill-form] button[data-action=submit]");
await waitFor("document.querySelector(" + j("[data-report-row]") + ")!==null");
const rowThumb = await ev(
  "(function(){var rows=document.querySelectorAll(" + j("[data-report-row]") + ");if(rows.length===0){return null;}" +
  "var img=rows[0].querySelector(" + j("[data-attachment-thumb] img") + ");var chip=rows[0].querySelector(" + j("[data-attachment]") + ");" +
  "var box=img===null?null:img.getBoundingClientRect();" +
  "return {rows:rows.length,src:img===null?" + j("") + ":String(img.getAttribute(" + j("src") + ")),name:chip===null?" + j("") + ":String(chip.getAttribute(" + j("data-attachment") + "))," +
  "w:box===null?0:Math.round(box.width),h:box===null?0:Math.round(box.height)," +
  "title:chip===null?" + j("") + ":String(chip.getAttribute(" + j("title") + ")),chipText:chip===null?" + j("") + ":chip.textContent.trim()};})()"
);
check("⑤c 日报记录：最新一行「现场工作附图」列出缩略图（记录列表也能预览 · blob 地址 · 名字 = 自定义后的「滑槽磕碰-现场-01.png」）",
  rowThumb !== null && String(rowThumb.src).indexOf("blob:") === 0 && String(rowThumb.name).indexOf("滑槽磕碰-现场-01.png") >= 0,
  rowThumb === null ? "-" : JSON.stringify(rowThumb));
check("⑤c 日报记录附图 = 大图瓦片（Push 206 业务样 = 图 2）：128×96 + 只出图不带文件名（名字进 title）",
  rowThumb !== null && Number(rowThumb.w) === 128 && Number(rowThumb.h) === 96 && rowThumb.chipText === "" && String(rowThumb.title).indexOf("滑槽磕碰-现场-01.png") >= 0,
  rowThumb === null ? "-" : JSON.stringify({ w: rowThumb.w, h: rowThumb.h, chipText: rowThumb.chipText, title: rowThumb.title }));

// ---------- ⑤d 「现场发现问题」前置开关（Push 205 · 业务口径「这里应该先填发现的问题 才能填另外三个」+「明日计划也是必填项」） ----------
/** 前置开关探针：三个依赖项（问题归类 / 当前问题附图 / 解决方案或建议）+ 对照组「现场工作附图」的禁用态。 */
function gateExpr() {
  return "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
    "var cat=f.querySelector(" + j('[data-field="issueCategory"] button') + ");" +
    "var zone=document.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");" +
    "var zoneHalf=zone===null?null:zone.querySelector(" + j("[data-paste-half]") + ");" +
    "var zoneFile=zone===null?null:zone.querySelector(" + j("input[type=file]") + ");" +
    "var sug=f.querySelector(" + j('textarea[data-field="suggestion"]') + ");" +
    "var photo=f.querySelector(" + j("[data-paste-zone=photos]") + ");" +
    "var photoHalf=photo===null?null:photo.querySelector(" + j("[data-paste-half]") + ");" +
    "var photoFile=photo===null?null:photo.querySelector(" + j("input[type=file]") + ");" +
    "return {cat:cat===null?null:cat.disabled," +
    "zone:zone===null?" + j("") + ":zone.getAttribute(" + j("data-paste-disabled") + ")," +
    "zoneHalf:zoneHalf===null?null:zoneHalf.disabled,zoneFile:zoneFile===null?null:zoneFile.disabled," +
    "sug:sug===null?null:sug.disabled," +
    "sugPh:sug===null?" + j("") + ":String(sug.getAttribute(" + j("placeholder") + "))," +
    "photo:photo===null?" + j("") + ":photo.getAttribute(" + j("data-paste-disabled") + ")," +
    "photoHalf:photoHalf===null?null:photoHalf.disabled,photoFile:photoFile===null?null:photoFile.disabled};})()";
}
await clickSelector('[data-subnav-item="日报填写"]');
const gateReady = await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const gateStart = await ev(gateExpr());
check("⑤d 开局（未填「现场发现问题」）：「问题归类」禁用 + 「当前问题附图」整卡禁用（灰底 / 两半点不开 / 文件框禁用）",
  gateReady === true && gateStart !== null && gateStart.cat === true && gateStart.zone === "true" && gateStart.zoneHalf === true && gateStart.zoneFile === true,
  gateStart === null ? "-" : JSON.stringify(gateStart));
check("⑤d 同批：「解决方案或建议」禁用且占位提示 = 「（「现场发现问题」非空后可填）」（与「问题归类」禁用提示同一套）",
  gateStart !== null && gateStart.sug === true && String(gateStart.sugPh).indexOf("现场发现问题") >= 0 && String(gateStart.sugPh).indexOf("可填") >= 0,
  gateStart === null ? "-" : JSON.stringify({ sug: gateStart.sug, ph: gateStart.sugPh }));
check("⑤d 对照组：「现场工作附图」不受前置开关影响（卡未禁用 / 左半可点 / 文件框未禁用）",
  gateStart !== null && gateStart.photo === "false" && gateStart.photoHalf === false && gateStart.photoFile === false,
  gateStart === null ? "-" : JSON.stringify({ zone: gateStart.photo, half: gateStart.photoHalf, file: gateStart.photoFile }));
const GATE_TEXT = "回放·前置开关·" + STAMP;
await typeInto('[data-fill-form] textarea[data-field="foundIssue"]', GATE_TEXT);
// Push 206 续（业务口径「这个现场问题也要同上」）：现场发现问题同套自动序号 —— 真键盘 Enter 补下一行序号
await pressKey("Enter", "Enter", 13);
await page.send("Input.insertText", { text: "第二条" });
await sleep(360);
const gateNumberProbe = await ev("(function(){var t=document.querySelector(" + j("[data-fill-form] textarea[data-field=foundIssue]") + ");return t===null?null:String(t.value);})()");
check("⑤d 「现场发现问题」同套自动序号（真键盘 Enter → 换行 + 2: 前缀 · 业务口径「这个现场问题也要同上」）",
  gateNumberProbe !== null && gateNumberProbe.indexOf(LF + "2: ") >= 0, JSON.stringify(gateNumberProbe));
const gateOn = await ev(gateExpr());
check("⑤d 填「现场发现问题」→ 三项立即解禁（归类可点 / 附图卡与文件框解禁 / 建议框解禁且占位回「如：建议由采购…」）",
  gateOn !== null && gateOn.cat === false && gateOn.zone === "false" && gateOn.zoneHalf === false && gateOn.zoneFile === false &&
  gateOn.sug === false && String(gateOn.sugPh).indexOf("如：建议由采购") >= 0,
  gateOn === null ? "-" : JSON.stringify(gateOn));
// ⑤e Push 207 追加（业务口径「这个也要1 2 3 同上」）：解禁后的「解决方案或建议」同套自动序号 —— 空框聚焦预置 1: 、
//   真键盘 Enter 续号（2: / 3: …）、失焦 "renumberLines" 重排（与上三个多行框同一套口径）
await clickSelector("[data-fill-form] textarea[data-field=suggestion]");
await sleep(320);
const sugPresetProbe = await ev("(function(){var t=document.querySelector(" + j("[data-fill-form] textarea[data-field=suggestion]") + ");return t===null?null:{value:String(t.value),focused:document.activeElement===t};})()");
check("⑤e 「解决方案或建议」解禁后空框聚焦预置「1: 」（业务口径「这个也要1 2 3 同上」· 与前三个多行框同一套）",
  sugPresetProbe !== null && sugPresetProbe.focused === true && String(sugPresetProbe.value) === "1: ",
  sugPresetProbe === null ? "-" : JSON.stringify(sugPresetProbe.value));
await page.send("Input.insertText", { text: "回放·解决方案第一行" });
await pressKey("Enter", "Enter", 13);
await page.send("Input.insertText", { text: "回放·解决方案第二行" });
await page.send("Input.insertText", { text: LF + "回放·解决方案第三行" });
await sleep(360);
const sugNumberProbe = await ev("(function(){var t=document.querySelector(" + j("[data-fill-form] textarea[data-field=suggestion]") + ");return t===null?null:String(t.value);})()");
check("⑤e 真键盘 Enter → 换行 + 2: 前缀（第三行故意不带号，交失焦重排归位）",
  sugNumberProbe !== null && sugNumberProbe.indexOf(LF + "2: ") >= 0, JSON.stringify(sugNumberProbe));
await clickSelector("[data-fill-form] textarea[data-field=doneWork]");
await sleep(360);
const sugBlurProbe = await ev("(function(){var t=document.querySelector(" + j("[data-fill-form] textarea[data-field=suggestion]") + ");return t===null?null:String(t.value);})()");
check("⑤e 失焦重排 = 逐行 1: / 2: / 3: （renumberLines 兜底：第三行没号也补上）",
  sugBlurProbe !== null && sugBlurProbe === NUMLINE("回放·解决方案第一行" + LF + "回放·解决方案第二行" + LF + "回放·解决方案第三行"),
  JSON.stringify(sugBlurProbe));
await clickSelector("[data-fill-form] textarea[data-field=suggestion]");
await pressKey("a", "KeyA", 65, 2);
await pressKey("Backspace", "Backspace", 8);
await sleep(320);
const sugClearedProbe = await ev("(function(){var t=document.querySelector(" + j("[data-fill-form] textarea[data-field=suggestion]") + ");return t===null?null:String(t.value);})()");
check("⑤e 清空 → 还原为空（「1: 」只算预置不算内容 —— 与其它三框同口径）",
  sugClearedProbe === "", JSON.stringify(sugClearedProbe));

await clickSelector("[data-paste-zone=issuePhotos] [data-paste-half]");
const gateArmed = await ev("(function(){var z=document.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");var h=z===null?null:z.querySelector(" + j("[data-paste-hint]") + ");return h===null?null:h.getAttribute(" + j("data-paste-hint") + ");})()");
check("⑤d 解禁后「当前问题附图」粘贴就绪态照常（点左半 → armed，防禁用逻辑把正常粘贴锁死）", gateArmed === "armed", String(gateArmed));
await clickSelector('[data-fill-form] textarea[data-field="foundIssue"]');
await pressKey("a", "KeyA", 65, 2);
await pressKey("Backspace", "Backspace", 8);
await sleep(400);
const gateOff = await ev(gateExpr());
check("⑤d 清空「现场发现问题」→ 三项回禁用（联动实时：卡回灰底、归类与建议框再禁用）",
  gateOff !== null && gateOff.cat === true && gateOff.zone === "true" && gateOff.zoneHalf === true && gateOff.sug === true,
  gateOff === null ? "-" : JSON.stringify(gateOff));

// ---------- ⑥ 吸顶（Push 200 起 · Push 201 两层叠放 + 修三处 bug：投影外溢 / 吞字 / 接缝；业务口径「这个也做吸顶效果吧 图二吸顶后有bug」「这里的字被吞掉了」「这个中间有条缝可以有办法解决一下吗」） ----------
// ⑥ 前置：**未吸顶**时的静态几何 —— 横幅下沿不得压住下方内容（Push 201 补：负 mb 把区块标题吞掉 16px）
const GAP_EXPR =
  "(function(){var nav=document.querySelector(" + j("[data-subnav]") + ");if(nav===null){return null;}" +
  "var sib=nav.nextElementSibling;if(sib===null){return null;}var n=nav.getBoundingClientRect();var s=sib.getBoundingClientRect();" +
  "var head=sib.firstElementChild;var h=head===null?null:head.getBoundingClientRect();" +
  "return {scrollY:Math.round(window.scrollY),navTop:Math.round(n.top),navBottom:Math.round(n.bottom),sibTop:Math.round(s.top)," +
  "gap:Math.round(s.top-n.bottom),headTop:h===null?null:Math.round(h.top),stuck:Math.round(n.top)<=123};})()";
await ev("window.scrollTo(0, 0)");
await sleep(300);
const gapDaily = await ev(GAP_EXPR);
check("⑥ 页内导航栏不压住下方内容（未吸顶 · 日报填写：下一个兄弟 top ≥ 横幅下沿 +2px · 修「这里的字被吞掉了」）",
  gapDaily !== null && gapDaily.stuck === false && gapDaily.gap >= 2,
  gapDaily === null ? "-" : JSON.stringify(gapDaily));
await clickSelector('[data-subnav-item="问题看板"]');
await ev("window.scrollTo(0, 0)");
await sleep(400);
const gapBoard = await ev(GAP_EXPR);
check("⑥ 页内导航栏不压住下方内容（未吸顶 · 问题看板：区块标题整行露在横幅下沿之外）",
  gapBoard !== null && gapBoard.stuck === false && gapBoard.headTop !== null && gapBoard.headTop - gapBoard.navBottom >= 2,
  gapBoard === null ? "-" : JSON.stringify(gapBoard));
await clickSelector('[data-subnav-item="日报填写"]');
await sleep(400);
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 520, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await ev("window.scrollTo(0, 400)");
await sleep(350);
const stickProbe = await ev(
  "(function(){var bar=document.querySelector(" + j("[data-maintabs]") + ");var nav=document.querySelector(" + j("[data-subnav]") + ");" +
  "var header=document.querySelector(" + j("header") + ");if(bar===null||nav===null||header===null){return null;}" +
  "var b=bar.getBoundingClientRect();var n=nav.getBoundingClientRect();" +
  "var ks=nav.querySelectorAll(" + j("[data-subnav-item]") + ");var keyBottom=0;" +
  "for(var i=0;i<ks.length;i++){var kb=ks[i].getBoundingClientRect().bottom;if(kb>keyBottom){keyBottom=kb;}}" +
  "return {scrollY:Math.round(window.scrollY),headerBottom:Math.round(header.getBoundingClientRect().bottom)," +
  "barTop:Math.round(b.top),barBottom:Math.round(b.bottom),barPosition:getComputedStyle(bar).position,barZ:getComputedStyle(bar).zIndex," +
  "barBorder:parseFloat(getComputedStyle(bar).borderBottomWidth)," +
  "navTop:Math.round(n.top),navBottom:Math.round(n.bottom),navPosition:getComputedStyle(nav).position,navZ:getComputedStyle(nav).zIndex," +
  "shadowRoom:Math.round(n.bottom-keyBottom),visible:b.bottom>64&&b.top<window.innerHeight&&n.bottom>64&&n.top<window.innerHeight};})()"
);
check("⑥ 主标签栏吸顶：滚动后停在顶栏正下方（top = 64 · position: sticky · z-20 · 横幅仍可见）",
  stickProbe !== null && stickProbe.scrollY >= 300 && stickProbe.barPosition === "sticky" &&
  Math.abs(stickProbe.barTop - 64) <= 2 && Math.abs(stickProbe.barTop - stickProbe.headerBottom) <= 2 &&
  stickProbe.barZ === "20" && stickProbe.visible === true,
  stickProbe === null ? "-" : JSON.stringify(stickProbe));
check("⑥ 页内导航栏叠在主标签栏下面（top = 122 多叠 1px · 缝不变量 navTop ≤ 栏下沿 − 下边框宽 · position: sticky · z 更低不反压）",
  stickProbe !== null && stickProbe.navPosition === "sticky" && Math.abs(stickProbe.navTop - 122) <= 2 &&
  stickProbe.navTop <= stickProbe.barBottom - stickProbe.barBorder + 0.05 && Number(stickProbe.navZ) < Number(stickProbe.barZ),
  stickProbe === null ? "-" : "navTop=" + String(stickProbe.navTop) + " · barBottom=" + String(stickProbe.barBottom) + " − 下边框 " + String(stickProbe.barBorder) + " · z=" + String(stickProbe.navZ) + "/" + String(stickProbe.barZ));
check("⑥ 键帽投影兜进横幅：导航栏下内衬 ≥ 投影（nav 底 - 键帽底 ≥ 12px · Push 201 修「图二吸顶后有bug」）",
  stickProbe !== null && stickProbe.shadowRoom >= 12,
  stickProbe === null ? "-" : "shadowRoom=" + String(stickProbe.shadowRoom) + "px");
// ⑥b 项目总览：任务表头也叠在主标签栏下面（Push 201 重排 —— 原 top-16 会让主标签栏压住表头；
//     Push 201 再补「缝」—— top 122 多叠 1px + z 19 低于主标签栏，缩放屏下边框吸附变细也不露缝）
await clickSelector('[data-maintabs-item="项目总览"]');
const boardReady = await waitFor("document.querySelector(" + j("[data-board-head]") + ")!==null");
await ev("window.scrollTo(0, 600)");
await sleep(350);
const boardProbe = await ev(
  "(function(){var bar=document.querySelector(" + j("[data-maintabs]") + ");var head=document.querySelector(" + j("[data-board-head]") + ");" +
  "if(bar===null||head===null){return null;}var b=bar.getBoundingClientRect();var h=head.getBoundingClientRect();" +
  "return {scrollY:Math.round(window.scrollY),barBottom:Math.round(b.bottom),barBorder:parseFloat(getComputedStyle(bar).borderBottomWidth)," +
  "headTop:Math.round(h.top),headZ:getComputedStyle(head).zIndex,position:getComputedStyle(head).position};})()"
);
check("⑥ 项目总览：任务表头叠在主标签栏下面（表头 top = 122 多叠 1px · 缝不变量 headTop ≤ 栏下沿 − 下边框宽 · position: sticky · z 19）",
  boardReady === true && boardProbe !== null && boardProbe.scrollY >= 300 && boardProbe.position === "sticky" &&
  Math.abs(boardProbe.headTop - 122) <= 2 && boardProbe.headTop <= boardProbe.barBottom - boardProbe.barBorder + 0.05 &&
  Number(boardProbe.headZ) < 20,
  boardProbe === null ? "-" : JSON.stringify(boardProbe));
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("window.scrollTo(0, 0)");
await sleep(250);
await clickSelector('[data-maintabs-item="日报及问题"]');
await waitFor("document.querySelectorAll(" + j("[data-subnav-item]") + ").length===4");
// ---------- ⑦ 问题追踪 / 问题看板改版（Push 207 · 业务口径 2026-09-28「责任这一栏不需要 删除吧」+「状态改成图二的三种」+
//   「取消未分组 未分组就是未解决」+「问题归类也要用不同颜色来展示」+「格式参考这种 然后处理时限不需要 所属任务也不需要」+
//   「文字标题参考图五的来」+「整体列表样式参考图6 项目总览页面」+「这些图标不需要」） ----------
await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-row]") + ")!==null");
const issueTableProbe = await ev(
  "(function(){var t=document.querySelector(" + j("[data-issue-table]") + ");if(t===null){return null;}" +
  "var ths=t.querySelectorAll(" + j("thead th") + ");var heads=[];var svgs=0;for(var i=0;i<ths.length;i++){heads.push(ths[i].textContent.trim());svgs+=ths[i].querySelectorAll(" + j("svg") + ").length;}" +
  "var rows=t.querySelectorAll(" + j("[data-issue-row]") + ");var r2=rows[1]===undefined?null:rows[1];var tds=r2===null?null:r2.querySelectorAll(" + j("td") + ");var td0=tds===null||tds[0]===undefined?null:tds[0];" +
  "var rb=r2===null?null:getComputedStyle(r2);var thead=t.querySelector(" + j("thead") + ");var lineW=" + j("") + ";var lineColor=" + j("") + ";" +
  "if(rb!==null){if(rb.borderTopWidth!==" + j("0px") + "){lineW=rb.borderTopWidth;lineColor=rb.borderTopColor;}else if(rb.borderBottomWidth!==" + j("0px") + "){lineW=rb.borderBottomWidth;lineColor=rb.borderBottomColor;}}" +
  "return {n:rows.length,heads:heads,svgs:svgs,text:(t.textContent||" + j("") + ")," +
  "padTop:td0===null?" + j("") + ":getComputedStyle(td0).paddingTop,padLeft:td0===null?" + j("") + ":getComputedStyle(td0).paddingLeft," +
  "dateWeight:tds===null||tds[0]===undefined?" + j("") + ":getComputedStyle(tds[0]).fontWeight," +
  "lineW:lineW,lineColor:lineColor," +
  "thBg:thead===null?" + j("") + ":getComputedStyle(thead).backgroundColor,thColor:ths.length===0?" + j("") + ":getComputedStyle(ths[0]).color," +
  "thFont:ths.length===0?" + j("") + ":getComputedStyle(ths[0]).fontSize,tableFont:getComputedStyle(t.tagName===" + j("TABLE") + "?t:t.querySelector(" + j("table") + ")).fontSize};})()"
);
check("⑦ 问题追踪表头 = 图五六列（日期 / 问题描述 / 问题归类 / 解决方案或建议 / 问题附图 / 问题是否处理）",
  issueTableProbe !== null && issueTableProbe.heads.length === 6 && ISSUE_HEADERS.every((name, index) => issueTableProbe.heads[index] === name),
  issueTableProbe === null ? "-" : issueTableProbe.heads.join(" / "));
check("⑦ 列头为纯文字、无小图标（同批业务口径「这些图标不需要」—— 首版复刻的 6 枚图标 + 排序小漏斗整体下架 · svg = 0）",
  issueTableProbe !== null && issueTableProbe.svgs === 0, issueTableProbe === null ? "-" : "svg=" + String(issueTableProbe.svgs));
check("⑦ 表内无「责任 / 处理时限 / 所属任务 / 未分组」四词（撤三列 + 「未分组」并入「未解决」）",
  issueTableProbe !== null && ISSUE_DROPPED.every((word) => issueTableProbe.text.indexOf(word) < 0),
  issueTableProbe === null ? "-" : "ok");
check("⑦ 表头样式 = 图六（项目总览任务表）：底 zinc-50 / 字 12px zinc-400（Tailwind v4 屏下色值 = oklch，按容差核）",
  issueTableProbe !== null && (issueTableProbe.thBg === "rgb(250, 250, 250)" || String(issueTableProbe.thBg).indexOf("oklch(0.985") >= 0) && (issueTableProbe.thColor === "rgb(161, 161, 170)" || String(issueTableProbe.thColor).indexOf("oklch(0.705") >= 0) && issueTableProbe.thFont === "12px",
  issueTableProbe === null ? "-" : JSON.stringify({ bg: issueTableProbe.thBg, color: issueTableProbe.thColor, font: issueTableProbe.thFont }));
check("⑦ 问题追踪日期列同样不加粗（Push 207 同批口径「问题追踪里面的时间不用加粗」在两张表统一 · 字重 = 400）",
  issueTableProbe !== null && issueTableProbe.dateWeight === "400",
  issueTableProbe === null ? "-" : String(issueTableProbe.dateWeight));
check("⑦ 行样式 = 图六：px-5 py-2.5（左 20 / 上 10）+ 行间 1px zinc-100 细线 + 表体 14px（色值按 oklch 容差核）",
  issueTableProbe !== null && issueTableProbe.padLeft === "20px" && issueTableProbe.padTop === "10px" && issueTableProbe.lineW === "1px" && (issueTableProbe.lineColor === "rgb(244, 244, 245)" || String(issueTableProbe.lineColor).indexOf("0.967") >= 0) && issueTableProbe.tableFont === "14px",
  issueTableProbe === null ? "-" : JSON.stringify({ padLeft: issueTableProbe.padLeft, padTop: issueTableProbe.padTop, line: issueTableProbe.lineW, lineColor: issueTableProbe.lineColor, font: issueTableProbe.tableFont }));
check("⑦ 问题追踪行数 = 静态演示 7 条（三态覆盖：未解决 3 / 处理中 2 / 已完成 2 —— 切主标签后本面板复位重取）",
  issueTableProbe !== null && issueTableProbe.n === 7, issueTableProbe === null ? "-" : String(issueTableProbe.n));
const issueHoverPoint = await ev(
  "(function(){var rs=document.querySelectorAll(" + j("[data-issue-row]") + ");var r=rs[1];if(r===undefined){return null;}" +
  "r.scrollIntoView({block:" + j("center") + "});var b=r.getBoundingClientRect();return {x:Math.round(b.left+180),y:Math.round(b.top+b.height/2)};})()"
);
if (issueHoverPoint !== null) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: issueHoverPoint.x, y: issueHoverPoint.y, button: "none" });
  await sleep(500);
}
const issueHoverBg = await ev("(function(){var rs=document.querySelectorAll(" + j("[data-issue-row]") + ");return rs[1]===undefined?null:getComputedStyle(rs[1]).backgroundColor;})()");
check("⑦ 行悬停 = hover:bg-zinc-50/80（真鼠标停在行上实测：行底色不再全透明、alpha = 0.8 · 图六同款；Tailwind v4 的色写法按计算值容差核）",
  String(issueHoverBg) !== "rgba(0, 0, 0, 0)" && String(issueHoverBg).indexOf("0.8") >= 0, String(issueHoverBg));
const issueTagProbe = await ev(
  "(function(){var t=document.querySelector(" + j("[data-issue-table]") + ");if(t===null){return null;}" +
  "var tags=t.querySelectorAll(" + j("[data-issue-state]") + ");var states={};var order=[];var cls={};var fg={};for(var i=0;i<tags.length;i++){var s=tags[i].getAttribute(" + j("data-issue-state") + ");if(states[s]===undefined){states[s]=getComputedStyle(tags[i]).backgroundColor;fg[s]=getComputedStyle(tags[i]).color;cls[s]=String(tags[i].className);order.push(s);}}" +
  "var ref=document.createElement(" + j("span") + ");ref.style.position=" + j("absolute") + ";ref.style.visibility=" + j("hidden") + ";document.body.appendChild(ref);var refs={};" +
  "ref.className=" + j("bg-sky-100") + ";refs.skyBg=getComputedStyle(ref).backgroundColor;ref.className=" + j("text-sky-700") + ";refs.skyFg=getComputedStyle(ref).color;" +
  "ref.className=" + j("bg-amber-100") + ";refs.amberBg=getComputedStyle(ref).backgroundColor;ref.className=" + j("text-amber-800") + ";refs.amberFg=getComputedStyle(ref).color;" +
  "ref.className=" + j("bg-emerald-100") + ";refs.emeraldBg=getComputedStyle(ref).backgroundColor;ref.className=" + j("text-emerald-700") + ";refs.emeraldFg=getComputedStyle(ref).color;ref.remove();" +
  "var cats=t.querySelectorAll(" + j("[data-issue-category]") + ");var cmap={};for(var k=0;k<cats.length;k++){var c=cats[k].getAttribute(" + j("data-issue-category") + ");if(cmap[c]===undefined){cmap[c]=getComputedStyle(cats[k]).backgroundColor;}}" +
  "return {states:states,order:order,cls:cls,fg:fg,refs:refs,cats:cmap};})()"
);
check("⑦ 状态三态色签 = 项目总览「任务状态」同款（业务口径「这个问题的状态想要和项目总览里面的状态样式同款」）：未解决 = 待开始 蓝 / 处理中 = 进行中 琥珀 / 已完成 = emerald 绿 —— 同名 Tailwind 档（bg-*-100 + text-*-700/800）直接对齐 STATUS_CAPSULE_CLASS，计算色与参考元素逐一相等",
  issueTagProbe !== null && issueTagProbe.order.length === 3 &&
  issueTagProbe.cls["未解决"].indexOf("rounded-lg") >= 0 && issueTagProbe.cls["未解决"].indexOf("px-3") >= 0 && issueTagProbe.cls["未解决"].indexOf("py-1.5") >= 0 && issueTagProbe.cls["未解决"].indexOf("text-[11px]") >= 0 &&
  issueTagProbe.cls["未解决"].indexOf("bg-sky-100") >= 0 && issueTagProbe.cls["未解决"].indexOf("text-sky-700") >= 0 &&
  issueTagProbe.cls["处理中"].indexOf("bg-amber-100") >= 0 && issueTagProbe.cls["处理中"].indexOf("text-amber-800") >= 0 &&
  issueTagProbe.cls["已完成"].indexOf("bg-emerald-100") >= 0 && issueTagProbe.cls["已完成"].indexOf("text-emerald-700") >= 0 &&
  issueTagProbe.states["未解决"] === issueTagProbe.refs.skyBg && issueTagProbe.fg["未解决"] === issueTagProbe.refs.skyFg &&
  issueTagProbe.states["处理中"] === issueTagProbe.refs.amberBg && issueTagProbe.fg["处理中"] === issueTagProbe.refs.amberFg &&
  issueTagProbe.states["已完成"] === issueTagProbe.refs.emeraldBg && issueTagProbe.fg["已完成"] === issueTagProbe.refs.emeraldFg,
  issueTagProbe === null ? "-" : JSON.stringify({ states: issueTagProbe.states, fg: issueTagProbe.fg }));
check("⑦ 问题归类 = 彩色胶囊（业务样图三 / 图四）：供应商原因 黄 / 客户原因 红 / 客观原因 紫 / 机械部 蓝 / 规划部 绿（静态 7 条五色齐 · 物流原因在 ⑦b 新提交里核）",
  issueTagProbe !== null && issueTagProbe.cats["供应商原因"] === "rgb(255, 234, 153)" && issueTagProbe.cats["客户原因"] === "rgb(255, 181, 179)" &&
  issueTagProbe.cats["客观原因"] === "rgb(231, 180, 255)" && issueTagProbe.cats["机械部"] === "rgb(173, 203, 255)" &&
  issueTagProbe.cats["规划部"] === "rgb(172, 226, 197)",
  issueTagProbe === null ? "-" : JSON.stringify(issueTagProbe.cats));
const issuePhotoProbe = await ev(
  "(function(){var t=document.querySelector(" + j("[data-issue-table]") + ");if(t===null){return null;}" +
  "var imgs=t.querySelectorAll(" + j("[data-attachment-thumb] img") + ");var dash=0;var rows=t.querySelectorAll(" + j("[data-issue-row]") + ");" +
  "for(var i=0;i<rows.length;i++){var cs=rows[i].querySelectorAll(" + j("td") + ");if(cs[4]!==undefined && cs[4].textContent.trim()===" + j("—") + "){dash+=1;}}" +
  "var w=imgs.length===0?0:Math.round(imgs[0].getBoundingClientRect().width);var title=imgs.length===0?" + j("") + ":String(imgs[0].closest(" + j("[data-attachment]") + ").getAttribute(" + j("title") + "));" +
  "return {imgs:imgs.length,dash:dash,w:w,title:title};})()"
);
check("⑦ 问题附图列 = 40×40 缩略图（静态演示 5 枚 · 只出图不带文件名、名字进 title）+ 空行 = 「—」",
  issuePhotoProbe !== null && issuePhotoProbe.imgs === 5 && issuePhotoProbe.w === 40 && issuePhotoProbe.dash >= 1 && String(issuePhotoProbe.title).length > 0,
  issuePhotoProbe === null ? "-" : JSON.stringify(issuePhotoProbe));
// ⑦b 提交一篇带「现场发现问题 + 当前问题附图」的日报 → 自动生成的问题（未解决）落在问题追踪表首
await clickSelector("[data-subnav-item=" + Q + "日报填写" + Q + "]");
await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const FOUND_TEXT = "回放·问题三态·" + STAMP + LF + "回放·三态第二行";
await typeInto("[data-fill-form] textarea[data-field=doneWork]", "回放·问题三态·当日完成工作");
await typeInto("[data-fill-form] textarea[data-field=plan]", "回放·问题三态·明日计划");
await typeInto("[data-fill-form] textarea[data-field=foundIssue]", FOUND_TEXT);
await clickSelector("[data-paste-zone=issuePhotos] [data-paste-half]");
if (String(clipWrite) !== "ok") {
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
await clickSelector("[data-field=" + Q + "issueCategory" + Q + "] button");
await waitFor("document.querySelector(" + j("[data-multi-popover]") + ")!==null");
await clickSelector("[data-multi-option=" + Q + "供应商原因" + Q + "]");
await clickSelector("[data-multi-option=" + Q + "物流原因" + Q + "]");
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-multi-popover]") + ")===null");
await clickSelector("[data-fill-form] button[data-action=submit]");
await waitFor("document.querySelector(" + j("[data-report-row]") + ")!==null");
await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-row]") + ")!==null");
const newIssueProbe = await ev(
  "(function(){var rows=document.querySelectorAll(" + j("[data-issue-row]") + ");if(rows.length===0){return null;}var r=rows[0];var tds=r.querySelectorAll(" + j("td") + ");" +
  "var tag=r.querySelector(" + j("[data-issue-state]") + ");var chips=r.querySelectorAll(" + j("[data-issue-category]") + ");var catNames=[];var catColors={};for(var k=0;k<chips.length;k++){var cn=chips[k].getAttribute(" + j("data-issue-category") + ");catNames.push(cn);catColors[cn]=getComputedStyle(chips[k]).backgroundColor;}" +
  "var img=r.querySelector(" + j("[data-attachment-thumb] img") + ");" +
  "var p=tds[1]===undefined?null:tds[1].querySelector(" + j("[data-issue-title]") + ");" +
  "return {rows:rows.length,title:p===null?" + j("") + ":p.textContent,white:p===null?" + j("") + ":getComputedStyle(p).whiteSpace," +
  "state:tag===null?" + j("") + ":tag.getAttribute(" + j("data-issue-state") + ")," +
  "cat:catNames.join(" + j("/") + "),catColors:catColors,src:img===null?" + j("") + ":String(img.getAttribute(" + j("src") + "))};})()"
);
check("⑦ 提交带「现场发现问题」的日报 → 自动生成问题落表首（7 → 8 行）· 状态 = 未解决（原「未分组」并入 · 新问题初始态）",
  newIssueProbe !== null && newIssueProbe.rows === 8 && newIssueProbe.state === "未解决",
  newIssueProbe === null ? "-" : JSON.stringify({ rows: newIssueProbe.rows, state: newIssueProbe.state }));
check("⑦ 新问题描述 = 自动序号 1: / 2: + 用户换行保留（pre-line 实证）",
  newIssueProbe !== null && newIssueProbe.title === NUMLINE(FOUND_TEXT) && newIssueProbe.white === "pre-line",
  newIssueProbe === null ? "-" : String(newIssueProbe.title));
check("⑦ 新问题归类 = 表单多选「供应商原因 + 物流原因」→ 两枚彩色胶囊入表（物流原因灰 rgb(220,223,228) 补齐六色）",
  newIssueProbe !== null && newIssueProbe.cat === "供应商原因/物流原因" && newIssueProbe.catColors["物流原因"] === "rgb(220, 223, 228)",
  newIssueProbe === null ? "-" : JSON.stringify(newIssueProbe.catColors));
check("⑦ 新问题「问题附图」= 「当前问题附图」带入的 1 枚缩略图（blob 地址 · Issue.photos 数据面贯通）",
  newIssueProbe !== null && String(newIssueProbe.src).indexOf("blob:") === 0, newIssueProbe === null ? "-" : String(newIssueProbe.src).slice(0, 40));
// ⑦c 问题看板：三列 + 卡片撤三项 + i-01 演示数据并进「未解决」
await clickSelector("[data-subnav-item=" + Q + "问题看板" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-column]") + ")!==null");
const issueBoardProbe = await ev(
  "(function(){var b=document.querySelector(" + j("[data-issue-board]") + ");if(b===null){return null;}" +
  "var cols=b.querySelectorAll(" + j("[data-issue-column]") + ");var names=[];var colors=[];for(var i=0;i<cols.length;i++){names.push(cols[i].getAttribute(" + j("data-issue-column") + "));var tag=cols[i].querySelector(" + j("[data-issue-state]") + ");colors.push(tag===null?null:getComputedStyle(tag).backgroundColor);}" +
  "var card=document.querySelector(" + j("[data-issue-card=i-01]") + ");var cardCol=card===null?null:card.closest(" + j("[data-issue-column]") + ");" +
  "return {names:names,colors:colors,boardText:(b.textContent||" + j("") + "),i01:cardCol===null?" + j("") + ":cardCol.getAttribute(" + j("data-issue-column") + ")};})()"
);
check("⑦ 问题看板 = 三列（未解决 / 处理中 / 已完成 · 空列保留 —— 四态 → 三态）",
  issueBoardProbe !== null && issueBoardProbe.names.length === 3 && issueBoardProbe.names.join("/") === "未解决/处理中/已完成",
  issueBoardProbe === null ? "-" : issueBoardProbe.names.join(" / "));
check("⑦ 看板列头色签 = 与追踪表同一套（项目总览同款：未解决 蓝 / 处理中 琥珀 / 已完成 emerald 绿 —— 3 枚列头色值与表内逐一相等）",
  issueBoardProbe !== null && issueTagProbe !== null && issueBoardProbe.colors[0] === issueTagProbe.states["未解决"] && issueBoardProbe.colors[1] === issueTagProbe.states["处理中"] && issueBoardProbe.colors[2] === issueTagProbe.states["已完成"],
  issueBoardProbe === null ? "-" : JSON.stringify(issueBoardProbe.colors));
check("⑦ 看板卡片撤「责任 / 处理时限 / 所属任务」（业务口径「责任这一栏不需要 删除吧」+「处理时限不需要 所属任务也不需要」）",
  issueBoardProbe !== null && ISSUE_DROPPED.every((word) => issueBoardProbe.boardText.indexOf(word) < 0), issueBoardProbe === null ? "-" : "ok");
check("⑦ i-01 演示数据卡片落在「未解决」列（原「未分组」并入「未解决」· Push 209 起卡面不再出状态签，按所在列判）",
  issueBoardProbe !== null && issueBoardProbe.i01 === "未解决", issueBoardProbe === null ? "-" : String(issueBoardProbe.i01));

// ---------- ⑦d 醒目模式（Push 207 同批追加 · 业务口径「增加项目总览 同款醒目模式在问题追踪里面」+
//   「醒目模式放在标签导航栏的最右侧」） ----------
// 口径：开关 = 项目总览同款 FocusModeToggle，落在标签栏最右侧（日报及问题视图没有列显隐按钮）；区块标题行那份已撤；
// 开关与项目总览**共用同一账号偏好**（users/me/preferences 的 focusMode）；
// 开 = 问题表整行铺该问题状态的底色（6% / 悬停 12% · 状态列只留深色字），关 = 还原。
await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-row]") + ")!==null");
await waitFor("document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ")!==null");
await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 200, button: "none" });
await sleep(300);
const focusStartProbe = await ev(
  "(function(){var bar=document.querySelector(" + j("[data-maintabs]") + ");var input=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");" +
  "if(bar===null||input===null){return null;}" +
  "var label=input.closest(" + j("label") + ");var b=bar.getBoundingClientRect();var r=label===null?null:label.getBoundingClientRect();" +
  "var rows=document.querySelectorAll(" + j("[data-issue-row]") + ");var row=rows[1]===undefined?null:rows[1];" +
  "return {checked:input.checked,barCenter:Math.round(b.left+b.width/2),labelCenter:r===null?-1:Math.round(r.left+r.width/2)," +
  "gapRight:r===null?-1:Math.round(b.right-r.right),labelInside:r!==null&&r.top>=b.top-1&&r.bottom<=b.bottom+1," +
  "oldSpot:document.querySelector(" + j("[data-issue-focus]") + ")!==null," +
  "rowBg:row===null?" + j("") + ":getComputedStyle(row).backgroundColor};})()"
);
check("⑦ 醒目模式开关 = 标签栏最右侧（业务口径「醒目模式放在标签导航栏的最右侧」· 项目总览同款 FocusModeToggle · 区块标题行那份已撤 · 初始 = 关 · 行 = 正常模式透明底）",
  focusStartProbe !== null && focusStartProbe.checked === false &&
  focusStartProbe.labelCenter > focusStartProbe.barCenter &&
  focusStartProbe.gapRight >= 0 && focusStartProbe.gapRight <= 48 &&
  focusStartProbe.labelInside === true && focusStartProbe.oldSpot === false &&
  focusStartProbe.rowBg === "rgba(0, 0, 0, 0)",
  focusStartProbe === null ? "-" : JSON.stringify(focusStartProbe));
await clickSelector("[data-maintabs] label");
const focusTurnedOn = await waitFor(
  "(function(){var i=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");" +
  "var rs=document.querySelectorAll(" + j("[data-issue-row]") + ");if(i===null||rs[1]===undefined){return false;}" +
  "return i.checked===true&&getComputedStyle(rs[1]).backgroundColor!==" + j("rgba(0, 0, 0, 0)") + ";})()"
);
check("⑦ 醒目模式开关点得上（乐观更新：checked=true + 行底色离开透明）", focusTurnedOn === true, String(focusTurnedOn));
const focusOnProbe = await ev(
  "(function(){var table=document.querySelector(" + j("[data-issue-table]") + ");var input=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");" +
  "if(table===null||input===null){return null;}" +
  "var ref=document.createElement(" + j("span") + ");ref.style.position=" + j("absolute") + ";ref.style.visibility=" + j("hidden") + ";document.body.appendChild(ref);var refs={};" +
  "ref.className=" + j("bg-sky-500/[0.06]") + ";refs.rowSky=getComputedStyle(ref).backgroundColor;" +
  "ref.className=" + j("bg-amber-500/[0.06]") + ";refs.rowAmber=getComputedStyle(ref).backgroundColor;" +
  "ref.className=" + j("bg-emerald-500/[0.06]") + ";refs.rowEmerald=getComputedStyle(ref).backgroundColor;" +
  "ref.className=" + j("text-sky-700") + ";refs.skyFg=getComputedStyle(ref).color;" +
  "ref.className=" + j("text-amber-800") + ";refs.amberFg=getComputedStyle(ref).color;" +
  "ref.className=" + j("text-emerald-700") + ";refs.emeraldFg=getComputedStyle(ref).color;ref.remove();" +
  "var rows=table.querySelectorAll(" + j("[data-issue-row]") + ");var rowBg={};var tags={};" +
  "for(var i=0;i<rows.length;i++){var st=rows[i].querySelector(" + j("[data-issue-state]") + ");if(st===null){continue;}" +
  "var s=st.getAttribute(" + j("data-issue-state") + ");if(rowBg[s]!==undefined){continue;}" +
  "rowBg[s]=getComputedStyle(rows[i]).backgroundColor;" +
  "tags[s]={bg:getComputedStyle(st).backgroundColor,fg:getComputedStyle(st).color,weight:getComputedStyle(st).fontWeight,font:getComputedStyle(st).fontSize,cls:String(st.className)};}" +
  "return {checked:input===null?null:input.checked,refs:refs,rowBg:rowBg,tags:tags};})()"
);
check("⑦ 醒目模式打开：问题表整行铺该问题状态的底色（未解决 sky / 处理中 amber / 已完成 emerald —— 6% 马卡龙，与参考类计算色逐一相等）",
  focusOnProbe !== null && focusOnProbe.checked === true &&
  focusOnProbe.rowBg["未解决"] === focusOnProbe.refs.rowSky &&
  focusOnProbe.rowBg["处理中"] === focusOnProbe.refs.rowAmber &&
  focusOnProbe.rowBg["已完成"] === focusOnProbe.refs.rowEmerald &&
  String(focusOnProbe.rowBg["未解决"]).indexOf("/ 0.06") >= 0,
  focusOnProbe === null ? "-" : JSON.stringify(focusOnProbe.rowBg));
const focusHoverPoint = await ev(
  "(function(){var rs=document.querySelectorAll(" + j("[data-issue-row]") + ");var r=rs[1];if(r===undefined){return null;}" +
  "r.scrollIntoView({block:" + j("center") + "});var b=r.getBoundingClientRect();return {x:Math.round(b.left+180),y:Math.round(b.top+b.height/2)};})()"
);
if (focusHoverPoint !== null) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: focusHoverPoint.x, y: focusHoverPoint.y, button: "none" });
  await sleep(500);
}
const focusHoverProbe = await ev(
  "(function(){var r=document.querySelectorAll(" + j("[data-issue-row]") + ")[1];if(r===undefined){return null;}" +
  "var ref=document.createElement(" + j("span") + ");ref.style.position=" + j("absolute") + ";ref.style.visibility=" + j("hidden") + ";document.body.appendChild(ref);" +
  "ref.className=" + j("bg-sky-500/[0.12]") + ";var target=getComputedStyle(ref).backgroundColor;ref.remove();" +
  "return {bg:getComputedStyle(r).backgroundColor,target:target};})()"
);
check("⑦ 醒目模式行悬停抬到 12%（真鼠标停在行上实测：与参考类 bg-sky-500/[0.12] 计算色相等 · 留住「这一行可点」的手感）",
  focusHoverProbe !== null && focusHoverProbe.bg === focusHoverProbe.target && String(focusHoverProbe.bg).indexOf("/ 0.12") >= 0,
  focusHoverProbe === null ? "-" : JSON.stringify(focusHoverProbe));
check("⑦ 醒目模式状态列收口：撤色签胶囊、只留深色字（透明底 + 加粗 12px · 未解决 sky-700 / 处理中 amber-800 / 已完成 emerald-700 —— 同项目总览醒目模式口径）",
  focusOnProbe !== null &&
  focusOnProbe.tags["未解决"].bg === "rgba(0, 0, 0, 0)" && focusOnProbe.tags["未解决"].fg === focusOnProbe.refs.skyFg &&
  focusOnProbe.tags["处理中"].bg === "rgba(0, 0, 0, 0)" && focusOnProbe.tags["处理中"].fg === focusOnProbe.refs.amberFg &&
  focusOnProbe.tags["已完成"].bg === "rgba(0, 0, 0, 0)" && focusOnProbe.tags["已完成"].fg === focusOnProbe.refs.emeraldFg &&
  focusOnProbe.tags["未解决"].weight === "600" && focusOnProbe.tags["未解决"].font === "12px" &&
  String(focusOnProbe.tags["未解决"].cls).indexOf("rounded-lg") < 0,
  focusOnProbe === null ? "-" : JSON.stringify(focusOnProbe.tags));
const prefAfterOn = await api("/api/v1/users/me/preferences");
check("⑦ 醒目模式点击即单键 PATCH 落库（GET 偏好 focusMode = true —— 与项目总览共用同一账号偏好）",
  prefAfterOn.status === 200 && prefAfterOn.json !== null && prefAfterOn.json.focusMode === true,
  "focusMode=" + (prefAfterOn.json === null ? "-" : String(prefAfterOn.json.focusMode)));
await clickSelector("[data-maintabs-item=" + Q + "项目总览" + Q + "]");
await waitFor("document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ")!==null");
const overviewFocusProbe = await ev(
  "(function(){var i=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");return i===null?null:{checked:i.checked};})()"
);
check("⑦ 切到「项目总览」：标签栏醒目模式开关同开（同一账号偏好 · 同一枚开关 —— 换视图不清）",
  overviewFocusProbe !== null && overviewFocusProbe.checked === true,
  overviewFocusProbe === null ? "-" : JSON.stringify(overviewFocusProbe));
await clickSelector("[data-maintabs-item=" + Q + "日报及问题" + Q + "]");
await waitFor("document.querySelectorAll(" + j("[data-subnav-item]") + ").length===4");
await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-row]") + ")!==null");
await waitFor("document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ")!==null");
await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 200, button: "none" });
await sleep(300);
const focusKeptProbe = await ev(
  "(function(){var i=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");" +
  "var r=document.querySelector(" + j("[data-issue-row]") + ");" +
  "return {checked:i===null?null:i.checked,bg:r===null?" + j("") + ":getComputedStyle(r).backgroundColor};})()"
);
check("⑦ 回到「问题追踪」醒目模式仍开（跨主标签重挂后：开关 checked + 首行仍铺色）",
  focusKeptProbe !== null && focusKeptProbe.checked === true && focusKeptProbe.bg !== "rgba(0, 0, 0, 0)",
  focusKeptProbe === null ? "-" : JSON.stringify(focusKeptProbe));
await clickSelector("[data-maintabs] label");
const focusTurnedOff = await waitFor(
  "(function(){var i=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");" +
  "var rs=document.querySelectorAll(" + j("[data-issue-row]") + ");if(i===null||rs[1]===undefined){return false;}" +
  "return i.checked===false&&getComputedStyle(rs[1]).backgroundColor===" + j("rgba(0, 0, 0, 0)") + ";})()"
);
const focusOffProbe = await ev(
  "(function(){var table=document.querySelector(" + j("[data-issue-table]") + ");var i=document.querySelector(" + j("[data-maintabs] input[data-focus-mode-toggle]") + ");" +
  "if(table===null){return null;}" +
  "var st=table.querySelector(" + j("[data-issue-state]") + ");var r=document.querySelector(" + j("[data-issue-row]") + ");" +
  "var ref=document.createElement(" + j("span") + ");ref.style.position=" + j("absolute") + ";ref.style.visibility=" + j("hidden") + ";document.body.appendChild(ref);" +
  "ref.className=" + j("bg-sky-100") + ";var target=getComputedStyle(ref).backgroundColor;ref.remove();" +
  "return {checked:i===null?null:i.checked,rowBg:r===null?" + j("") + ":getComputedStyle(r).backgroundColor," +
  "tagBg:st===null?" + j("") + ":getComputedStyle(st).backgroundColor,target:target," +
  "cls:st===null?" + j("") + ":String(st.className),font:st===null?" + j("") + ":getComputedStyle(st).fontSize,weight:st===null?" + j("") + ":getComputedStyle(st).fontWeight};})()"
);
check("⑦ 醒目模式关掉还原：开关回关 + 行还原透明底 + 状态列回「项目总览同款」色签胶囊（bg-sky-100 计算色相等 + rounded-lg + 11px/500）",
  focusTurnedOff === true && focusOffProbe !== null && focusOffProbe.checked === false &&
  focusOffProbe.rowBg === "rgba(0, 0, 0, 0)" &&
  focusOffProbe.tagBg === focusOffProbe.target && String(focusOffProbe.cls).indexOf("rounded-lg") >= 0 &&
  focusOffProbe.font === "11px" && focusOffProbe.weight === "500",
  focusOffProbe === null ? "-" : JSON.stringify(focusOffProbe));
const prefAfterOff = await api("/api/v1/users/me/preferences");
check("⑦ 关闭同样落库（GET 偏好 focusMode = false）",
  prefAfterOff.status === 200 && prefAfterOff.json !== null && prefAfterOff.json.focusMode === false,
  "focusMode=" + (prefAfterOff.json === null ? "-" : String(prefAfterOff.json.focusMode)));

// ---------- ⑧ 行内编辑（Push 208 · 业务口径「问题追溯里面也要可以这样编辑 文字 以及问题归类都要可以修改 文字修改需要点击保存
//   编辑后时间不变 日报记录同理」） ----------
// 口径：问题描述 / 解决方案或建议 / 当日完成工作 / 明日计划 = 文字列（浮层 = 多行框 + 取消 / 保存，**点「保存」才落值**，落值即收浮层）；
//   问题归类 = 多选浮层（绿勾 · 点选不收浮层 · 再点取消）；问题是否处理 = 三态下拉（项目总览状态列同款）；
//   日报记录的关联阶段（Push 208 追加口径「这个也要可以编辑筛选选择」）= 与表单同款的九阶段勾选清单；
//   日期 / 提出日期列**不可编辑**（单元格里没有可点目标），patch 也从不写 date / raisedAt ——「编辑后时间不变」。
/** 行内下拉（三态）里按文案点一枚选项。 */
async function clickInlineOption(text) {
  const point = await ev(
    "(function(){var os=document.querySelectorAll(" + j("[data-inline-popover] [role=option]") + ");" +
    "for(var i=0;i<os.length;i++){if(os[i].textContent.trim()===" + j(text) + "){" +
    "os[i].scrollIntoView({block:" + j("center") + "});var r=os[i].getBoundingClientRect();" +
    "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()"
  );
  if (point === null || point === undefined) throw new Error("点不到行内下拉选项：" + text);
  await clickAt(point);
}
/** 行内多选浮层（问题归类）里按文案点一枚选项（点选不收浮层 · 再点 = 取消勾选）。 */
async function clickInlineMulti(text) {
  const point = await ev(
    "(function(){var os=document.querySelectorAll(" + j("[data-inline-popover] [data-multi-option]") + ");" +
    "for(var i=0;i<os.length;i++){if(os[i].getAttribute(" + j("data-multi-option") + ")===" + j(text) + "){" +
    "os[i].scrollIntoView({block:" + j("center") + "});var r=os[i].getBoundingClientRect();" +
    "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()"
  );
  if (point === null || point === undefined) throw new Error("点不到归类选项：" + text);
  await clickAt(point);
}
/** 问题追踪首行的日期 / 描述 / 归类 / 解决方案 / 状态探针。 */
function issueRow1Expr() {
  return "(function(){var r=document.querySelector(" + j("[data-issue-row]") + ");if(r===null){return null;}" +
    "var tds=r.querySelectorAll(" + j("td") + ");var title=tds[1].querySelector(" + j("[data-issue-title]") + ");" +
    "var tag=r.querySelector(" + j("[data-issue-state]") + ");var cs=tds[2].querySelectorAll(" + j("[data-issue-category]") + ");var cats=[];" +
    "for(var i=0;i<cs.length;i++){cats.push(cs[i].getAttribute(" + j("data-issue-category") + "));}" +
    "return {date:tds[0].textContent.trim(),title:title===null?" + j("") + ":title.textContent," +
    "titleWhite:title===null?" + j("") + ":getComputedStyle(title).whiteSpace,sol:tds[3].textContent.trim(),cats:cats," +
    "state:tag===null?" + j("") + ":tag.getAttribute(" + j("data-issue-state") + ")};})()";
}
/** 日报记录首行探针。 */
function reportRow1Expr() {
  return "(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}" +
    "var tds=r.querySelectorAll(" + j("td") + ");var date=tds[0].querySelector(" + j("[data-report-date]") + ");" +
    "var done=tds[3].querySelector(" + j("[data-report-done]") + ");var plan=tds[4].querySelector(" + j("[data-report-plan]") + ");" +
    "return {dateCell:tds[0].textContent.trim(),date:date===null?" + j("") + ":date.textContent," +
    "dateBtns:tds[0].querySelectorAll(" + j("button") + ").length," +
    "stages:(function(){var td=tds[2];var cs=td.querySelectorAll(" + j("[data-report-stage]") + ");if(cs.length===0){return td.textContent.trim();}var a=[];for(var i=0;i<cs.length;i++){a.push(cs[i].getAttribute(" + j("data-report-stage") + "));}return a.join(" + j("、") + ");})()," +
    "done:done===null?" + j("") + ":done.textContent,doneWhite:done===null?" + j("") + ":getComputedStyle(done).whiteSpace," +
    "plan:plan===null?" + j("") + ":plan.textContent};})()";
}
await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-row]") + ")!==null");
const editProbe = await ev(
  "(function(){var t=document.querySelector(" + j("[data-issue-table]") + ");if(t===null){return null;}" +
  "var rows=t.querySelectorAll(" + j("[data-issue-row]") + ");var r=rows[0];if(r===undefined){return null;}var tds=r.querySelectorAll(" + j("td") + ");" +
  "function lab(td){var b=td.querySelector(" + j("button") + ");return b===null?" + j("") + ":String(b.getAttribute(" + j("aria-label") + "));}" +
  "return {n:rows.length,dateBtns:tds[0].querySelectorAll(" + j("button") + ").length,dateText:tds[0].textContent.trim()," +
  "title:lab(tds[1]),cat:lab(tds[2]),sol:lab(tds[3]),state:lab(tds[5])};})()"
);
check("⑧ 问题追踪「问题描述 / 问题归类 / 解决方案或建议 / 问题是否处理」四列都挂上行内编辑触发器（无障碍名 = 字段名（提出日期）· 业务样 = 项目总览行内编辑那套）",
  editProbe !== null && editProbe.title.indexOf("修改问题描述") === 0 && editProbe.cat.indexOf("修改问题归类") === 0 && editProbe.sol.indexOf("修改解决方案或建议") === 0 && editProbe.state.indexOf("修改问题状态") === 0,
  editProbe === null ? "-" : JSON.stringify(editProbe));
check("⑧ 日期列不可编辑（单元格内 0 个可点目标 · 业务口径「编辑后时间不变」的第一层）",
  editProbe !== null && editProbe.dateBtns === 0, editProbe === null ? "-" : "dateBtns=" + String(editProbe.dateBtns));
const ISSUE_DATE_0 = editProbe === null ? "" : editProbe.dateText;
/** 进组基线（⑧ 组跑在 ⑦d 之后：主标签重挂过一次，「日报及问题」已复位回静态演示数据 —— 不假定首行是哪一条，
 *  一律现读现比、断言只认「相对变化」；换演示数据也不会假红）。 */
const ISSUE_ROW_0 = await ev(issueRow1Expr());
const ISSUE_CATS_0 = ISSUE_ROW_0 === null ? [] : ISSUE_ROW_0.cats;
const ISSUE_TITLE_0 = ISSUE_ROW_0 === null ? "" : ISSUE_ROW_0.title;
const ISSUE_SOL_0 = ISSUE_ROW_0 === null ? "" : ISSUE_ROW_0.sol;
const CAT_ADD_POOL = [].concat(CATEGORY_NAMES).filter((name) => ISSUE_CATS_0.indexOf(name) < 0);
const CAT_ADD = CAT_ADD_POOL.length === 0 ? "其它" : CAT_ADD_POOL[0];
const EDIT_TITLE_TEXT = "回放·行内编辑·问题描述" + LF + "第二行";
await clickSelector("[data-issue-table] tbody tr:first-child td:nth-child(2) button[aria-label]");
const titleEditor = await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
const titleEditorProbe = await ev(
  "(function(){var p=document.querySelector(" + j("[data-inline-popover]") + ");if(p===null){return null;}var ta=p.querySelector(" + j("textarea") + ");" +
  "return {label:ta===null?" + j("") + ":String(ta.getAttribute(" + j("aria-label") + ")),value:ta===null?" + j("") + ":ta.value," +
  "save:p.querySelector(" + j("[data-inline-save]") + ")!==null,cancel:p.querySelector(" + j("[data-inline-cancel]") + ")!==null};})()"
);
check("⑧ 点「问题描述」→ 文字编辑器浮层（多行框 + 取消 / 保存 · 框的无障碍名 = 「修改问题描述（提出日期）」· 预填当前文字）",
  titleEditor === true && titleEditorProbe !== null && titleEditorProbe.save === true && titleEditorProbe.cancel === true &&
  titleEditorProbe.label.indexOf("修改问题描述") === 0 && String(titleEditorProbe.value) === ISSUE_TITLE_0,
  titleEditorProbe === null ? "-" : JSON.stringify({ label: titleEditorProbe.label, save: titleEditorProbe.save, cancel: titleEditorProbe.cancel }));
await typeInto("[data-inline-popover] textarea", EDIT_TITLE_TEXT);
await clickSelector("[data-inline-popover] [data-inline-save]");
const titleSaved = await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const afterTitle = await ev(issueRow1Expr());
check("⑧ 「文字修改需要点击保存」：点「保存」才落值 —— 问题描述 = 新文字（自动序号 1: / 2: 重排 + 换行保留 · pre-line），保存后浮层自动收起",
  titleSaved === true && afterTitle !== null && afterTitle.title === NUMLINE(EDIT_TITLE_TEXT) && afterTitle.titleWhite === "pre-line",
  afterTitle === null ? "-" : JSON.stringify({ t: afterTitle.title, white: afterTitle.titleWhite }));
check("⑧ 「编辑后时间不变」：改完问题描述，日期列原样（" + ISSUE_DATE_0 + "）",
  afterTitle !== null && afterTitle.date === ISSUE_DATE_0, afterTitle === null ? "-" : String(afterTitle.date));
await clickSelector("[data-issue-table] tbody tr:first-child td:nth-child(4) button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", "回放·不该落值的方案文字");
await clickSelector("[data-inline-popover] [data-inline-cancel]");
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const afterCancel = await ev(issueRow1Expr());
check("⑧ 「取消」不落值（反向实证）：解决方案或建议仍是进组原值 · 日期列也没动",
  afterCancel !== null && afterCancel.sol === ISSUE_SOL_0 && afterCancel.date === ISSUE_DATE_0,
  afterCancel === null ? "-" : JSON.stringify({ sol: afterCancel.sol, date: afterCancel.date }));
const EDIT_SOL_TEXT = "回放·行内编辑·解决方案" + LF + "第二行";
await clickSelector("[data-issue-table] tbody tr:first-child td:nth-child(4) button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", EDIT_SOL_TEXT);
await clickSelector("[data-inline-popover] [data-inline-save]");
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const afterSol = await ev(issueRow1Expr());
check("⑧ 「解决方案或建议」同款文字编辑：保存后 = 新文字（自动序号 + 换行保留）",
  afterSol !== null && afterSol.sol === NUMLINE(EDIT_SOL_TEXT), afterSol === null ? "-" : String(afterSol.sol));
await clickSelector("[data-issue-table] tbody tr:first-child td:nth-child(3) button[aria-label]");
const catOpen = await waitFor("document.querySelector(" + j("[data-inline-popover] [data-multi-option]") + ")!==null");
const catOpenProbe = await ev(
  "(function(){var p=document.querySelector(" + j("[data-inline-popover]") + ");if(p===null){return null;}var os=p.querySelectorAll(" + j("[data-multi-option]") + ");var sel=[];var chips={};" +
  "for(var i=0;i<os.length;i++){var name=os[i].getAttribute(" + j("data-multi-option") + ");" +
  "var chip=os[i].querySelector(" + j("span") + ");chips[name]=chip===null?" + j("") + ":getComputedStyle(chip).backgroundColor;" +
  "if(os[i].getAttribute(" + j("aria-selected") + ")===" + j("true") + "){sel.push(name);}}" +
  "return {n:os.length,sel:sel,chips:chips};})()"
);
check("⑧ 点「问题归类」→ 多选浮层（十项字典全列 · 当前已勾 = 该行现有归类 —— 与「日报填写」表单侧同一套绿勾口径）",
  catOpen === true && catOpenProbe !== null && catOpenProbe.n === 10 && catOpenProbe.sel.join("/") === ISSUE_CATS_0.join("/"),
  catOpenProbe === null ? "-" : JSON.stringify(catOpenProbe));
await clickInlineMulti(CAT_ADD);
await sleep(400);
const catAdded = await ev(issueRow1Expr());
const catStillOpen = await ev("document.querySelector(" + j("[data-inline-popover]") + ")!==null");
check("⑧ 归类点选即落值（新增「" + CAT_ADD + "」→ 表内立刻多一枚彩色胶囊）且**浮层不收**（多选可以接着点）",
  catAdded !== null && catAdded.cats.join("/") === ISSUE_CATS_0.concat([CAT_ADD]).join("/") && catStillOpen === true,
  catAdded === null ? "-" : catAdded.cats.join("/"));
await clickInlineMulti(CAT_ADD);
await sleep(400);
const catDropped = await ev(issueRow1Expr());
check("⑧ 再点同一枚 = 取消勾选（加 / 减两条链路都实测 · 回到进组组合）",
  catDropped !== null && catDropped.cats.join("/") === ISSUE_CATS_0.join("/"),
  catDropped === null ? "-" : catDropped.cats.join("/"));
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const catColors = await ev(
  "(function(){var r=document.querySelector(" + j("[data-issue-row]") + ");if(r===null){return null;}var tds=r.querySelectorAll(" + j("td") + ");" +
  "var cs=tds[2].querySelectorAll(" + j("[data-issue-category]") + ");var out={};var transparent=0;" +
  "for(var i=0;i<cs.length;i++){var bg=getComputedStyle(cs[i]).backgroundColor;if(bg===" + j("rgba(0, 0, 0, 0)") + "){transparent+=1;}" +
  "out[cs[i].getAttribute(" + j("data-issue-category") + ")]=bg;}" +
  "return {colors:out,count:cs.length,transparent:transparent,date:tds[0].textContent.trim()};})()"
);
check("⑧ Esc 收起后归类仍是彩色胶囊（逐枚都带色表底色 · 数量 = 进组原值 " + String(ISSUE_CATS_0.length) + " 枚）+ 日期列原样",
  catColors !== null && catColors.count === ISSUE_CATS_0.length && catColors.transparent === 0 && catColors.date === ISSUE_DATE_0,
  catColors === null ? "-" : JSON.stringify({ n: catColors.count, colors: catColors.colors }));
await clickSelector("[data-issue-table] tbody tr:first-child td:nth-child(6) button[aria-label]");
const stateOpen = await waitFor("document.querySelector(" + j("[data-inline-popover] [role=option]") + ")!==null");
const stateOpenProbe = await ev(
  "(function(){var p=document.querySelector(" + j("[data-inline-popover]") + ");if(p===null){return null;}var os=p.querySelectorAll(" + j("[role=option]") + ");var names=[];" +
  "for(var i=0;i<os.length;i++){names.push(os[i].textContent.trim());}return {n:os.length,names:names};})()"
);
check("⑧ 点「问题是否处理」→ 三态下拉（未解决 / 处理中 / 已完成 · 业务样 = 项目总览状态列那枚）",
  stateOpen === true && stateOpenProbe !== null && stateOpenProbe.n === 3 && stateOpenProbe.names.join("/") === "未解决/处理中/已完成",
  stateOpenProbe === null ? "-" : JSON.stringify(stateOpenProbe));
await clickInlineOption("处理中");
await sleep(500);
const stateAfter = await ev(issueRow1Expr());
const stateClosed = await ev("document.querySelector(" + j("[data-inline-popover]") + ")===null");
check("⑧ 选「处理中」：状态落值（色签壳仍 = 项目总览同款胶囊）+ 浮层收起 + 日期列原样",
  stateAfter !== null && stateAfter.state === "处理中" && stateClosed === true && stateAfter.date === ISSUE_DATE_0,
  stateAfter === null ? "-" : JSON.stringify({ state: stateAfter.state, date: stateAfter.date }));
await clickSelector("[data-issue-table] tbody tr:first-child td:nth-child(6) button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] [role=option]") + ")!==null");
await clickInlineOption("未解决");
await sleep(500);
const stateBack = await ev(issueRow1Expr());
check("⑧ 状态可来回改（再选回「未解决」· 复盘后数据回到原态）",
  stateBack !== null && stateBack.state === "未解决", stateBack === null ? "-" : String(stateBack.state));
await clickSelector("[data-subnav-item=" + Q + "日报记录" + Q + "]");
await waitFor("document.querySelector(" + j("[data-report-row]") + ")!==null");
const reportEditProbe = await ev(
  "(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}var tds=r.querySelectorAll(" + j("td") + ");" +
  "function lab(td){var b=td.querySelector(" + j("button") + ");return b===null?" + j("") + ":String(b.getAttribute(" + j("aria-label") + "));}" +
  "return {cells:tds.length,dateBtns:tds[0].querySelectorAll(" + j("button") + ").length,stage:lab(tds[2])," +
  "done:lab(tds[3]),plan:lab(tds[4])};})()"
);
check("⑧ 日报记录同理：「当日完成工作 / 明日计划」文字编辑 + 「关联阶段」勾选编辑（无障碍名都带时间）· 时间列没有编辑触发器",
  reportEditProbe !== null && reportEditProbe.cells === 6 && reportEditProbe.done.indexOf("修改当日完成工作") === 0 && reportEditProbe.plan.indexOf("修改明日计划") === 0 &&
  reportEditProbe.stage.indexOf("修改关联阶段") === 0 && reportEditProbe.dateBtns === 0,
  reportEditProbe === null ? "-" : JSON.stringify(reportEditProbe));
const reportBefore = await ev(reportRow1Expr());
const REPORT_DATE_0 = reportBefore === null ? "" : reportBefore.date;
const EDIT_DONE_TEXT = "回放·行内编辑·当日完成工作" + LF + "第二行";
await clickSelector("[data-report-row] td:nth-child(4) button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", EDIT_DONE_TEXT);
await clickSelector("[data-inline-popover] [data-inline-save]");
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const reportAfterDone = await ev(reportRow1Expr());
check("⑧ 日报记录「当日完成工作」保存后 = 新文字（自动序号 + 换行保留 · pre-line）",
  reportAfterDone !== null && reportAfterDone.done === NUMLINE(EDIT_DONE_TEXT) && reportAfterDone.doneWhite === "pre-line",
  reportAfterDone === null ? "-" : JSON.stringify({ d: reportAfterDone.done, white: reportAfterDone.doneWhite }));
check("⑧ 日报记录「编辑后时间不变」：时间列原样（" + REPORT_DATE_0 + "）",
  reportAfterDone !== null && reportAfterDone.date === REPORT_DATE_0 && reportAfterDone.dateCell.indexOf(REPORT_DATE_0) >= 0,
  reportAfterDone === null ? "-" : String(reportAfterDone.date));
await clickSelector("[data-report-row] td:nth-child(5) button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", "回放·不该落值的明日计划");
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const reportAfterEsc = await ev(reportRow1Expr());
check("⑧ 日报记录「明日计划」按 Esc = 取消（原值不动 —— 「文字修改需要点击保存」的反向实证）",
  reportAfterEsc !== null && reportBefore !== null && reportAfterEsc.plan === reportBefore.plan,
  reportAfterEsc === null ? "-" : String(reportAfterEsc.plan));
const EDIT_PLAN_TEXT = "回放·行内编辑·明日计划" + LF + "第二行";
await clickSelector("[data-report-row] td:nth-child(5) button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", EDIT_PLAN_TEXT);
await clickSelector("[data-inline-popover] [data-inline-save]");
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const reportAfterPlan = await ev(reportRow1Expr());
check("⑧ 日报记录「明日计划」保存后 = 新文字（自动序号 + 换行保留）+ 时间列仍原样",
  reportAfterPlan !== null && reportAfterPlan.plan === NUMLINE(EDIT_PLAN_TEXT) && reportAfterPlan.date === REPORT_DATE_0,
  reportAfterPlan === null ? "-" : JSON.stringify({ p: reportAfterPlan.plan, date: reportAfterPlan.date }));

// ⑧e 关联阶段（Push 208 追加 · 业务口径 2026-09-28「这个也要可以编辑筛选选择」）：浮层 = 与「日报填写」同款九阶段勾选清单
const STAGE_BASE_NAMES = reportAfterPlan.stages === "—" ? [] : reportAfterPlan.stages.split("、");
const STAGE_ADD_POOL = STAGES.filter((name) => STAGE_BASE_NAMES.indexOf(name) < 0);
const STAGE_ADD = STAGE_ADD_POOL.length === 0 ? STAGES[0] : STAGE_ADD_POOL[0];
await clickSelector("[data-report-row] td:nth-child(3) button[aria-label]");
const stageOpen = await waitFor("document.querySelector(" + j("[data-inline-popover] [data-multi-option]") + ")!==null");
const stageOpenProbe = await ev(
  "(function(){var p=document.querySelector(" + j("[data-inline-popover]") + ");if(p===null){return null;}" +
  "var os=p.querySelectorAll(" + j("[data-multi-option]") + ");var names=[];var sel=[];var chips={};" +
  "for(var i=0;i<os.length;i++){var name=os[i].getAttribute(" + j("data-multi-option") + ");names.push(name);" +
  "var chip=os[i].querySelector(" + j("span") + ");chips[name]=chip===null?" + j("") + ":getComputedStyle(chip).backgroundColor;" +
  "if(os[i].getAttribute(" + j("aria-selected") + ")===" + j("true") + "){sel.push(name);}}" +
  "return {n:os.length,names:names,sel:sel,chips:chips};})()"
);
check("⑧ 点「关联阶段」→ 九阶段勾选浮层（与「日报填写」表单侧同一份清单 · 当前勾选 = 该行现有阶段 · 业务口径「这个也要可以编辑筛选选择」）",
  stageOpen === true && stageOpenProbe !== null && stageOpenProbe.n === 9 &&
  stageOpenProbe.names.join("/") === STAGES.join("/") && stageOpenProbe.sel.join("/") === STAGE_BASE_NAMES.join("/"),
  stageOpenProbe === null ? "-" : JSON.stringify(stageOpenProbe));
await clickInlineMulti(STAGE_ADD);
await sleep(400);
const stageAdded = await ev(reportRow1Expr());
const stageStillOpen = await ev("document.querySelector(" + j("[data-inline-popover]") + ")!==null");
check("⑧ 阶段点行即落值（新增「" + STAGE_ADD + "」→ 单元格立刻多一枚）+ 浮层不收（可连着勾）",
  stageAdded !== null && stageAdded.stages === (STAGE_BASE_NAMES.length === 0 ? STAGE_ADD : STAGE_BASE_NAMES.join("、") + "、" + STAGE_ADD) && stageStillOpen === true,
  stageAdded === null ? "-" : String(stageAdded.stages));
await clickInlineMulti(STAGE_ADD);
await sleep(400);
const stageDropped = await ev(reportRow1Expr());
check("⑧ 再点同一行 = 取消勾选（加 / 减两条链路都实测 · 回到进组组合）",
  stageDropped !== null && stageDropped.stages === reportAfterPlan.stages, stageDropped === null ? "-" : String(stageDropped.stages));
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");
const stageClosed = await ev(reportRow1Expr());
check("⑧ Esc 收起后关联阶段原样 + 时间列仍原样（「编辑后时间不变」在日报记录三列一致）",
  stageClosed !== null && stageClosed.stages === reportAfterPlan.stages && stageClosed.date === REPORT_DATE_0,
  stageClosed === null ? "-" : JSON.stringify({ s: stageClosed.stages, date: stageClosed.date }));
// ⑧f 关联阶段「显示态」色签（Push 208 追加 · 业务口径 2026-09-28「显示也要有颜色」）：单元格里逐枚色签，
// 颜色与浮层共用同一张九阶段色表、无一透明回落；空态 = 「—」灰字。
const STAGE_RGB = {售前规划:"173, 203, 255",设计开发:"173, 228, 255",加工采购:"220, 223, 228",组装发货:"255, 181, 179",硬件实施:"172, 226, 197",软件部署:"255, 206, 163",试运行:"255, 234, 153",生产阶段:"231, 180, 255",验收:"255, 179, 220"};
const stageTagProbe = await ev(
  "(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}var tds=r.querySelectorAll(" + j("td") + ");" +
  "var cs=tds[2].querySelectorAll(" + j("[data-report-stage]") + ");var names=[];var colors=[];var transparent=0;" +
  "for(var i=0;i<cs.length;i++){names.push(cs[i].getAttribute(" + j("data-report-stage") + "));var bg=getComputedStyle(cs[i]).backgroundColor;colors.push(bg);if(bg===" + j("rgba(0, 0, 0, 0)") + "){transparent++;}}" +
  "return {n:cs.length,names:names,colors:colors,transparent:transparent};})()"
);
check("⑧ 关联阶段「显示也要有颜色」（业务口径 2026-09-28）：单元格逐枚色签、颜色与九阶段色表一一对应（售前规划 #adcbff … 验收 #ffb3dc · 零透明回落）",
  stageTagProbe !== null && stageTagProbe.n === STAGE_BASE_NAMES.length && stageTagProbe.transparent === 0 &&
  stageTagProbe.names.join("/") === STAGE_BASE_NAMES.join("/") &&
  stageTagProbe.colors.every((c, i) => c === "rgb(" + (STAGE_RGB[stageTagProbe.names[i]] ?? "") + ")"),
  stageTagProbe === null ? "-" : JSON.stringify(stageTagProbe));
// ---------- ⑨ 问题看板改版 + 问题详情抽屉（Push 209 · 业务口径 2026-09-28「问题看板是这样的 要这些内容 然后样式
//   参考任务进展的」+「点击要出现抽屉 是关于这个问题的日报内容」） ----------
// 口径：列壳 / 卡片材质 / 隐式滚动条 = 「任务进展」看板同款；卡面 = 业务样图一四段（问题描述 / 问题归类 /
//   解决方案或建议 / 问题附图）；点卡片 = 问题详情抽屉（业务样图二：上半问题本身、中间「关联阶段」常显一行（Push 212 撤「已隐藏 · N」折叠区）、
//   下半来源日报内容）。断言只认相对变化（⑧ 组编辑后的内存态现值，现读现比）。
await clickSelector("[data-subnav-item=" + Q + "问题看板" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-board]") + ")!==null");
const boardShellProbe = await ev(
  "(function(){var b=document.querySelector(" + j("[data-issue-board]") + ");if(b===null){return null;}" +
  "var col=b.querySelector(" + j("[data-issue-column]") + ");var areas=b.querySelectorAll(" + j("[data-scroll-area]") + ");" +
  "var card=document.querySelector(" + j("[data-issue-card=i-01]") + ");" +
  "return {cols:b.querySelectorAll(" + j("[data-issue-column]") + ").length,scrolls:areas.length," +
  "colW:col===null?0:Math.round(col.getBoundingClientRect().width),colH:col===null?0:Math.round(col.getBoundingClientRect().height)," +
  "colBg:col===null?" + j("") + ":getComputedStyle(col).backgroundColor,colBorder:col===null?" + j("") + ":getComputedStyle(col).borderTopWidth," +
  "cardRadius:card===null?" + j("") + ":getComputedStyle(card).borderTopLeftRadius,cardShadow:card===null?" + j("") + ":getComputedStyle(card).boxShadow};})()"
);
check("⑨ 问题看板列壳 = 「任务进展」看板同款（业务口径「样式参考任务进展的」）：三列各 280px 宽、列高随视口封顶（落在 22rem~52rem 内）、列底**无灰面板**（底色透明 + 零描边）+ 列内 / 列间滚动全部走隐式滚动条（ScrollArea 4 处 = 3 列内 + 1 横排）",
  boardShellProbe !== null && boardShellProbe.cols === 3 && boardShellProbe.colW === 280 && boardShellProbe.colH >= 600 && boardShellProbe.colH <= 832 && boardShellProbe.colBg === "rgba(0, 0, 0, 0)" && boardShellProbe.colBorder === "0px" && boardShellProbe.scrolls === 4,
  boardShellProbe === null ? "-" : JSON.stringify(boardShellProbe));
const cardProbe = await ev(
  "(function(){var c=document.querySelector(" + j("[data-issue-card=i-01]") + ");if(c===null){return null;}" +
  "var col=c.closest(" + j("[data-issue-column]") + ");var t=c.querySelector(" + j("[data-issue-card-title]") + ");" +
  "var sol=c.querySelector(" + j("[data-issue-card-solution]") + ");var cs=c.querySelectorAll(" + j("[data-issue-category]") + ");" +
  "var ps=c.querySelectorAll(" + j("p") + ");var labels=[];for(var i=0;i<ps.length;i++){labels.push(ps[i].textContent.trim());}" +
  "var m=c.querySelector(" + j("[data-attachment-thumb] img") + ");var noise=c.querySelector(" + j("span[aria-hidden=true]") + ");" +
  "return {col:col===null?" + j("") + ":col.getAttribute(" + j("data-issue-column") + ")," +
  "title:t===null?" + j("") + ":t.textContent,titleWhite:t===null?" + j("") + ":getComputedStyle(t).whiteSpace," +
  "sol:sol===null?" + j("") + ":sol.textContent,labels:labels," +
  "chipN:cs.length,chipName:cs.length===0?" + j("") + ":cs[0].getAttribute(" + j("data-issue-category") + "),chipBg:cs.length===0?" + j("") + ":getComputedStyle(cs[0]).backgroundColor," +
  "thumbs:c.querySelectorAll(" + j("[data-attachment-thumb]") + ").length,thumbBox:m===null?" + j("") + ":(function(){var rb=m.getBoundingClientRect();return Math.round(rb.width)+" + j("x") + "+Math.round(rb.height);})()," +
  "hasState:c.querySelector(" + j("[data-issue-state]") + ")!==null,hasReporter:c.textContent.indexOf(" + j("提出人") + ")>=0,hasDate:c.textContent.indexOf(" + j("2026年9月") + ")>=0," +
  "hasOwnerTask:c.textContent.indexOf(" + j("责任") + ")>=0||c.textContent.indexOf(" + j("处理时限") + ")>=0||c.textContent.indexOf(" + j("所属任务") + ")>=0," +
  "role:c.getAttribute(" + j("role") + "),tab:c.getAttribute(" + j("tabindex") + "),hint:c.getAttribute(" + j("title") + ")," +
  "radius:getComputedStyle(c).borderTopLeftRadius,bg:getComputedStyle(c).backgroundColor,shadow:getComputedStyle(c).boxShadow," +
  "borderW:getComputedStyle(c).borderTopWidth,borderC:getComputedStyle(c).borderTopColor," +
  "noise:noise!==null,noiseOp:noise===null?" + j("") + ":getComputedStyle(noise).opacity,noiseBg:noise===null?" + j("") + ":getComputedStyle(noise).backgroundImage.slice(0,24)};})()"
);
check("⑨ 卡片材质 = 「任务进展」看板卡片同款：白壳 + 35px 圆角 + 三层投影（两档外投影 + inset 内阴影）+ 1px 发丝边 + 6% 细纹叠层；卡片本体可点（role=button / tabIndex=0 / 悬停提示「点一下看问题详情」）",
  cardProbe !== null && cardProbe.radius === "35px" && cardProbe.bg === "rgb(255, 255, 255)" && cardProbe.shadow.indexOf("rgba(15, 23, 42, 0.18)") >= 0 && cardProbe.shadow.indexOf("rgba(15, 23, 42, 0.06)") >= 0 && cardProbe.shadow.indexOf("inset") >= 0 && cardProbe.borderW === "1px" && cardProbe.borderC !== "rgba(0, 0, 0, 0)" && cardProbe.noise === true && cardProbe.noiseOp === "0.06" && cardProbe.noiseBg === "repeating-conic-gradient" && cardProbe.role === "button" && cardProbe.tab === "0" && cardProbe.hint.indexOf("点一下看问题详情") === 0,
  cardProbe === null ? "-" : JSON.stringify({ radius: cardProbe.radius, shadow: cardProbe.shadow, border: cardProbe.borderW + "/" + cardProbe.borderC, noise: cardProbe.noiseOp }));
check("⑨ 卡面 = 业务样「图一」要的内容：问题描述（= ⑧ 编辑后现值 · pre-line 多行）→ 问题归类（彩色色签「供应商原因」）→ 解决方案或建议（= ⑧ 编辑后现值 · 多行）→ 问题附图（2 枚 40×40 缩略图）；字段名独占一行；状态签 / 提出人 / 日期词都已下架；i-01 卡落在「未解决」列",
  cardProbe !== null && cardProbe.col === "未解决" && cardProbe.title === NUMLINE(EDIT_TITLE_TEXT) && cardProbe.titleWhite === "pre-line" && cardProbe.sol === NUMLINE(EDIT_SOL_TEXT) && cardProbe.chipN === 1 && cardProbe.chipName === "供应商原因" && cardProbe.chipBg === "rgb(255, 234, 153)" && cardProbe.thumbs === 2 && cardProbe.thumbBox === "40x40" && cardProbe.labels.indexOf("问题归类") >= 0 && cardProbe.labels.indexOf("解决方案或建议") >= 0 && cardProbe.labels.indexOf("问题附图") >= 0 && cardProbe.hasState === false && cardProbe.hasReporter === false && cardProbe.hasDate === false && cardProbe.hasOwnerTask === false,
  cardProbe === null ? "-" : JSON.stringify({ t: cardProbe.title, sol: cardProbe.sol, labels: cardProbe.labels, chip: cardProbe.chipBg, thumbs: cardProbe.thumbs }));
// ⑨a2 Push 211（业务口径「要加问题描述标题」）：卡面首段「问题描述」字段名 —— 11px 浅灰小字、在描述正文上方、首段不带上间距。
const descLabelProbe = await ev(
  "(function(){var t=document.querySelector(" + j("[data-issue-card=i-01] [data-issue-card-title]") + ");if(t===null){return null;}" +
  "var wrap=t.parentElement;var f=wrap===null?null:wrap.parentElement;if(f===null){return null;}" +
  "var lab=f.querySelector(" + j("p") + ");var c=t.closest(" + j("[data-issue-card]") + ");var k=null;" +
  "if(c!==null){var ps=c.querySelectorAll(" + j("p") + ");for(var i=0;i<ps.length;i++){if(ps[i].textContent.trim()===" + j("问题归类") + "){k=ps[i];break;}}}" +
  "return {text:lab===null?" + j("") + ":lab.textContent.trim(),size:lab===null?" + j("") + ":getComputedStyle(lab).fontSize," +
  "color:lab===null?" + j("") + ":getComputedStyle(lab).color,peer:k===null?" + j("") + ":getComputedStyle(k).color," +
  "mt:getComputedStyle(f).marginTop,above:lab!==null&&lab.nextElementSibling!==null&&lab.nextElementSibling.contains(t)};})()"
)
check("⑨ 卡面首段补「问题描述」标题（业务口径 2026-09-28「要加问题描述标题」）：字段名 = 11px 浅灰小字（与其余三段同款）+ 在描述正文上方 + 首段不带上间距（mt-3 变体）",
  descLabelProbe !== null && descLabelProbe.text === "问题描述" && descLabelProbe.size === "11px" && descLabelProbe.color === descLabelProbe.peer && descLabelProbe.peer !== "" && descLabelProbe.mt === "0px" && descLabelProbe.above === true,
  descLabelProbe === null ? "-" : JSON.stringify(descLabelProbe));

// ⑨b 点卡片 = 问题详情抽屉（业务口径「点击要出现抽屉 是关于这个问题的日报内容」）：壳 = 任务抽屉同一套全局动画类
//   （drawer-backdrop 遮罩 + drawer-panel 460px 右滑入 · role=dialog / aria-modal）+ 打开锁页面滚动；上半 = 问题本身四行、
//   中间 =「关联阶段」一行（Push 212 起常显、无折叠开关）、下半 = 来源日报 r-0921a 的七行内容（现读内存态 —— 行内编辑后的现值）。
await clickSelector("[data-issue-card=i-01]");
const drawerShown = await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")!==null");
const DRAW_DROPPED_KEYS = ["reporter", "submittedAt", "reportState", "reportId", "issueId"];
const drawerProbe = await ev(
  "(function(){var d=document.querySelector(" + j("[data-issue-drawer]") + ");if(d===null){return null;}" +
  "var fs=d.querySelectorAll(" + j("[data-issue-field]") + ");var map={};" +
  "for(var i=0;i<fs.length;i++){map[fs[i].getAttribute(" + j("data-issue-field") + ")]=fs[i];}" +
  "function dd(k){var el=map[k];return el===undefined?null:el.querySelector(" + j("dd") + ");}" +
  "function txt(k){var x=dd(k);return x===null?" + j("") + ":x.textContent.trim();}" +
  "function imgs(k){var x=dd(k);if(x===null){return [];}var ms=x.querySelectorAll(" + j("img") + ");var a=[];for(var m=0;m<ms.length;m++){var rb=ms[m].getBoundingClientRect();a.push(Math.round(rb.width)+" + j("x") + "+Math.round(rb.height));}return a;}" +
  "var chipEls=dd(" + j("category") + ")===null?[]:dd(" + j("category") + ").querySelectorAll(" + j("[data-issue-category]") + ");" +
  "var chips=[];for(var c2=0;c2<chipEls.length;c2++){chips.push(chipEls[c2].getAttribute(" + j("data-issue-category") + ")+" + j("#") + "+getComputedStyle(chipEls[c2]).backgroundColor);}" +
  "var st=dd(" + j("state") + ")===null?null:dd(" + j("state") + ").querySelector(" + j("[data-issue-state]") + ");" +
  "var tog=d.querySelector(" + j("[data-issue-hidden-toggle]") + ");var bk=document.querySelector(" + j(".drawer-backdrop") + ");" +
  "var hk=[" + DRAW_DROPPED_KEYS.map(j).join(", ") + "];var present=[];" +
  "for(var k2=0;k2<hk.length;k2++){if(map[hk[k2]]!==undefined){present.push(hk[k2]);}}" +
  "var stg=dd(" + j("stages") + ");var stgNames=[];if(stg!==null){var sc=stg.querySelectorAll(" + j("[data-report-stage]") + ");for(var s2=0;s2<sc.length;s2++){stgNames.push(sc[s2].getAttribute(" + j("data-report-stage") + "));}}" +
  "var r=d.getBoundingClientRect();return {fields:fs.length,title:txt(" + j("title") + "),chips:chips,sol:txt(" + j("solution") + ")," +
  "issueImgs:imgs(" + j("issuePhotos") + "),reportImgs:imgs(" + j("reportPhotos") + ")," +
  "done:txt(" + j("doneWork") + "),date:txt(" + j("date") + "),author:txt(" + j("author") + "),plan:txt(" + j("plan") + ")," +
  "state:st===null?" + j("") + ":st.textContent.trim(),hc:txt(" + j("headcount") + ")," +
  "toggleAbsent:tog===null,stages:stgNames," +
  "droppedPresent:present,panelW:Math.round(r.width),panelRight:Math.round(window.innerWidth-r.right),modal:d.getAttribute(" + j("aria-modal") + ")," +
  "backdrop:bk!==null&&String(bk.className).indexOf(" + j("drawer-backdrop") + ")===0,lock:document.body.style.overflow," +
  "footer:d.querySelector(" + j("footer") + ").textContent.trim()};})()"
);
check("⑨ 点卡片开抽屉 = 任务抽屉同一套壳（drawer-backdrop 遮罩 + drawer-panel 460px 右滑入 · role=dialog / aria-modal=true · 贴右缘）+ 打开即锁页面滚动（body overflow=hidden · 同 lockBodyScroll）",
  drawerShown === true && drawerProbe !== null && drawerProbe.backdrop === true && drawerProbe.panelW === 460 && drawerProbe.panelRight === 0 && drawerProbe.modal === "true" && drawerProbe.lock === "hidden",
  drawerProbe === null ? "-" : JSON.stringify({ w: drawerProbe.panelW, right: drawerProbe.panelRight, lock: drawerProbe.lock }));
check("⑨ 抽屉上半 = 这个问题本身（与卡面同值 · 现读行内编辑后的内存态）：问题描述（pre-line）/ 问题归类（色签「供应商原因」同款底色）/ 解决方案或建议 / 问题附图 2 枚缩略图",
  drawerProbe !== null && cardProbe !== null && drawerProbe.title === cardProbe.title && drawerProbe.sol === cardProbe.sol && drawerProbe.chips.join("/") === "供应商原因#rgb(255, 234, 153)" && drawerProbe.issueImgs.join("/") === "40x40/40x40",
  drawerProbe === null ? "-" : JSON.stringify({ title: drawerProbe.title, chips: drawerProbe.chips, imgs: drawerProbe.issueImgs }));
check("⑨ 抽屉撤「已隐藏 · N」折叠区（Push 212 业务口径「只保留关联阶段 且不需要隐藏」）：无折叠开关（[data-issue-hidden-toggle] 不存在）+ 五枚次要字段（提出人 / 提交时间 / 日报状态 / 来源日报 / 问题编号）整体下架（可见字段总数 = 12 = 问题本身 4 + 关联阶段 1 + 来源日报 7）",
  drawerProbe !== null && drawerProbe.toggleAbsent === true && drawerProbe.droppedPresent.length === 0 && drawerProbe.fields === 12,
  drawerProbe === null ? "-" : JSON.stringify({ toggleAbsent: drawerProbe.toggleAbsent, dropped: drawerProbe.droppedPresent, n: drawerProbe.fields }));
check("⑨ 抽屉中间 = 「关联阶段」常显一行（无需点开）：两枚色签 硬件实施 / 试运行（与「日报记录」同款 StageTags · 常读内存态 report.stages）",
  drawerProbe !== null && drawerProbe.stages.join("/") === "硬件实施/试运行",
  drawerProbe === null ? "-" : JSON.stringify(drawerProbe.stages));
check("⑨ 抽屉下半 = 这个问题的来源日报内容（业务口径「是关于这个问题的日报内容」· i-01.reportId=r-0921a 关联展示）：当日完成工作 = ⑧ 编辑后现值（NUMLINE · pre-line）/ 日期 2026年9月21日 / 填写者 卢青（姓名头）/ 明日计划 = ⑧ 编辑后现值 / 现场工作附图 2 枚大瓦片（128×96）/ 问题是否处理 = 未解决（项目总览同款色签）/ 施工人数 = 10",
  drawerProbe !== null && drawerProbe.done === NUMLINE(EDIT_DONE_TEXT) && drawerProbe.date === "2026年9月21日" && drawerProbe.author.indexOf("卢青") >= 0 && drawerProbe.plan === NUMLINE(EDIT_PLAN_TEXT) && drawerProbe.reportImgs.join("/") === "128x96/128x96" && drawerProbe.state === "未解决" && drawerProbe.hc === "10" && drawerProbe.footer.indexOf("r-0921a") >= 0,
  drawerProbe === null ? "-" : JSON.stringify({ done: drawerProbe.done, date: drawerProbe.date, author: drawerProbe.author, plan: drawerProbe.plan, imgs: drawerProbe.reportImgs, state: drawerProbe.state, hc: drawerProbe.hc }));
// ⑨c Push 212 同批（业务口径「抽屉里面可以编辑内容」）：抽屉内 = 两块表能编辑的字段同样可编辑。
//   在场探针：七个触发器（描述 / 归类 / 方案 / 阶段 / 完成工作 / 明日计划 / 状态）+ 五枚只读行无触发器；
//   实测：抽屉里改「问题描述」→ 点「保存」落值；浮层里 Esc = 只关浮层、不关抽屉。
const drawerEditProbe = await ev(
  "(function(){var d=document.querySelector(" + j("[data-issue-drawer]") + ");if(d===null){return null;}" +
  "function trig(k){var f=d.querySelector(" + j("[data-issue-field=") + "+k+" + j("]") + ");if(f===null){return null;}return f.querySelector(" + j("button[aria-label]") + ");}" +
  "function lab(k){var b=trig(k);return b===null?" + j("") + ":String(b.getAttribute(" + j("aria-label") + "));}" +
  "function ro(k){var f=d.querySelector(" + j("[data-issue-field=") + "+k+" + j("]") + ");return f!==null&&f.querySelector(" + j("button[aria-label^='修改']") + ")===null;}" +
  "return {title:lab(" + j("title") + "),category:lab(" + j("category") + "),solution:lab(" + j("solution") + "),stages:lab(" + j("stages") + "),done:lab(" + j("doneWork") + "),plan:lab(" + j("plan") + "),state:lab(" + j("state") + ")," +
  "ro:{date:ro(" + j("date") + "),author:ro(" + j("author") + "),headcount:ro(" + j("headcount") + ")}};})()"
);
check("⑨ 抽屉内可编辑内容（Push 212 同批 · 业务口径「抽屉里面可以编辑内容」）：七个行内编辑触发器在场（问题描述 / 问题归类 / 解决方案或建议 / 关联阶段 / 当日完成工作 / 明日计划 / 问题是否处理 —— 与两块表同款 aria 名）",
  drawerEditProbe !== null && drawerEditProbe.title.indexOf("修改问题描述") === 0 && drawerEditProbe.category.indexOf("修改问题归类") === 0 && drawerEditProbe.solution.indexOf("修改解决方案或建议") === 0 && drawerEditProbe.stages.indexOf("修改关联阶段") === 0 && drawerEditProbe.done.indexOf("修改当日完成工作") === 0 && drawerEditProbe.plan.indexOf("修改明日计划") === 0 && drawerEditProbe.state.indexOf("修改问题状态") === 0,
  drawerEditProbe === null ? "-" : JSON.stringify(drawerEditProbe));
check("⑨ 抽屉内只读字段不长编辑触发器（日期 / 填写者 / 施工人数 —— 「编辑后时间不变」同源口径；两张附图 Push 212 续起改为可增删，见下条贴图区断言）",
  drawerEditProbe !== null && drawerEditProbe.ro.date === true && drawerEditProbe.ro.author === true && drawerEditProbe.ro.headcount === true,
  drawerEditProbe === null ? "-" : JSON.stringify(drawerEditProbe.ro));
// ⑨e Push 212 续（业务口径「图片也要可以增删」）：抽屉里两张附图 = 「日报填写 → AttachmentPicker」同一套可增删贴图区。
const drawerPhotoProbe = await ev(
  "(function(){var d=document.querySelector(" + j("[data-issue-drawer]") + ");if(d===null){return null;}" +
  "function zone(k){var f=d.querySelector(" + j("[data-issue-field=") + "+k+" + j("]") + ");if(f===null){return null;}" +
  "var z=f.querySelector(" + j("[data-paste-zone]") + ");var half=f.querySelector(" + j("[data-paste-half]") + ");var file=f.querySelector(" + j("input[type=file]") + ");" +
  "var xs=f.querySelectorAll(" + j("[data-action=remove-attachment]") + ");var its=f.querySelectorAll(" + j("[data-attachment]") + ");" +
  "var cs=z===null?null:getComputedStyle(z);var hr=half===null?null:half.getBoundingClientRect();" +
  "return {zone:z!==null,half:half!==null,file:file!==null,removes:xs.length,items:its.length,bw:cs===null?" + j("") + ":cs.borderTopWidth,halfH:hr===null?0:Math.round(hr.height)};}" +
  "return {issue:zone(" + j("issuePhotos") + "),report:zone(" + j("reportPhotos") + ")};})()"
);
check("⑨ 抽屉里两张附图 = 可增删贴图区且**不套虚线大卡**（业务口径「框太大了 不需要」：入口 = 两枚 28px 小图标 —— 粘贴 / 选文件；每枚附件带 × 移除；基线各 2 枚）",
  drawerPhotoProbe !== null && drawerPhotoProbe.issue !== null && drawerPhotoProbe.report !== null &&
  drawerPhotoProbe.issue.zone === true && drawerPhotoProbe.issue.half === true && drawerPhotoProbe.issue.file === true &&
  drawerPhotoProbe.issue.bw === "0px" && drawerPhotoProbe.issue.halfH <= 32 &&
  drawerPhotoProbe.issue.removes === 2 && drawerPhotoProbe.issue.items === 2 &&
  drawerPhotoProbe.report.zone === true && drawerPhotoProbe.report.half === true && drawerPhotoProbe.report.file === true &&
  drawerPhotoProbe.report.bw === "0px" && drawerPhotoProbe.report.halfH <= 32 &&
  drawerPhotoProbe.report.removes === 2 && drawerPhotoProbe.report.items === 2,
  drawerPhotoProbe === null ? "-" : JSON.stringify(drawerPhotoProbe));
// ⑨f Push 212 续（业务口径「两个图标不协调」）：两张贴图区入口 = 两枚**同档线重**图标。
const iconParityProbe = await ev(
  "(function(){var d=document.querySelector(" + j("[data-issue-drawer]") + ");if(d===null){return null;}" +
  "var z=d.querySelector(" + j("[data-paste-zone]") + ");if(z===null){return null;}" +
  "var p=z.querySelector(" + j("svg") + ");var f=z.querySelector(" + j("[data-file-half] svg") + ");" +
  "if(p===null||f===null){return null;}" +
  "var pvw=p.viewBox.baseVal.width;var fvw=f.viewBox.baseVal.width;var sw=Number(p.getAttribute(" + j("stroke-width") + "));" +
  "var pr=p.getBoundingClientRect();var fr=f.getBoundingClientRect();" +
  "var inkP=(40.92+sw)/pvw;var inkF=2/fvw;" +
  "return {pVb:String(p.getAttribute(" + j("viewBox") + ")),pSw:sw,pPaths:p.querySelectorAll(" + j("path") + ").length," +
  "fVb:String(f.getAttribute(" + j("viewBox") + ")),fPaths:f.querySelectorAll(" + j("path") + ").length," +
  "pW:Math.round(inkP*10000)/10000,fW:Math.round(inkF*10000)/10000," +
  "gap:Math.round(Math.abs(inkP-inkF)/inkF*10000)/100,pH:Math.round(pr.height*100)/100,fH:Math.round(fr.height*100)/100};})()"
);
check("⑨ 抽屉两张贴图区入口两枚图标**线重归一**（业务口径「两个图标不协调」：粘贴图标视框 40 40 944 944 + 描边 38 ⇒ 等效线圈 8.36% 盒宽 ≈ 右半「文件 + 云」2/24 = 8.33%，差 <1%；两枚同高 16px；粘贴形状仍是业务那枚三条 path）",
  iconParityProbe !== null && iconParityProbe.pVb === "40 40 944 944" && iconParityProbe.pSw === 38 && iconParityProbe.pPaths === 3 && iconParityProbe.fPaths === 1 &&
  iconParityProbe.fVb === "0 0 24 24" &&
  Math.abs(iconParityProbe.pW - iconParityProbe.fW) / iconParityProbe.fW < 0.05 &&
  iconParityProbe.pH === 16 && iconParityProbe.fH === 16,
  iconParityProbe === null ? "-" : JSON.stringify(iconParityProbe));
await clickSelector("[data-issue-field=issuePhotos] [data-action=remove-attachment]");
const drawerPhotoAfterRemove = await ev(
  "(function(){var f=document.querySelector(" + j("[data-issue-field=issuePhotos]") + ");if(f===null){return null;}" +
  "return {items:f.querySelectorAll(" + j("[data-attachment]") + ").length};})()"
);
check("⑨ 抽屉里删图（点问题附图第 1 枚上的 ×）：2 → 1（同一份 patchIssue 内存态）",
  drawerPhotoAfterRemove !== null && drawerPhotoAfterRemove.items === 1,
  drawerPhotoAfterRemove === null ? "-" : JSON.stringify(drawerPhotoAfterRemove));
// 增图：与 ⑤c 同一条粘贴路径（真实剪贴板 + Ctrl+V；无头环境回落合成 ClipboardEvent）。
await clickSelector("[data-issue-field=issuePhotos] [data-paste-half]");
if (String(clipWrite) !== "ok") {
  await ev("(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()");
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(450);
const drawerPhotoAfterAdd = await ev(
  "(function(){var f=document.querySelector(" + j("[data-issue-field=issuePhotos]") + ");if(f===null){return null;}" +
  "var cs=f.querySelectorAll(" + j("[data-attachment]") + ");var names=[];for(var i=0;i<cs.length;i++){names.push(cs[i].getAttribute(" + j("data-attachment") + "));}" +
  "return {items:cs.length,names:names};})()"
);
check("⑨ 抽屉里增图（点左半 Ctrl+V 粘一张）：1 → 2、新图按「剪贴板图片-1.png」命名（与「日报填写」同一套粘贴入口 / 命名）",
  drawerPhotoAfterAdd !== null && drawerPhotoAfterAdd.items === 2 && drawerPhotoAfterAdd.names.indexOf("剪贴板图片-1.png") >= 0,
  drawerPhotoAfterAdd === null ? "-" : JSON.stringify(drawerPhotoAfterAdd));
const DRAWER_EDIT_TITLE = "回放·抽屉编辑·问题描述" + LF + "第二行";
const drawerHeadBefore = await ev("(function(){var p=document.querySelector(" + j("[data-issue-drawer] header p") + ");return p===null?" + j("") + ":p.textContent.trim();})()");
await clickSelector("[data-issue-field=title] button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", "回放·不该落值的草稿");
await pressKey("Escape", "Escape", 27);
await sleep(300);
const escLayerProbe = await ev(
  "(function(){return {popover:document.querySelector(" + j("[data-inline-popover]") + ")!==null,drawer:document.querySelector(" + j("[data-issue-drawer]") + ")!==null};})()"
);
check("⑨ 抽屉浮层里按 Esc = 只关浮层（草稿不落值）、抽屉不跟着关（「Esc 先关内层」口径）",
  escLayerProbe !== null && escLayerProbe.popover === false && escLayerProbe.drawer === true, JSON.stringify(escLayerProbe));
/** Push 212 续：浮层开着 + 焦点在触发器上（鼠标点开的默认焦点位）按 Esc —— 只关浮层，抽屉不跟着关。 */
await clickSelector("[data-issue-field=stages] button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")!==null");
await pressKey("Escape", "Escape", 27);
await sleep(300);
const escTriggerProbe = await ev(
  "(function(){return {popover:document.querySelector(" + j("[data-inline-popover]") + ")!==null,drawer:document.querySelector(" + j("[data-issue-drawer]") + ")!==null};})()"
);
check("⑨ 焦点在触发器上按 Esc 也先关浮层（点开「关联阶段」多选浮层后直接 Esc —— 抽屉不跟着关 · 同一「Esc 先关内层」口径）",
  escTriggerProbe !== null && escTriggerProbe.popover === false && escTriggerProbe.drawer === true, JSON.stringify(escTriggerProbe));
await clickSelector("[data-issue-field=title] button[aria-label]");
await waitFor("document.querySelector(" + j("[data-inline-popover] textarea") + ")!==null");
await typeInto("[data-inline-popover] textarea", DRAWER_EDIT_TITLE);
await clickSelector("[data-inline-popover] [data-inline-save]");
await waitFor("document.querySelector(" + j("[data-inline-popover]") + ")===null");const drawerEditAfter = await ev(
  "(function(){var d=document.querySelector(" + j("[data-issue-drawer]") + ");if(d===null){return null;}" +
  "var f=d.querySelector(" + j("[data-issue-field=title]") + ");var dd=f===null?null:f.querySelector(" + j("dd") + ");" +
  "var h=d.querySelector(" + j("header p") + ");" +
  "return {title:dd===null?" + j("") + ":dd.textContent.trim(),head:h===null?" + j("") + ":h.textContent.trim()};})()"
);
check("⑨ 抽屉里改「问题描述」→ 点「保存」落值（自动序号 + pre-line · 与两块表同一套保存口径）+ 抽屉头部提出时间不变（" + drawerHeadBefore + "）",
  drawerEditAfter !== null && drawerEditAfter.title === NUMLINE(DRAWER_EDIT_TITLE) && drawerEditAfter.head === drawerHeadBefore,
  drawerEditAfter === null ? "-" : JSON.stringify({ t: drawerEditAfter.title, head: drawerEditAfter.head }));

await pressKey("Escape", "Escape", 27);
const drawerClosed = await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")===null");
const afterCloseLock = await ev("document.body.style.overflow");
check("⑨ Esc 关抽屉（170ms 退场动画后移除 · 与任务抽屉同一套关闭口径）+ 关闭后页面滚动解锁（body overflow 回空串）",
  drawerClosed === true && afterCloseLock === "", JSON.stringify({ closed: drawerClosed, lock: afterCloseLock }));
await clickSelector("[data-issue-card=i-01]");
await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")!==null");
await clickAt({ x: 60, y: 500 });
const backdropClosed = await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")===null");
const backdropLock = await ev("document.body.style.overflow");
check("⑨ 卡片可重复打开；点遮罩（抽屉外空白）同样关闭 + 再解锁滚动（同一套关闭口径 · 关闭后又可复活）",
  backdropClosed === true && backdropLock === "", JSON.stringify({ closed: backdropClosed, lock: backdropLock }));

// ⑨d Push 212 同批：抽屉里刚改的「问题描述」在看板卡与「问题追踪」表同步更新（patchIssue 同一份内存态 · 提出日期不变）。
const cardTitleAfterDrawerEdit = await ev(
  "(function(){var t=document.querySelector(" + j("[data-issue-card=i-01] [data-issue-card-title]") + ");return t===null?" + j("") + ":t.textContent.trim();})()"
);
check("⑨ 抽屉编辑联动：看板卡面「问题描述」= 抽屉里刚保存的新值（同一份内存态）",
  cardTitleAfterDrawerEdit === NUMLINE(DRAWER_EDIT_TITLE), cardTitleAfterDrawerEdit);
await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-row=i-01]") + ")!==null");
const rowAfterDrawerEdit = await ev(
  "(function(){var r=document.querySelector(" + j("[data-issue-row=i-01]") + ");if(r===null){return null;}" +
  "var t=r.querySelector(" + j("[data-issue-title]") + ");var tds=r.querySelectorAll(" + j("td") + ");" +
  "var ph=r.querySelectorAll(" + j("[data-attachment-thumb]") + ").length;return {title:t===null?" + j("") + ":t.textContent.trim(),date:tds[0].textContent.trim(),photos:ph};})()"
);
check("⑨ 抽屉编辑联动：「问题追踪」表 i-01 行同步新值（问题描述 = 新值 + 问题附图同步 2 枚「抽屉里刚删 1 枚又粘 1 枚」后的现值；提出日期 2026年9月21日 不变 —— 「编辑后时间不变」）",
  rowAfterDrawerEdit !== null && rowAfterDrawerEdit.title === NUMLINE(DRAWER_EDIT_TITLE) && rowAfterDrawerEdit.date === "2026年9月21日" && rowAfterDrawerEdit.photos === 2,
  rowAfterDrawerEdit === null ? "-" : JSON.stringify(rowAfterDrawerEdit));

// ---------- ⑩ 问题看板卡片拖动（Push 210 · 业务口径 2026-09-28「卡片要可以拖动」） ----------
// 口径：与「任务进展」看板同一套指针拖动 —— 按住卡片位移超过 4px = 拖动（没超过 = 点一下开抽屉）；
//   拖动中卡片跟手（data-drag-ghost）+ 目标列描边高亮 + 落点槽；放开 = 改问题状态（同一内存态）；
//   同列不是落点（问题没有列内顺序）；Esc = 原地取消；⑩ 组跑完把 i-01 拖回「未解决」（与 ⑧ / ⑨ 组基线一致）。
await clickSelector("[data-subnav-item=" + Q + "问题看板" + Q + "]");
await waitFor("document.querySelector(" + j("[data-issue-column]") + ")!==null");
/** 三列卡片数（现读 DOM）。 */
const issueLaneCounts = async () => await ev(
  "(function(){var out={};var cols=document.querySelectorAll(" + j("[data-issue-column]") + ");" +
  "for(var i=0;i<cols.length;i++){out[cols[i].getAttribute(" + j("data-issue-column") + ")]=cols[i].querySelectorAll(" + j("[data-issue-card]") + ").length;}return out;})()"
);
/** i-01 现在在哪一列（现读 DOM；不在 = 空串）。 */
const issueLaneOf = async () => await ev(
  "(function(){var c=document.querySelector(" + j("[data-issue-card=i-01]") + ");if(c===null){return " + j("") + ";}" +
  "var col=c.closest(" + j("[data-issue-column]") + ");return col===null?" + j("") + ":col.getAttribute(" + j("data-issue-column") + ");})()"
);
/** 拖动中的界面探针：拖动卡 / 落点槽 / 目标列与所在列描边 / i-01 是否仍在所在列。 */
const dragUiProbe = async (targetState, homeState) => await ev(
  "(function(){var g=document.querySelector(" + j("[data-drag-ghost]") + ");" +
  "var s=document.querySelector(" + j("[data-issue-drop-slot]") + ");" +
  "var t=document.querySelector(" + j("[data-issue-column=" + targetState + "]") + ");" +
  "var o=document.querySelector(" + j("[data-issue-column=" + homeState + "]") + ");" +
  "var home=document.querySelector(" + j("[data-issue-column=" + homeState + "] [data-issue-card=i-01]") + ");" +
  "var r=g===null?null:g.getBoundingClientRect();" +
  "return {ghost:g!==null,cx:r===null?0:Math.round(r.left+r.width/2),cy:r===null?0:Math.round(r.top+r.height/2)," +
  "slot:s===null?" + j("") + ":s.textContent.trim()," +
  "ringT:t===null||t===o?" + j("") + ":getComputedStyle(t).boxShadow," +
  "ringO:o===null?" + j("") + ":getComputedStyle(o).boxShadow,stillHome:home!==null};})()"
);
const lane0 = (await issueLaneCounts()) ?? {"未解决":0,"处理中":0,"已完成":0};
const lane0Of = await issueLaneOf();
check("⑩ 拖动基线：i-01 在「未解决」列 + 三列计数现读（未解决 " + String(lane0["未解决"]) + " / 处理中 " + String(lane0["处理中"]) + " / 已完成 " + String(lane0["已完成"]) + "）",
  lane0Of === "未解决" && lane0["未解决"] >= 1, JSON.stringify({ i01: lane0Of, lanes: lane0 }));

const cardPt = await rectOf("[data-issue-column=" + Q + "未解决" + Q + "] [data-issue-card=i-01]");
const lanePt = await rectOf("[data-issue-column=" + Q + "处理中" + Q + "]");
const dragMid = await dragCard(cardPt, lanePt, async () => await dragUiProbe("处理中", "未解决"));
check("⑩ 按住卡片拖向「处理中」：拖动卡跟着鼠标浮出（data-drag-ghost · 与任务看板同款）+ 卡片本体仍在「未解决」列（状态不提前落值）",
  dragMid !== null && dragMid.ghost === true && dragMid.stillHome === true && Math.abs(dragMid.cx - lanePt.x) <= 100,
  dragMid === null ? "-" : JSON.stringify({ ghost: dragMid.ghost, stillHome: dragMid.stillHome, cx: dragMid.cx, to: lanePt.x }));
check("⑩ 拖动中目标列描边高亮（与「任务进展」看板同款 emerald ring · 原列无高亮）",
  dragMid !== null && dragMid.ringT !== "" && dragMid.ringT !== "none" && dragMid.ringO === "none",
  dragMid === null ? "-" : JSON.stringify({ ringT: dragMid.ringT.slice(0, 40), ringO: dragMid.ringO }));
check("⑩ 拖动中目标列浮出落点槽（data-issue-drop-slot · 文案「放开：移到「处理中」」）",
  dragMid !== null && dragMid.slot === "放开：移到「处理中」", dragMid === null ? "-" : dragMid.slot);

const lane1 = await issueLaneCounts();
const lane1Of = await issueLaneOf();
check("⑩ 放开 = 改问题状态：i-01 落到「处理中」列（未解决 -1 / 处理中 +1 —— 与任务进展看板同款「拖到哪列 = 改成哪个状态」）",
  lane1Of === "处理中" && lane1["未解决"] === lane0["未解决"] - 1 && lane1["处理中"] === lane0["处理中"] + 1,
  JSON.stringify({ i01: lane1Of, lanes: lane1 }));
const dropDrawer = await ev("document.querySelector(" + j("[data-issue-drawer]") + ")!==null");
check("⑩ 拖动收尾那一下不当点击（放开后问题详情抽屉不会自己弹出来）",
  dropDrawer === false, String(dropDrawer));

await clickSelector("[data-issue-column=" + Q + "处理中" + Q + "] [data-issue-card=i-01]");
await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")!==null");
const drawerStateAfterDrag = await ev(
  "(function(){var d=document.querySelector(" + j("[data-issue-drawer]") + ");if(d===null){return null;}" +
  "var f=d.querySelector(" + j("[data-issue-field=" + Q + "state" + Q + "]") + ");" +
  "var t=f===null?null:f.querySelector(" + j("[data-issue-state]") + ");return t===null?" + j("") + ":t.textContent.trim();})()"
);
check("⑩ 同一内存态联动：点开 i-01 抽屉，「问题是否处理」= 处理中（现读内存态 · patchIssue 同一份数据）",
  drawerStateAfterDrag === "处理中", String(drawerStateAfterDrag));
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")===null");

const cardPt2 = await rectOf("[data-issue-column=" + Q + "处理中" + Q + "] [data-issue-card=i-01]");
const lanePt2 = await rectOf("[data-issue-column=" + Q + "处理中" + Q + "]");
const sameMid = await dragCard(cardPt2, { x: lanePt2.x, y: lanePt2.y + 30 }, async () => await dragUiProbe("处理中", "处理中"));
const lane2 = await issueLaneCounts();
const lane2Of = await issueLaneOf();
check("⑩ 同列不是落点（问题没有列内顺序）：在「处理中」列内拖动 —— 无落点槽 / 无列高亮（拖动卡照常出现），放开状态与计数都不变",
  sameMid !== null && sameMid.ghost === true && sameMid.slot === "" && sameMid.ringO === "none" && lane2Of === "处理中" && lane2["处理中"] === lane1["处理中"] && lane2["未解决"] === lane1["未解决"],
  sameMid === null ? "-" : JSON.stringify({ ghost: sameMid.ghost, slot: sameMid.slot, ring: sameMid.ringO, i01: lane2Of }));

const cardPt3 = await rectOf("[data-issue-column=" + Q + "处理中" + Q + "] [data-issue-card=i-01]");
await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cardPt3.x, y: cardPt3.y, buttons: 0 });
await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cardPt3.x, y: cardPt3.y, button: "left", buttons: 1, clickCount: 1 });
await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cardPt3.x + 2, y: cardPt3.y, button: "left", buttons: 1 });
await sleep(240);
const ghostBelowThreshold = await ev("document.querySelector(" + j("[data-drag-ghost]") + ")===null");
await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cardPt3.x + 2, y: cardPt3.y, button: "left", buttons: 0, clickCount: 1 });
const belowThresholdDrawer = await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")!==null");
check("⑩ 拖动判定阈值（4px）反向实证：按住卡片只挪 2px 放开 = 仍按「点一下」处理（问题详情抽屉打开 · 拖动卡全程未出现）",
  ghostBelowThreshold === true && belowThresholdDrawer === true, JSON.stringify({ ghostAbsent: ghostBelowThreshold, drawer: belowThresholdDrawer }));
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")===null");

const cardPt4 = await rectOf("[data-issue-column=" + Q + "处理中" + Q + "] [data-issue-card=i-01]");
const donePt4 = await rectOf("[data-issue-column=" + Q + "已完成" + Q + "]");
const escMid = await dragCard(cardPt4, donePt4, async () => {
  const during = await dragUiProbe("已完成", "处理中");
  await pressKey("Escape", "Escape", 27);
  await sleep(280);
  const after = await dragUiProbe("已完成", "处理中");
  return { during, after };
});
const lane4 = await issueLaneCounts();
const lane4Of = await issueLaneOf();
const drawerAfterEsc = await ev("document.querySelector(" + j("[data-issue-drawer]") + ")!==null");
check("⑩ Esc 取消拖动（原地取消 · 放开不改状态）：拖到「已完成」列后按 Esc —— 落点槽 / 拖动卡 / 高亮全清，i-01 仍在「处理中」列",
  escMid !== null && escMid.during.ghost === true && escMid.during.slot === "放开：移到「已完成」" && escMid.after.ghost === false && escMid.after.slot === "" && escMid.after.ringT === "none" && lane4Of === "处理中" && lane4["处理中"] === lane1["处理中"] && drawerAfterEsc === false,
  escMid === null ? "-" : JSON.stringify({ during: escMid.during.slot + "/" + String(escMid.during.ghost), after: escMid.after.slot + "/" + String(escMid.after.ghost) + "/" + escMid.after.ringT, i01: lane4Of }));

const cardPt5 = await rectOf("[data-issue-column=" + Q + "处理中" + Q + "] [data-issue-card=i-01]");
const homePt5 = await rectOf("[data-issue-column=" + Q + "未解决" + Q + "]");
await dragCard(cardPt5, homePt5, async () => await dragUiProbe("未解决", "处理中"));
const lane5 = await issueLaneCounts();
const lane5Of = await issueLaneOf();
check("⑩ 拖回「未解决」（还原）：i-01 回「未解决」列、三列计数回到进组基线（与 ⑧ / ⑨ 组的 i-01 状态一致）",
  lane5Of === "未解决" && lane5["未解决"] === lane0["未解决"] && lane5["处理中"] === lane0["处理中"] && lane5["已完成"] === lane0["已完成"],
  JSON.stringify({ i01: lane5Of, lanes: lane5 }));

// ---------- 清理 ----------
// 偏好还原（放在撤销临时会话之前）：focusMode 回到进厂原值，不给下一轮留状态
const prefRestoreRes = await api("/api/v1/users/me/preferences", "PATCH", { focusMode: focusOriginal });
check("清理：账号偏好还原（focusMode 回到进厂原值 " + String(focusOriginal) + "）",
  prefRestoreRes.status === 200 && prefRestoreRes.json !== null && prefRestoreRes.json.focusMode === focusOriginal,
  "focusMode=" + (prefRestoreRes.json === null ? "-" : String(prefRestoreRes.json.focusMode)));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query(
  "select (select count(*)::int from sessions where token_hash = $1 and revoked_at is null) as sessions," +
  " (select count(*)::int from daily_reports where project_id = $2) as reports," +
  " (select count(*)::int from projects where id = $2) as projects",
  [sha256(token), PROJECT_ID]
)).rows[0];
check("清理：临时会话撤销 + 零残留（日报仍是内存态：daily_reports 0 行、项目 1 行照旧）",
  Number(residue.sessions) === 0 && Number(residue.reports) === 0 && Number(residue.projects) === 1, JSON.stringify(residue));

// ---------- 收尾 ----------
const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
