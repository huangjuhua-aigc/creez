# Creez Backend - AI image/video generation API（与 mcp_host_backend 一致：用 pyproject.toml + pip install .）
FROM python:3.11-slim

WORKDIR /app

# 复制依赖声明与代码（.env 由 .dockerignore 排除）
COPY pyproject.toml ./
COPY . .

RUN pip install --no-cache-dir .

EXPOSE 8081

CMD ["python", "main.py"]
