from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from log_util import get_logger
from routers.image import router as image_router
from routers.video import router as video_router

logger = get_logger(__name__)

app = FastAPI(title="Creez Backend", description="AI image/video generation for Creez")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(image_router)
app.include_router(video_router)


@app.get("/ping")
async def ping():
    return {"message": "pong"}


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8081,
        reload=True,
    )
