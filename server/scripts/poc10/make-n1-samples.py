# -*- coding: utf-8 -*-
"""N1 保真度抽查 · 中文业务样本生成器（确定性、可复现）。

生成 5 份样本（2 xlsx + 3 docx），覆盖执行计划 §3 N1 要求的观察项：
  01 xlsx：多 Sheet / 跨表公式 / 柱状图+折线图 / 条件格式（色阶·数据条·单元格规则）/ 冻结窗格 / 数据验证
  02 xlsx：1200 行台账 / RANK / 嵌套 IF / SUMIFS / 条件格式（图标集·Top10·数据条）/ 自动筛选 / 千分位
  03 docx：复杂版式（多级标题 / 项目符号+编号列表 / 合并单元格表格 / 页眉页脚+页码域 / 内嵌插图 / 超链接 / 中英混排）
  04 docx：长文档分页（章条结构 / 跨页长表（重复表头）/ 引用标注 / 超链接 / 分页符）
  05 docx：红头公文（红头 / 文号 / 红色分隔线 / 仿宋正文 / 落款右对齐 / 电子印章插图）

用法: python make_n1_samples.py [输出目录]
副作用: 写入 5 个样本文件 + n1-samples.manifest.json（sha256 / 字节数）。
"""
import datetime
import hashlib
import re
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, IconSetRule, Rule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

import docx
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

OUT = sys.argv[1] if len(sys.argv) > 1 else r"D:\poc10-onlyoffice\fixtures"
FIXED_DT = datetime.datetime(2026, 9, 30, 12, 0, 0)
CREATOR = "LibiaoLink PoC-10 (N1 fidelity samples)"
os.makedirs(OUT, exist_ok=True)
RED = RGBColor(0xC0, 0x00, 0x00)
GREY = RGBColor(0x59, 0x59, 0x59)

SURNAMES = "张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗"
GIVEN = "伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀英霞平刚桂英"

def person(i):
    return SURNAMES[i % len(SURNAMES)] + GIVEN[(i * 7) % len(GIVEN)]

PROJ_ENG = ["道路改造工程", "老旧小区改造项目", "智慧园区建设项目", "污水处理扩容工程", "供水管网更新工程",
            "河道综合整治工程", "学校新建工程", "医院改扩建项目", "公交枢纽建设工程", "公共停车场建设工程"]
PROJ_ROAD = ["城东路", "滨河路", "学府街", "解放路", "长江路", "人民路", "和平街", "建设路", "青年路",
             "光明街", "新华路", "文化路"]
PROJ_PHASE = ["", "（二期）", "（三期）", "（四期）"]

def proj_name(i):
    return PROJ_ROAD[(i * 3) % len(PROJ_ROAD)] + PROJ_ENG[i % len(PROJ_ENG)] + PROJ_PHASE[i % len(PROJ_PHASE)]


def pil_font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simsun.ttc"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_gantt_png(path):
    w, h = 720, 360
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    f = pil_font(16)
    fb = pil_font(18)
    tasks = ["需求确认", "方案评审", "开发联调", "测试验证", "上线准备"]
    left, top, row_h, col_w = 120, 56, 52, 96
    d.text((16, 14), "图 1：近两周关键路径（示意）", font=fb, fill="#1F3864")
    for i, t in enumerate(tasks):
        y = top + i * row_h
        d.text((16, y + 12), t, font=f, fill="#333333")
        d.line([(left, y), (left + col_w * 6, y)], fill="#DDDDDD")
        s = i
        e = i + 2 + (i % 3)
        d.rectangle([left + s * col_w + 4, y + 10, left + e * col_w - 4, y + 34], fill="#4472C4" if i % 2 == 0 else "#ED7D31")
    for k in range(7):
        x = left + k * col_w
        d.line([(x, top - 14), (x, top + len(tasks) * row_h - 14)], fill="#EEEEEE")
    d.text((left, h - 34), "9/22    9/24    9/26    9/28    9/30    10/2    10/4", font=f, fill="#666666")
    img.save(path)


def make_stamp_png(path):
    size = 260
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    red = (196, 0, 0, 255)
    d.ellipse([8, 8, size - 8, size - 8], outline=red, width=7)
    d.ellipse([22, 22, size - 22, size - 22], outline=red, width=2)
    f = pil_font(30)
    fs = pil_font(20)
    t1 = "利镖链路科技有限公司"
    box = d.textbbox((0, 0), t1, font=fs)
    d.text(((size - (box[2] - box[0])) / 2, 40), t1, font=fs, fill=red)
    cx, cy, r = size / 2, size / 2 + 4, 52
    import math
    pts = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rr = r if k % 2 == 0 else r * 0.42
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    d.polygon(pts, fill=red)
    t2 = "合同专用章"
    box = d.textbbox((0, 0), t2, font=f)
    d.text(((size - (box[2] - box[0])) / 2, size - 74), t2, font=f, fill=red)
    img.save(path)


THIN = Side(style="thin", color="999999")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

def xl_font(name="宋体", size=11, bold=False, color=None):
    return Font(name=name, size=size, bold=bold, color=color)

def xl_fill(color):
    return PatternFill(start_color=color, end_color=color, fill_type="solid")

def xl_al(horizontal="left", vertical="center", wrap=False):
    return Alignment(horizontal=horizontal, vertical=vertical, wrap_text=wrap)

def put(ws, ref, value, *, font=None, fill=None, align=None, border=True, number_format=None):
    cell = ws[ref]
    cell.value = value
    if font: cell.font = font
    if fill: cell.fill = fill
    if align: cell.alignment = align
    if border: cell.border = BORDER
    if number_format: cell.number_format = number_format
    return cell

def style_block(ws, rng, *, font=None, fill=None, align=None, border=True, number_format=None):
    for row in ws[rng]:
        for cell in row:
            if font: cell.font = font
            if fill: cell.fill = fill
            if align: cell.alignment = align
            if border: cell.border = BORDER
            if number_format: cell.number_format = number_format



def excelize_chart(ch, colors=("4472C4", "ED7D31", "A5A5A5", "FFC000")):
    """把 openpyxl 默认图表补齐为 Excel 风格：显式系列填充 + 轴位置（分类轴在下）。"""
    try:
        ch.x_axis.axPos = "b"
        ch.y_axis.axPos = "l"
    except Exception:
        pass
    for i, ser in enumerate(ch.series):
        c = colors[i % len(colors)]
        ser.graphicalProperties.solidFill = c
        ser.graphicalProperties.line.solidFill = c
    return ch


# ---------------------------------------------------------------- xlsx 01
def stamp_wb(wb):
    wb.properties.creator = CREATOR
    wb.properties.lastModifiedBy = CREATOR
    wb.properties.created = FIXED_DT
    wb.properties.modified = FIXED_DT


def stamp_doc(doc):
    doc.core_properties.author = CREATOR
    doc.core_properties.last_modified_by = CREATOR
    doc.core_properties.created = FIXED_DT
    doc.core_properties.modified = FIXED_DT


def make_fee_summary(path):
    wb = Workbook()
    wb.calculation.fullCalcOnLoad = True
    stamp_wb(wb)
    depts = ["研发中心", "市场部", "财务部", "人力资源部", "生产制造部", "质量管理部", "供应链部", "客户服务部"]

    ws = wb.active
    ws.title = "汇总"
    ws.merge_cells("A1:F1")
    put(ws, "A1", "利镖链路 · 部门费用汇总表（2026 年 8 月）", font=xl_font("黑体", 16, True), align=xl_al("center"), border=False)
    ws.row_dimensions[1].height = 26
    ws.merge_cells("A2:F2")
    put(ws, "A2", "金额单位：元；口径：截至 2026-08-31 已入账费用；制表：财务部（数据为构造样例）",
        font=xl_font("宋体", 9, color="808080"), align=xl_al("center"), border=False)
    heads = ["部门", "差旅费", "办公费", "培训费", "合计", "环比"]
    for j, h in enumerate(heads, 1):
        put(ws, f"{get_column_letter(j)}3", h, font=xl_font("黑体", 11, True), fill=xl_fill("D9E2F3"), align=xl_al("center"))
    for i, d in enumerate(depts):
        r = 4 + i
        put(ws, f"A{r}", d, font=xl_font("宋体", 11), align=xl_al("center"))
        put(ws, f"B{r}", round(3200 + (i * 617) % 4200 + 0.37, 2), number_format="#,##0.00")
        put(ws, f"C{r}", round(2100 + (i * 431) % 3100 + 0.52, 2), number_format="#,##0.00")
        put(ws, f"D{r}", round(1800 + (i * 277) % 2600 + 0.18, 2), number_format="#,##0.00")
        put(ws, f"E{r}", f"=SUM(B{r}:D{r})", number_format="#,##0.00", font=xl_font("宋体", 11, True))
        put(ws, f"F{r}", "—" if i == 0 else f"=IFERROR((E{r}-E{r-1})/E{r-1},\"—\")", number_format="0.0%", align=xl_al("center"))
    r14 = 12
    put(ws, f"A{r14}", "合计", font=xl_font("黑体", 11, True), fill=xl_fill("F2F2F2"), align=xl_al("center"))
    for col in "BCD":
        put(ws, f"{col}{r14}", f"=SUM({col}4:{col}11)", font=xl_font("黑体", 11, True), fill=xl_fill("F2F2F2"), number_format="#,##0.00")
    put(ws, f"E{r14}", f"=SUM(E4:E11)", font=xl_font("黑体", 11, True), fill=xl_fill("F2F2F2"), number_format="#,##0.00")
    put(ws, f"F{r14}", "", fill=xl_fill("F2F2F2"))
    put(ws, "A13", "明细笔数（跨表统计）", border=False, font=xl_font("宋体", 10, color="404040"))
    put(ws, "B13", "=COUNTA(明细!B4:B15)", border=False, font=xl_font("宋体", 10, color="404040"), align=xl_al("center"))
    put(ws, "C13", "培训费占比", border=False, font=xl_font("宋体", 10, color="404040"))
    put(ws, "D13", "=IFERROR(D12/E12,0)", border=False, font=xl_font("宋体", 10, color="404040"), number_format="0.0%", align=xl_al("center"))
    put(ws, "G3", "状态", font=xl_font("黑体", 11, True), fill=xl_fill("D9E2F3"), align=xl_al("center"))
    states = ["已完成", "进行中", "超支", "进行中", "已完成", "进行中", "已完成", "进行中"]
    for i, s in enumerate(states):
        put(ws, f"G{4+i}", s, font=xl_font("宋体", 11), align=xl_al("center"))
    dv = DataValidation(type="list", formula1='"已完成,进行中,超支"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv)
    dv.add("G4:G11")
    ws.conditional_formatting.add("E4:E11", ColorScaleRule(start_type="min", start_color="63BE7B",
                                                           mid_type="percentile", mid_value=50, mid_color="FFEB84",
                                                           end_type="max", end_color="F8696B"))
    ws.conditional_formatting.add("B4:B11", DataBarRule(start_type="min", end_type="max", color="638EC6"))
    ws.conditional_formatting.add("D4:D11", CellIsRule(operator="greaterThan", formula=["6000"],
                                                       font=Font(color="9C0006", bold=True),
                                                       fill=xl_fill("FFC7CE")))
    ws.freeze_panes = "A4"
    for col, w in zip("ABCDEFG", [16, 13, 13, 13, 14, 9, 10]):
        ws.column_dimensions[col].width = w

    ws2 = wb.create_sheet("明细")
    ws2.merge_cells("A1:F1")
    put(ws2, "A1", "费用明细（2026 年 8 月 · 节选 12 笔）", font=xl_font("黑体", 13, True), align=xl_al("center"), border=False)
    ws2.row_dimensions[1].height = 22
    for j, h in enumerate(["日期", "部门", "费用类别", "金额", "发票号", "备注"], 1):
        put(ws2, f"{get_column_letter(j)}3", h, font=xl_font("黑体", 11, True), fill=xl_fill("D9E2F3"), align=xl_al("center"))
    cats = ["差旅费", "办公费", "培训费"]
    notes = ["市内交通与住宿；含增值税专用发票", "办公耗材补货（纸张、硒鼓）", "外部培训：项目管理实战（2 天）",
             "跨省出差：客户现场支持", "会议室设备维修", "内训讲师费（含税）", "样品快递费", "团队建设活动",
             "检测仪器校准费", "软件订阅续费（年度）", "安全防护用品采购", "客户答谢会物料"]
    for i in range(12):
        r = 4 + i
        put(ws2, f"A{r}", f"2026-08-{(i % 28) + 1:02d}", align=xl_al("center"))
        put(ws2, f"B{r}", depts[(i * 3) % len(depts)], align=xl_al("center"))
        put(ws2, f"C{r}", cats[i % 3], align=xl_al("center"))
        put(ws2, f"D{r}", round(880 + (i * 3379) % 43000 + 0.66, 2), number_format="#,##0.00")
        put(ws2, f"E{r}", f"FP-202608-{i + 1:04d}", align=xl_al("center"), font=xl_font("Consolas", 10))
        put(ws2, f"F{r}", notes[i], font=xl_font("宋体", 10), align=xl_al("left", wrap=True))
    put(ws2, "A16", "合计", font=xl_font("黑体", 11, True), fill=xl_fill("F2F2F2"), align=xl_al("center"))
    put(ws2, "B16", "=COUNTA(B4:B15)", font=xl_font("黑体", 11, True), fill=xl_fill("F2F2F2"), align=xl_al("center"))
    put(ws2, "C16", "笔数", font=xl_font("宋体", 10), fill=xl_fill("F2F2F2"), align=xl_al("center"))
    put(ws2, "D16", "=SUM(D4:D15)", font=xl_font("黑体", 11, True), fill=xl_fill("F2F2F2"), number_format="#,##0.00")
    ws2.conditional_formatting.add("D4:D15", CellIsRule(operator="greaterThan", formula=["20000"], fill=xl_fill("FCE4D6")))
    ws2.freeze_panes = "A4"
    for col, w in zip("ABCDEF", [12, 14, 11, 13, 17, 34]):
        ws2.column_dimensions[col].width = w

    ws3 = wb.create_sheet("图表")
    ws3["A1"] = "月份"; ws3["B1"] = "差旅费（万元）"; ws3["C1"] = "办公费（万元）"
    for c in "ABC":
        ws3[f"{c}1"].font = xl_font("黑体", 11, True)
        ws3[f"{c}1"].fill = xl_fill("D9E2F3")
    for i in range(12):
        r = 2 + i
        ws3[f"A{r}"] = f"{i + 1} 月"
        ws3[f"B{r}"] = round(3.2 + ((i * 7) % 13) / 10, 2)
        ws3[f"C{r}"] = round(2.4 + ((i * 5) % 11) / 10, 2)
        ws3[f"B{r}"].number_format = "0.00"
        ws3[f"C{r}"].number_format = "0.00"
    bar = BarChart()
    bar.type = "col"
    bar.style = 10
    bar.title = "2026 年 1-12 月费用趋势（柱状）"
    bar.y_axis.title = "万元"
    data = Reference(ws3, min_col=2, max_col=3, min_row=1, max_row=13)
    cats = Reference(ws3, min_col=1, min_row=2, max_row=13)
    bar.add_data(data, titles_from_data=True)
    bar.set_categories(cats)
    excelize_chart(bar)
    bar.height, bar.width = 8.5, 17
    ws3.add_chart(bar, "E2")
    line = LineChart()
    line.title = "费用趋势（折线）"
    line.y_axis.title = "万元"
    line.add_data(data, titles_from_data=True)
    line.set_categories(cats)
    excelize_chart(line)
    from openpyxl.chart.marker import Marker
    for ser in line.series:
        ser.marker = Marker(symbol="circle", size=5)
    line.height, line.width = 8.5, 17
    ws3.add_chart(line, "E20")
    deptbar = BarChart()
    deptbar.type = "bar"
    deptbar.title = "各部门费用合计（元）"
    ddata = Reference(ws, min_col=5, min_row=3, max_row=11)
    dcats = Reference(ws, min_col=1, min_row=4, max_row=11)
    deptbar.add_data(ddata, titles_from_data=True)
    deptbar.set_categories(dcats)
    excelize_chart(deptbar)
    deptbar.height, deptbar.width = 8.5, 17
    ws3.add_chart(deptbar, "E38")
    for col, w in zip("ABCDEF", [10, 16, 16, 4, 18, 18]):
        ws3.column_dimensions[col].width = w
    ws3["A16"] = "数据为构造样例，仅用于渲染保真度比对。"
    ws3["A16"].font = xl_font("宋体", 9, color="808080")

    wb.save(path)
    return {"sheets": ["汇总", "明细", "图表"], "features": "多Sheet/跨表公式/柱状图/折线图/色阶/数据条/单元格规则/冻结/数据验证/合并单元格"}
# ---------------------------------------------------------------- xlsx 02
def make_project_ledger(path):
    wb = Workbook()
    wb.calculation.fullCalcOnLoad = True
    stamp_wb(wb)
    ws = wb.active
    ws.title = "台账"
    ws.merge_cells("A1:K1")
    put(ws, "A1", "利镖链路 · 在建项目资金台账（2026-09）", font=xl_font("黑体", 15, True), align=xl_al("center"), border=False)
    ws.row_dimensions[1].height = 24
    ws.merge_cells("A2:K2")
    put(ws, "A2", "构造样例：1200 行；金额单位：万元；含 RANK / 嵌套 IF / 图标集 / Top10 / 数据条 / 自动筛选",
        font=xl_font("宋体", 9, color="808080"), align=xl_al("center"), border=False)
    heads = ["序号", "项目编号", "项目名称", "负责人", "预算", "已支出", "结余", "执行率", "评级", "排名", "状态"]
    for j, h in enumerate(heads, 1):
        put(ws, f"{get_column_letter(j)}3", h, font=xl_font("黑体", 10, True), fill=xl_fill("D9E2F3"), align=xl_al("center"))
    n = 1200
    statuses = ["在建", "完工", "待启动"]
    for i in range(n):
        r = 4 + i
        put(ws, f"A{r}", i + 1, align=xl_al("center"))
        put(ws, f"B{r}", f"PJ-2026-{i + 1:04d}", align=xl_al("center"), font=xl_font("Consolas", 10))
        put(ws, f"C{r}", proj_name(i), font=xl_font("宋体", 10))
        put(ws, f"D{r}", person(i), align=xl_al("center"))
        budget = 50 + (i * 137) % 4950
        spent = round(budget * (0.45 + ((i * 29) % 70) / 100.0), 2)
        put(ws, f"E{r}", float(budget), number_format="#,##0.00")
        put(ws, f"F{r}", spent, number_format="#,##0.00")
        put(ws, f"G{r}", f"=E{r}-F{r}", number_format="#,##0.00")
        put(ws, f"H{r}", f"=IFERROR(F{r}/E{r},0)", number_format="0.0%")
        put(ws, f"I{r}", f'=IF(H{r}>=1,"超预算",IF(H{r}>=0.9,"预警","正常"))', align=xl_al("center"))
        put(ws, f"J{r}", f"=RANK(F{r},$F$4:$F${3 + n},0)", align=xl_al("center"))
        put(ws, f"K{r}", statuses[(i * 5) % 3], align=xl_al("center"))
    rng = f"A4:K{3 + n}"
    ws.conditional_formatting.add(f"H4:H{3 + n}", IconSetRule("3TrafficLights1", "percent", [0, 33, 67]))
    ws.conditional_formatting.add(f"F4:F{3 + n}", DataBarRule(start_type="min", end_type="max", color="70AD47"))
    dxf = DifferentialStyle(font=Font(bold=True, color="9C0006"), fill=xl_fill("FFC7CE"))
    ws.conditional_formatting.add(f"F4:F{3 + n}", Rule(type="top10", rank=10, dxf=dxf))
    ws.conditional_formatting.add(f"I4:I{3 + n}", CellIsRule(operator="equal", formula=['"超预算"'],
                                                             font=Font(bold=True, color="9C0006")))
    ws.auto_filter.ref = rng
    ws.freeze_panes = "A4"
    for col, w in zip("ABCDEFGHIJK", [7, 14, 30, 10, 11, 11, 11, 9, 9, 8, 9]):
        ws.column_dimensions[col].width = w

    st = wb.create_sheet("统计")
    st.merge_cells("A1:D1")
    put(st, "A1", "台账统计（公式引用「台账」表）", font=xl_font("黑体", 13, True), align=xl_al("center"), border=False)
    rows = [
        ("项目总数（个）", f"=COUNTA(台账!B4:B{3 + n})"),
        ("预算总额（万元）", f"=SUM(台账!E4:E{3 + n})"),
        ("支出总额（万元）", f"=SUM(台账!F4:F{3 + n})"),
        ("整体执行率", f"=IFERROR(B5/B4,0)"),
        ("超预算项目数", f'=COUNTIF(台账!I4:I{3 + n},"超预算")'),
        ("预警项目数", f'=COUNTIF(台账!I4:I{3 + n},"预警")'),
        ("完工项目数", f'=COUNTIF(台账!K4:K{3 + n},"完工")'),
        ("单项目最高支出", f"=MAX(台账!F4:F{3 + n})"),
        ("单项目平均支出", f"=AVERAGE(台账!F4:F{3 + n})"),
        ("在建项目支出合计", f'=SUMIFS(台账!F4:F{3 + n},台账!K4:K{3 + n},"在建")'),
        ("完工项目支出合计", f'=SUMIFS(台账!F4:F{3 + n},台账!K4:K{3 + n},"完工")'),
        ("待启动项目支出合计", f'=SUMIFS(台账!F4:F{3 + n},台账!K4:K{3 + n},"待启动")'),
    ]
    r = 3
    for name, formula in rows:
        put(st, f"A{r}", name, font=xl_font("宋体", 11), align=xl_al("left"))
        put(st, f"B{r}", formula, font=xl_font("宋体", 11, True), align=xl_al("right"),
            number_format="#,##0.00" if ("万元" in name or "支出" in name) else "0.0%" if "执行率" in name else "#,##0")
        r += 1
    put(st, "A16", "分状态统计（SUMIFS）", font=xl_font("黑体", 11, True), border=False)
    put(st, "A17", "状态", font=xl_font("黑体", 10, True), fill=xl_fill("D9E2F3"), align=xl_al("center"))
    put(st, "B17", "支出合计", font=xl_font("黑体", 10, True), fill=xl_fill("D9E2F3"), align=xl_al("center"))
    for i, s in enumerate(statuses):
        put(st, f"A{18 + i}", s, align=xl_al("center"))
        put(st, f"B{18 + i}", f'=SUMIFS(台账!F4:F{3 + n},台账!K4:K{3 + n},"{s}")', number_format="#,##0.00")
    ch = BarChart()
    ch.title = "分状态支出合计（万元）"
    d = Reference(st, min_col=2, min_row=17, max_row=20)
    c = Reference(st, min_col=1, min_row=18, max_row=20)
    ch.add_data(d, titles_from_data=True)
    ch.set_categories(c)
    excelize_chart(ch, colors=("70AD47",))
    ch.height, ch.width = 8, 14
    st.add_chart(ch, "D3")
    st.column_dimensions["A"].width = 22
    st.column_dimensions["B"].width = 18
    wb.save(path)
    return {"sheets": ["台账", "统计"], "rows": n, "features": "1200行/RANK/嵌套IF/SUMIFS/图标集/Top10/数据条/自动筛选/千分位"}


# ---------------------------------------------------------------- docx helpers
def rf(run, name="宋体", size=12, bold=False, color=None, italic=False):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    return run


def para(doc, text, *, font="宋体", size=12, bold=False, align=None, indent_pt=None, color=None,
         style=None, space_after=6, space_before=0):
    p = doc.add_paragraph(style=style)
    if align is not None:
        p.alignment = align
    if indent_pt is not None:
        p.paragraph_format.first_line_indent = Pt(indent_pt)
    p.paragraph_format.space_after = Pt(space_after)
    if space_before:
        p.paragraph_format.space_before = Pt(space_before)
    rf(p.add_run(text), font, size, bold, color)
    return p


def add_field(p, instr, *, font="宋体", size=10):
    run = p.add_run()
    rf(run, font, size)
    b = OxmlElement("w:fldChar"); b.set(qn("w:fldCharType"), "begin")
    t = OxmlElement("w:instrText"); t.set(qn("xml:space"), "preserve"); t.text = instr
    e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), "end")
    run._r.append(b); run._r.append(t); run._r.append(e)


def add_hyperlink(paragraph, url, text, *, font="宋体", size=12, color="0563C1"):
    part = paragraph.part
    r_id = part.relate_to(url, docx.opc.constants.RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    hl = OxmlElement("w:hyperlink"); hl.set(qn("r:id"), r_id)
    new_run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    rFonts = OxmlElement("w:rFonts")
    rFonts.set(qn("w:ascii"), font); rFonts.set(qn("w:hAnsi"), font); rFonts.set(qn("w:eastAsia"), font)
    rPr.append(rFonts)
    c = OxmlElement("w:color"); c.set(qn("w:val"), color); rPr.append(c)
    u = OxmlElement("w:u"); u.set(qn("w:val"), "single"); rPr.append(u)
    sz = OxmlElement("w:sz"); sz.set(qn("w:val"), str(int(size * 2))); rPr.append(sz)
    new_run.append(rPr)
    t = OxmlElement("w:t"); t.text = text; new_run.append(t)
    hl.append(new_run)
    paragraph._p.append(hl)
    return hl


def shade(cell, fill="D9E2F3"):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def set_cell(cell, text, *, font="宋体", size=10.5, bold=False, align=None, fill=None):
    cell.text = ""
    p = cell.paragraphs[0]
    if align is not None:
        p.alignment = align
    rf(p.add_run(text), font, size, bold)
    if fill:
        shade(cell, fill)


def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    th = OxmlElement("w:tblHeader"); th.set(qn("w:val"), "true")
    trPr.append(th)


def para_bottom_border(p, color="FF0000", sz=24):
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single"); bottom.set(qn("w:sz"), str(sz))
    bottom.set(qn("w:space"), "1"); bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    pPr.append(pbdr)


def setup_header_footer(doc, header_text, footer_left=""):
    sec = doc.sections[0]
    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rf(hp.add_run(header_text), "宋体", 9, color=GREY)
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if footer_left:
        rf(fp.add_run(footer_left + "    "), "宋体", 9, color=GREY)
    rf(fp.add_run("第 "), "宋体", 9, color=GREY)
    add_field(fp, "PAGE")
    rf(fp.add_run(" 页 / 共 "), "宋体", 9, color=GREY)
    add_field(fp, "NUMPAGES")
    rf(fp.add_run(" 页"), "宋体", 9, color=GREY)
# ---------------------------------------------------------------- docx 03
def make_weekly_report(path, img_path):
    doc = Document()
    stamp_doc(doc)
    normal = doc.styles["Normal"]
    normal.font.name = "宋体"
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    setup_header_footer(doc, "利镖链路 · 项目周报（内部资料，请勿外传）", "编制：项目管理办公室")
    para(doc, "利镖链路 · 智慧园区建设项目周报", font="黑体", size=20, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "第 35 周（2026-09-21 ～ 2026-09-30）", font="楷体", size=12, align=WD_ALIGN_PARAGRAPH.CENTER,
         color=GREY, space_after=14)

    para(doc, "一、本周概览", font="黑体", size=15, bold=True, space_before=6)
    para(doc, "本周项目整体推进平稳，Sprint 12 的 9 项任务完成 7 项，完成率约 78%。"
              "其中「设备到货验收」与「联调环境搭建」已关闭；「BIM 模型更新」因设计院图纸变更顺延至下周。"
              "累计完成产值 1,280.5 万元，占月度计划的 86%（口径：2026-09-30 16:00）。",
         indent_pt=24, space_after=8)

    para(doc, "二、关键进展", font="黑体", size=15, bold=True, space_before=6)
    for item in ["完成园区东区 3 号厂房的设备基础浇筑与养护（第 3 方检测报告已归档）；",
                 "完成视频监控系统 V2.1 的联调，覆盖 128 路摄像机，历史回放延迟 < 2s；",
                 "与业主单位完成第二次需求澄清会，纪要已上传至协同平台（编号：MOM-2026-0918）；",
                 "完成《施工组织设计（修订版）》内部评审，评审意见共 12 条，闭环 10 条。"]:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.space_after = Pt(4)
        rf(p.add_run(item), "宋体", 12)
    for item in ["遗留问题：东区配电房移交时间以业主正式函件为准；", "风险提示：10 月雨季施工窗口缩短；", "资源申请：BIM 工程师 1 人（10 月 8 日进场）。"]:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(4)
        rf(p.add_run(item), "宋体", 12)

    para(doc, "三、工作流进度", font="黑体", size=15, bold=True, space_before=8)
    t1 = doc.add_table(rows=9, cols=4)
    t1.style = "Table Grid"
    t1.alignment = WD_TABLE_ALIGNMENT.CENTER
    t1.cell(0, 0).merge(t1.cell(0, 3))
    set_cell(t1.cell(0, 0), "表 1：工作流进度（截至 2026-09-30）", font="黑体", size=10.5, bold=True,
             align=WD_ALIGN_PARAGRAPH.CENTER, fill="D9E2F3")
    for j, h in enumerate(["工作流", "负责人", "完成度", "风险"]):
        set_cell(t1.cell(1, j), h, font="黑体", size=10.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, fill="F2F2F2")
    rows1 = [["土建施工", "张伟", "85%", "低"], ["设备安装", "李娜", "70%", "中"], ["电气工程", "王强", "60%", "中"],
             ["弱电智能化", "赵敏", "55%", "高"], ["软件平台", "刘洋", "80%", "低"], ["档案与验收", "陈静", "40%", "低"]]
    for i, row in enumerate(rows1):
        for j, v in enumerate(row):
            set_cell(t1.cell(2 + i, j), v, align=WD_ALIGN_PARAGRAPH.CENTER)
    t1.cell(8, 0).merge(t1.cell(8, 3))
    set_cell(t1.cell(8, 0), "备注：完成度为项目管理办公室自评口径；风险等级按红/橙/黄三级转换。",
             font="宋体", size=9.5, align=WD_ALIGN_PARAGRAPH.LEFT, fill="FBFBFB")

    para(doc, "四、风险与问题（含处置）", font="黑体", size=15, bold=True, space_before=10)
    t2 = doc.add_table(rows=7, cols=5)
    t2.style = "Table Grid"
    for j, h in enumerate(["等级", "风险描述", "影响", "责任人", "计划关闭"]):
        set_cell(t2.cell(0, j), h, font="黑体", size=10.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, fill="F2F2F2")
    t2.cell(1, 0).merge(t2.cell(2, 0))
    set_cell(t2.cell(1, 0), "高", font="黑体", size=10.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    set_cell(t2.cell(1, 1), "配电房移交延迟", align=WD_ALIGN_PARAGRAPH.LEFT); set_cell(t2.cell(1, 2), "影响联调", align=WD_ALIGN_PARAGRAPH.LEFT)
    set_cell(t2.cell(1, 3), "张伟", align=WD_ALIGN_PARAGRAPH.CENTER); set_cell(t2.cell(1, 4), "10-15", align=WD_ALIGN_PARAGRAPH.CENTER)
    set_cell(t2.cell(2, 1), "雨季施工窗口缩短", align=WD_ALIGN_PARAGRAPH.LEFT); set_cell(t2.cell(2, 2), "工期风险", align=WD_ALIGN_PARAGRAPH.LEFT)
    set_cell(t2.cell(2, 3), "王强", align=WD_ALIGN_PARAGRAPH.CENTER); set_cell(t2.cell(2, 4), "10-20", align=WD_ALIGN_PARAGRAPH.CENTER)
    t2.cell(3, 0).merge(t2.cell(4, 0))
    set_cell(t2.cell(3, 0), "中", font="黑体", size=10.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    set_cell(t2.cell(3, 1), "BIM 模型与现场不一致", align=WD_ALIGN_PARAGRAPH.LEFT); set_cell(t2.cell(3, 2), "返工风险", align=WD_ALIGN_PARAGRAPH.LEFT)
    set_cell(t2.cell(3, 3), "赵敏", align=WD_ALIGN_PARAGRAPH.CENTER); set_cell(t2.cell(3, 4), "10-12", align=WD_ALIGN_PARAGRAPH.CENTER)
    set_cell(t2.cell(4, 1), "第三方检测排期紧张", align=WD_ALIGN_PARAGRAPH.LEFT); set_cell(t2.cell(4, 2), "验收节点", align=WD_ALIGN_PARAGRAPH.LEFT)
    set_cell(t2.cell(4, 3), "陈静", align=WD_ALIGN_PARAGRAPH.CENTER); set_cell(t2.cell(4, 4), "10-18", align=WD_ALIGN_PARAGRAPH.CENTER)
    t2.cell(5, 0).merge(t2.cell(6, 0))
    set_cell(t2.cell(5, 0), "低", font="黑体", size=10.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    set_cell(t2.cell(5, 1), "档案编目人力不足", align=WD_ALIGN_PARAGRAPH.LEFT); set_cell(t2.cell(5, 2), "进度影响小", align=WD_ALIGN_PARAGRAPH.LEFT)
    set_cell(t2.cell(5, 3), "刘洋", align=WD_ALIGN_PARAGRAPH.CENTER); set_cell(t2.cell(5, 4), "10-25", align=WD_ALIGN_PARAGRAPH.CENTER)
    set_cell(t2.cell(6, 1), "周报模板格式微调", align=WD_ALIGN_PARAGRAPH.LEFT); set_cell(t2.cell(6, 2), "无", align=WD_ALIGN_PARAGRAPH.LEFT)
    set_cell(t2.cell(6, 3), "陈静", align=WD_ALIGN_PARAGRAPH.CENTER); set_cell(t2.cell(6, 4), "已关闭", align=WD_ALIGN_PARAGRAPH.CENTER)

    para(doc, "五、关键路径示意", font="黑体", size=15, bold=True, space_before=10)
    doc.add_picture(img_path, width=Cm(15.2))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    para(doc, "图 1：近两周关键路径（示意；横轴为日期，纵轴为工作流）", font="宋体", size=9.5,
         align=WD_ALIGN_PARAGRAPH.CENTER, color=GREY)

    para(doc, "六、下周计划", font="黑体", size=15, bold=True, space_before=8)
    for item in ["完成东区配电房移交并启动联调（10-08 起）；", "完成 BIM 模型第 4 版并提交业主确认；",
                 "完成 3 号厂房消防验收资料预审；", "启动档案编目专项（外包 2 人）。"]:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(4)
        rf(p.add_run(item), "宋体", 12)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    rf(p.add_run("相关链接："), "宋体", 12)
    add_hyperlink(p, "https://example.com/projects/smart-park/weekly/35", "项目周报协同平台（示例链接）")
    doc.save(path)
    return {"features": "多级标题/项目符号+编号列表/合并单元格表格/页眉页脚+页码域/内嵌插图/超链接/中英混排"}


# ---------------------------------------------------------------- docx 04
def make_management_policy(path):
    doc = Document()
    stamp_doc(doc)
    normal = doc.styles["Normal"]
    normal.font.name = "宋体"
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    setup_header_footer(doc, "文件与档案管理办法（试行）· 内部文件", "文号：利镖制〔2026〕7 号")
    para(doc, "利镖链路科技有限公司", font="黑体", size=18, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "文件与档案管理办法（试行）", font="黑体", size=20, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "（2026 年 9 月 30 日公司总经理办公会审议通过）", font="楷体", size=11,
         align=WD_ALIGN_PARAGRAPH.CENTER, color=GREY, space_after=12)

    chapters = [
        ("第一章 总则", ["第一条 为规范公司文件与档案管理工作，确保文件材料完整、准确、系统与安全，依据《中华人民共和国档案法》及公司相关制度，制定本办法。",
                         "第二条 本办法适用于公司各部门、各项目部及所属单位在经营管理活动中形成的各类文件与档案，包括纸质与电子形式。",
                         "第三条 文件与档案管理实行统一领导、分级管理、集中归档的原则，坚持收集与利用并重、保密与共享结合。"]),
        ("第二章 管理职责", ["第四条 行政部为公司档案管理归口部门，负责制度建设、业务指导、监督检查与档案接收。",
                            "第五条 各部门指定专人担任兼职档案员，负责本部门文件材料的收集、整理、预归档与移交。",
                            "第六条 信息管理部门负责电子档案系统的运行维护、备份与安全防护。",
                            "第七条 涉及国家秘密、商业秘密与个人信息的文件，按有关规定实行专项管理[1]。"]),
        ("第三章 归档范围与保管期限", ["第八条 下列文件材料应当归档：（一）公司治理与重大决策文件；（二）经营与项目管理文件；（三）财务会计文件；（四）人力资源文件；（五）科技与知识产权文件；（六）其他具有保存价值的文件。",
                                      "第九条 档案保管期限分为永久、定期 30 年、定期 10 年。具体期限见附件 1《档案保管期限表》。",
                                      "第十条 电子文件应与纸质文件同步归档；仅以电子形式形成的文件，应按电子档案管理要求保存元数据[2]。"]),
        ("第四章 借阅与利用", ["第十一条 档案借阅实行审批登记制度，涉密档案借阅须经分管领导批准。",
                              "第十二条 借阅人应爱护档案，不得涂改、抽取、损毁；复制件使用完毕后按保密要求处理。",
                              "第十三条 档案归还期限一般不超过 15 个工作日，确需延期的应办理续借手续。"]),
        ("第五章 鉴定与销毁", ["第十四条 行政部会同形成部门定期开展档案鉴定，形成鉴定意见书。",
                              "第十五条 经鉴定确无保存价值的档案，编制销毁清册，报公司分管领导批准后销毁，销毁过程应有两名以上人员监销。",
                              "第十六条 销毁清册永久保存。"]),
        ("第六章 罚则", ["第十七条 违反本办法，造成档案损毁、丢失或泄密的，依规追究相关责任人责任；构成犯罪的，移送司法机关处理。"]),
        ("第七章 附则", ["第十八条 本办法由行政部负责解释。", "第十九条 本办法自发布之日起施行，原有规定与本办法不一致的，以本办法为准。"]),
    ]
    for ci, (title, items) in enumerate(chapters):
        if ci in (2, 4):
            doc.add_page_break()
        para(doc, title, font="黑体", size=15, bold=True, space_before=8, space_after=4)
        for it in items:
            para(doc, it, indent_pt=24, space_after=5)

    doc.add_page_break()
    para(doc, "附件 1：档案保管期限表", font="黑体", size=15, bold=True, space_after=6)
    t = doc.add_table(rows=47, cols=5)
    t.style = "Table Grid"
    for j, h in enumerate(["序号", "档案类别", "主要材料", "保管期限", "责任部门"]):
        set_cell(t.cell(0, j), h, font="黑体", size=10.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, fill="D9E2F3")
    repeat_header(t.rows[0])
    cats = ["公司治理", "会议纪要", "经营合同", "项目立项", "工程结算", "财务会计", "审计报告", "人力资源",
            "社保公积金", "知识产权", "科技研发", "设备档案", "安全生产", "质量记录", "采购档案", "供应商管理",
            "客户服务", "市场推广", "企业资质", "法律事务", "信息系统", "数据备份", "应急预案", "外来文件",
            "荣誉表彰", "培训记录", "考勤薪酬", "离职档案", "项目验收", "竣工图纸", "监理资料", "检测报告",
            "环保资料", "能耗记录", "车辆管理", "办公资产", "印章证照", "党建工作", "工会活动", "对外捐赠",
            "投诉处理", "巡检记录", "维修保养", "能源计量", "物流单据", "样品台账"]
    periods = ["永久", "30 年", "10 年"]
    for i in range(46):
        r = 1 + i
        set_cell(t.cell(r, 0), str(i + 1), align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(t.cell(r, 1), cats[i], align=WD_ALIGN_PARAGRAPH.LEFT)
        set_cell(t.cell(r, 2), "相关审批单、台账与电子副本", font="宋体", size=9.5, align=WD_ALIGN_PARAGRAPH.LEFT)
        set_cell(t.cell(r, 3), periods[(i * 2) % 3], align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(t.cell(r, 4), ["行政部", "财务部", "人力资源部", "工程管理部", "信息管理部"][i % 5], align=WD_ALIGN_PARAGRAPH.CENTER)
    para(doc, "参考文献：[1] 《中华人民共和国档案法》（2020 年修订）；[2] GB/T 18894—2016《电子文件归档与电子档案管理规范》；[3] 公司《信息安全管理办法》。",
         font="宋体", size=10, color=GREY, space_before=8)
    p = doc.add_paragraph()
    rf(p.add_run("外部参考（示例超链接）："), "宋体", 10, color=GREY)
    add_hyperlink(p, "https://example.com/policies/records-management", "公司制度库 · 条目编号 ZD-2026-07", size=10)
    doc.save(path)
    return {"features": "长文档分页/跨页长表（重复表头46行）/章条结构/引用标注/超链接/页脚页码域"}


# ---------------------------------------------------------------- docx 05
def make_official_notice(path, stamp_path):
    doc = Document()
    stamp_doc(doc)
    normal = doc.styles["Normal"]
    normal.font.name = "仿宋"
    normal.font.size = Pt(16)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "仿宋")
    sec = doc.sections[0]
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rf(fp.add_run("— "), "宋体", 10, color=GREY)
    add_field(fp, "PAGE")
    rf(fp.add_run(" —"), "宋体", 10, color=GREY)
    para(doc, "利镖链路科技有限公司文件", font="黑体", size=22, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
         color=RED, space_after=6)
    p = para(doc, "利镖发〔2026〕15 号", font="仿宋", size=14, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    para_bottom_border(p)
    para(doc, "关于开展 2026 年第四季度安全生产大检查的通知", font="黑体", size=18, bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_before=14, space_after=10)
    para(doc, "公司各部门、各项目部：", font="仿宋", size=16, space_after=6)
    para(doc, "为深入贯彻「安全第一、预防为主、综合治理」方针，落实《2026 年度安全生产目标责任书》要求，"
              "经公司安全生产委员会研究决定，自 2026 年 10 月 8 日至 10 月 31 日在全公司范围内开展第四季度安全生产大检查。"
              "现将有关事项通知如下：", indent_pt=32, space_after=8)
    para(doc, "一、检查范围", font="黑体", size=16, bold=False, space_after=4)
    para(doc, "公司各在建项目现场、办公区、仓库及配套生活区，重点为东区厂房、智慧园区联调现场与临时用电设施。",
         indent_pt=32, space_after=8)
    para(doc, "二、检查重点", font="黑体", size=16, bold=False, space_after=4)
    for it in ["（一）安全生产责任制与教育培训记录落实情况；", "（二）危险性较大的分部分项工程专项方案执行情况；",
               "（三）临时用电、消防通道与特种设备运行状况；", "（四）应急预案演练与应急物资储备情况。"]:
        para(doc, it, indent_pt=32, space_after=4)
    para(doc, "三、工作要求", font="黑体", size=16, bold=False, space_before=4, space_after=4)
    para(doc, "各部门要提高政治站位，主要负责人亲自部署；对检查发现的隐患实行「清单化」管理，做到整改措施、责任、资金、时限、预案五落实。"
              "请各部门于 10 月 31 日前将检查总结（含整改台账）报送安全生产委员会办公室（邮箱：aq@example.com，电话：010-8888 6666）。",
         indent_pt=32, space_after=16)
    p = para(doc, "利镖链路科技有限公司", font="仿宋", size=16, align=WD_ALIGN_PARAGRAPH.RIGHT, space_after=2)
    para(doc, "2026 年 9 月 30 日", font="仿宋", size=16, align=WD_ALIGN_PARAGRAPH.RIGHT, space_after=2)
    doc.add_picture(stamp_path, width=Cm(3.4))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.RIGHT
    para(doc, "", space_after=4)
    p = para(doc, "抄送：公司领导，各职能部门，各项目部。", font="仿宋", size=12, color=GREY, space_after=2)
    para_bottom_border(p, color="C00000", sz=8)
    para(doc, "利镖链路科技有限公司行政部　2026 年 9 月 30 日印发", font="仿宋", size=12, color=GREY, space_after=2)
    doc.save(path)
    return {"features": "红头/文号/红色分隔线/仿宋正文/首行缩进/落款右对齐/电子印章插图/版记"}


# ---------------------------------------------------------------- main
def normalize_zip(path):
    import zipfile
    tmp = path + ".tmp"
    with zipfile.ZipFile(path, "r") as zin:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                zi = zipfile.ZipInfo(info.filename, date_time=(2026, 9, 30, 12, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = info.external_attr
                data = zin.read(info.filename)
                if info.filename == "docProps/core.xml":
                    for tag in (b"created", b"modified"):
                        data = re.sub(rb"(<dcterms:" + tag + rb"[^>]*>)[^<]*(</dcterms:" + tag + rb">)",
                                      rb"\g<1>2026-09-30T12:00:00Z\g<2>", data)
                zout.writestr(zi, data)
    os.replace(tmp, path)


def sha256_file(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    img_dir = os.path.join(OUT, "_img")
    os.makedirs(img_dir, exist_ok=True)
    gantt = os.path.join(img_dir, "n1-gantt.png")
    stamp = os.path.join(img_dir, "n1-stamp.png")
    make_gantt_png(gantt)
    make_stamp_png(stamp)
    specs = [
        ("n1-01-fee-summary.xlsx", make_fee_summary),
        ("n1-02-project-ledger.xlsx", make_project_ledger),
        ("n1-03-weekly-report.docx", lambda p: make_weekly_report(p, gantt)),
        ("n1-04-management-policy.docx", make_management_policy),
        ("n1-05-official-notice.docx", lambda p: make_official_notice(p, stamp)),
    ]
    manifest = {"generatedAt": datetime.date.today().isoformat(), "generator": "make_n1_samples.py", "samples": []}
    for fname, fn in specs:
        fp = os.path.join(OUT, fname)
        info = fn(fp) or {}
        normalize_zip(fp)
        entry = {"file": fname, "bytes": os.path.getsize(fp), "sha256": sha256_file(fp)}
        entry.update(info)
        manifest["samples"].append(entry)
        print("{:34s} {:9d}  {}".format(fname, entry["bytes"], entry["sha256"][:16]))
    with open(os.path.join(OUT, "n1-samples.manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print("manifest -> " + os.path.join(OUT, "n1-samples.manifest.json"))


if __name__ == "__main__":
    main()