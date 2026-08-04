# AI Workspace

A polished ChatGPT-inspired AI workspace with a responsive chat interface, local conversation history, markdown-friendly responses, code blocks, and a Groq-powered FastAPI backend.

## Features

- Clean responsive AI chat interface
- Dark and light themes
- Conversation history stored locally in the browser
- New chat, search, rename, delete, and clear chat actions
- Markdown-friendly assistant responses
- Styled code blocks with copy actions
- Typing indicator while the AI is responding
- Responsive sidebar for desktop, tablet, and mobile
- FastAPI backend connected to Groq
- Health-check endpoint and automatic API documentation

## Tech Stack

- HTML, CSS, and vanilla JavaScript
- Python and FastAPI
- Groq API
- Llama 3.3 70B Versatile

## Project Structure

```text
AI Workspace/
|-- backend/
|   |-- main.py
|   |-- requirements.txt
|   |-- .env.example
|   |-- README.md
|   `-- Chatgpt_clone.ipynb
|-- frontend/
|   |-- index.html
|   |-- style.css
|   |-- script.js
|   `-- assets/
|-- .gitignore
`-- README.md
```

## Setup on Windows

### 1. Clone the repository

```powershell
git clone https://github.com/vedantw23/AI-Workspace.git
cd AI-Workspace
```

### 2. Create a Python environment

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install backend dependencies

```powershell
pip install -r backend\requirements.txt
```

### 4. Configure the Groq API key

Create a Groq API key, then set it in the current PowerShell session:

```powershell
$env:GROQ_API_KEY = "your-groq-api-key"
```

You can optionally select another supported Groq model:

```powershell
$env:GROQ_MODEL = "llama-3.3-70b-versatile"
```

Never commit API keys or `.env` files to GitHub.

### 5. Start the application

From the project root:

```powershell
uvicorn backend.main:app --reload --port 8000
```

Open the application at:

```text
http://127.0.0.1:8000
```

## API Endpoints

### Health check

```text
GET /health
```

Response:

```json
{"status":"ok"}
```

### Chat

```text
POST /chat
```

Request body:

```json
{
  "messages": [
    {"role": "user", "content": "Explain quantum computing simply."}
  ],
  "chat_id": "optional-chat-id"
}
```

Response body:

```json
{
  "reply": "Assistant response"
}
```

Interactive API documentation is available at:

```text
http://127.0.0.1:8000/docs
```

## Security

- API keys are read from environment variables.
- Local virtual environments and cache files are ignored by Git.
- The sanitized notebook in `backend/` contains a placeholder instead of a real key.

## License

This project is available for learning, portfolio, and personal development use.
