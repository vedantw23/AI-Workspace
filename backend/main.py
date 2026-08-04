import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from groq import Groq
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    chat_id: str | None = None


app = FastAPI(title="AI Workspace API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_groq_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not configured on the server.",
        )
    return Groq(api_key=api_key)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest) -> dict[str, str]:
    if not request.messages:
        raise HTTPException(status_code=400, detail="At least one message is required.")

    client = get_groq_client()

    try:
        response = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            messages=[message.model_dump() for message in request.messages],
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {error}") from error

    reply = response.choices[0].message.content or "I did not receive a response."
    return {"reply": reply}


frontend_dir = Path(__file__).resolve().parents[1] / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
