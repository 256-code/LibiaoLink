# ============================================================
# LibiaoLink MADLAD 翻译服务（CTranslate2 int8 · CPU 推理）
# ------------------------------------------------------------
# 运行依赖：ctranslate2 + transformers（仅 tokenizer 用途）+ FastAPI/uvicorn。
# 模型（int8，约 3GB）不打进镜像，运行时挂载 ./data/model_ct2 —— 准备见 README。
# 版本与实测环境一致（ct2 4.8.3 / transformers 5.19.0 / python 3.11）。
# ============================================================
FROM python:3.11-slim

RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
    ctranslate2==4.8.3 \
    transformers==5.19.0 \
    fastapi \
    uvicorn

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 5000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5000"]
