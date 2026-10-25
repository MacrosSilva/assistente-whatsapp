"""Inicia o núcleo: python -m app"""
import uvicorn

from .settings import CORE_PORT

if __name__ == "__main__":
    # 127.0.0.1: só este PC acessa. Nunca troque por 0.0.0.0 sem login e HTTPS.
    uvicorn.run("app.main:app", host="127.0.0.1", port=CORE_PORT, log_level="warning")
