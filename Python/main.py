from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from user import app as user_app
from song import app as song_app

app = FastAPI(title="MusicPlayer API", version="1.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500", "http://localhost:5500",
        "http://127.0.0.1:5501", "http://localhost:5501",
        "http://127.0.0.1:5502", "http://localhost:5502",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routes from user_app and song_app
app.include_router(user_app.router)
app.include_router(song_app.router)

if __name__ == "__main__":
    # Run the combined application on port 8000
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)