# AI Workspace Backend

This folder contains the Groq notebook prototype and its FastAPI adapter.

## Run on Windows PowerShell

From the project root:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
$env:GROQ_API_KEY = "your-groq-api-key"
uvicorn backend.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000` to use the frontend and `http://127.0.0.1:8000/docs` to inspect the API.
