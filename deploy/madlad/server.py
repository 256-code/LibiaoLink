"""LibiaoLink MADLAD 翻译服务 · LibreTranslate 兼容接口（deploy/madlad/）。

契约（与 deploy/libretranslate 完全一致，前端零改动可切换）：
  POST /translate  {q: str | [str], source: "zh", target: "en", format: "text"}
    -> {translatedText: str | [str]}
  GET /health -> {"status": "ok"}
  GET /languages -> [{"code": "zh"}, {"code": "en"}]（形态对齐 LibreTranslate，供探活工具）

引擎：CTranslate2 int8 跑 google/madlad400-3b-mt（T5 架构 · Apache-2.0）。
决策背景（2026-10-13「我觉得当前模型的翻译水平太差了……Apache 系的 MADLAD」）：
替换 Argos/OPUS-MT 小模型；实测质量对比见 README「实测」。纯内网 CPU 推理、数据零外发。

MADLAD 用法：目标语言标记 <2xx> + 源文本（如 "<2en> 这是一句中文"）。
注意（实测 2026-10-13）：T5TokenizerFast 必须默认加载 —— transformers 5.x 会提示可加
fix_mistral_regex=True，但该开关会把 <2en> 拆成 5 个 token、译文直接崩溃，切勿开启。
"""
import os
import warnings
from typing import List, Union

import ctranslate2
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import T5TokenizerFast

# 该提示仅针对 Mistral 系正则语义；对 T5/MADLAD 默认行为正确（见模块 docstring），压掉日志噪音。
warnings.filterwarnings("ignore", message=".*incorrect regex pattern.*")

MODEL_DIR = os.environ.get("MADLAD_MODEL_DIR", "/models/model_ct2")
BEAM_SIZE = int(os.environ.get("MADLAD_BEAM_SIZE", "4"))
INTRA_THREADS = int(os.environ.get("MADLAD_INTRA_THREADS", "4"))
MAX_DECODING = int(os.environ.get("MADLAD_MAX_DECODING", "512"))

app = FastAPI(title="LibiaoLink MADLAD Translate", version="1.0.0")

translator = ctranslate2.Translator(
    MODEL_DIR, device="cpu", compute_type="int8", intra_threads=INTRA_THREADS
)
tokenizer = T5TokenizerFast.from_pretrained(MODEL_DIR)


class TranslateRequest(BaseModel):
    q: Union[str, List[str]]
    source: str = "zh"
    target: str = "en"
    format: str = "text"


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/languages")
def languages() -> list:
    return [{"code": "zh"}, {"code": "en"}]


@app.post("/translate")
def translate(req: TranslateRequest) -> dict:
    texts = [req.q] if isinstance(req.q, str) else list(req.q)
    # <2xx> 是 MADLAD-400 的目标语言标记（tokenizer.json 以 added token 承载，单个 token）。
    batch_tokens = []
    for text in texts:
        ids = tokenizer.encode(f"<2{req.target}> {text}", add_special_tokens=False)
        batch_tokens.append(tokenizer.convert_ids_to_tokens(ids))
    results = translator.translate_batch(
        batch_tokens, beam_size=BEAM_SIZE, max_decoding_length=MAX_DECODING
    )
    out = []
    for res in results:
        ids = tokenizer.convert_tokens_to_ids(res.hypotheses[0])
        out.append(tokenizer.decode(ids, skip_special_tokens=True))
    return {"translatedText": out if isinstance(req.q, list) else out[0]}
