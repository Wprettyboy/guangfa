FROM vllm/vllm-openai:v0.21.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl fontconfig fonts-noto-core fonts-noto-cjk libgl1 \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir --break-system-packages "mineru[core]==3.4.4" \
    && MINERU_MODEL_SOURCE=modelscope mineru-models-download -s modelscope -m all

ENV MINERU_MODEL_SOURCE=local
