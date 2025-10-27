import os # The os tool helps us work with the computer system.
import re #The re tool is for regular expressions (pattern matching in text).
import hashlib #The hashlib tool lets us make hashes (one-way codes) of passwords.
from datetime import date #We take date from the datetime library.
from typing import Optional # Optional means a value can be there or not there.

from dotenv import load_dotenv # reads a .env file that stores secrets (like DB password).
from fastapi import FastAPI, HTTPException  #FastAPI helps us build a web API quickly. HTTPException lets us send clear error messages to the client.
from pydantic import BaseModel, Field, validator 
# Pydantic helps us define and validate data shapes.
# BaseModel: make a model (like a form) for request/response data.
# Field: add extra rules (max length, default value).
# validator: write custom checks (e.g., “username must be letters/numbers only”).

import mysql.connector 
from  mysql.connector import errors as mysql_errors 

#-------- LOAD ENV -----------
load_dotenv() # This reads the .env file (a hidden text file) and loads key–value pairs into the environment
DB_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("MYSQL_PORT", "3306"))
DB_USER = os.getenv("MYSQL_USER", "root")
DB_PASS = os.getenv("MYSQL_PASSWORD", "")
DB_NAME = os.getenv("MYSQL_DB", "NewMusicPlayer") 

#-------- REGEX -----------
# ^ and $: start and end of the whole string (no extra spaces or characters).
# [a-zA-Z0-9]: only letters (A–Z, a–z) and numbers (0–9).
# {3,30}: length must be between 3 and 30 characters.
USERNAME_RE = re.compile(r"^[a-zA-Z0-9]{3,30}$")
# The username part (before @) must be letters, numbers, dot ., underscore _, percent %, plus +, or hyphen -. At least 1 char.
# Must contain an @
# The domain part (after @ and before the final dot) must be letters, numbers, dot ., or hyphen -. At least 1 char.
# A dot, then a top-level domain with at least 2 letters (e.g., com, vn, edu). End of string.
EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


#-------- FastAPI -----------
app = FastAPI(title="MusicPlayer API", version ="1.0")

class CreateSongRequest(BaseModel):
    # ... means requirement.
    genre: str = Field(..., descriptio="")
    language: str = Field(..., descripton="")
    title: str = Field(..., description="")
    url_file: str = Field(..., description="")
    lyrics: Optional[str] = Field(..., description="")
    song_id: int  = Field(..., description="")
    duration: int = Field(..., description="")

    @validator("language")
    def _check_username(cls, v:str):
        v = v.strip() # removes spaces at the start/end (so " alice " becomes "alice").
        if v.match("kr") or v.match("en") or v.match("cn"):
            raise ValueError("Invalid language")
        return v 




class CreateSongResponse(BaseModel):
    song_id: int 
    lyrics: Optional[str]
    url_file: str

class SongItem(BaseModel):
    language: int 
    genre: str
    title: str 
    duration: int
    lyrics: Optional[str]
    song_id: int
    url_file: str


def get_conn():
    return mysql.connector.connect(
        host = DB_HOST,
        port = DB_PORT,
        user = DB_USER,
        password = DB_PASS,
        database = DB_NAME
    )

def table_exists(cur, table_name: str) -> bool:
    cur.execute("SHOW TABLE LIKE %s", (table_name,))
    return cur.fetchone() is not None 

def get_column(cur, table_name) -> set: 
    cur.execute(f"DESCRIBE `{table_name}")
    rows = cur.fechall() or []
    return {r[0] for r in rows} if rows and not isinstance(rows[0], dict) else {r.get("Field") for r in rows}



def title_exists(cur, title: str, exclude_song_id: int = None) -> bool:
    if exclude_song_id is None:
        cur.execute("SELECT 1 FROM `song` WHERE `song`=%s LIMIT 1", (title))
    else:
        cur.execute("SELECT 1 FROM `song` WHERE `song`=%s AND `songID`<>%s LIMIT 1", (title, exclude_song_id))
    return cur.fetchone() is not None 


# ---------- Endpoint: create ---------- 
@app.post("/api/song", response_model=CreateSongResponse, status_code=201)
def create_song(payload: CreateSongRequest):
    try:
        cnx = get_conn()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {e}")

    try:
        cur = cnx.cursor()

        if not table_exists(cur, "song"):
            raise HTTPException(status_code=500, detail="Table 'song' not found in database.")

        cols = get_columns(cur, "song")
        expected = {"Duration", "Title", "URL_File", "Genre", "Language", "Lyrics"}
        # Does not need to match 100%, but must include the columns used below:
        needed = {"Duration", "Title", "URL_File", "Genre", "Language", "Lyrics"}
        if not needed.issubset(cols):
            raise HTTPException(status_code=500, detail="Table 'song' is missing required columns.")

        # Unique checks (Username may not be UNIQUE in the DB → soft check)
        if language_exists(cur, payload.language):
            raise HTTPException(status_code=409, detail="This language already exists")
        if payload.lyrics:
            if lyrics_exists(cur, payload.lyrics):
                raise HTTPException(status_code=409, detail="Lyrics at here already exists")

        cur.execute(
            """
            INSERT INTO `song` (`Title`, `Duration`, `URL_File`, `Genre`, `language`, `lyrics`)
            VALUES (%s, %s, %s, %s,%s,%s)
            """,
            (
                payload.language,
                payload.lyrics,     # can be NULL
                payload.title,     # can be NULL
             ),
        )
        cnx.commit()
        new_id = cur.lastrowid

        return CreateSongResponse(
            song_id=new_id,
            title=payload.title,
            duration=payload.duration,
        )

    except HTTPException:
        raise
    except mysql_errors.IntegrityError as e:
        # Respect DB UNIQUE constraints (Email)
        raise HTTPException(status_code=409, detail=f"Integrity error: {e.msg}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Insert failed: {e}")
    finally:
        try:
            cur.close()
            cnx.close()
        except Exception:
            pass
