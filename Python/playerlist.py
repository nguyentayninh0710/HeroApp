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
TITLE_RE = re.compile(r"^[a-zA-Z0-9]{3,30}$")



#-------- FastAPI -----------
app = FastAPI(title="MusicPlayer API", version ="1.0")

class CreatePlayerListRequest(BaseModel):
    # ... means requirement.
    playerlist_id: int = Field(..., descriptio="")
    title: str = Field(..., descripton="")
    userId: int = Field(..., description="")
    
    @validator("title")
    def _check_title(cls, v:str):
        v = v.strip() # removes spaces at the start/end (so " alice " becomes "alice").
        if not TITLE_RE.match(v):
            raise ValueError("Invalid title")
        return v 


class CreatePlayerListResponse(BaseModel):
    playerlist_id: int 
    title: str

class PlayerListItem(BaseModel):
    playerlist_id: int 
    title: str
    created_at: Optional[str] = None
    user_id: int 

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

def get_columns(cur, table_name) -> set: 
    cur.execute(f"DESCRIBE `{table_name}")
    rows = cur.fechall() or []
    return {r[0] for r in rows} if rows and not isinstance(rows[0], dict) else {r.get("Field") for r in rows}


def title_exists(cur, title: str, exclude_playerlist_id: Optional[int] = None) -> bool:
    if exclude_playerlist_id is None:
        cur.execute("SELECT 1 FROM `playerlist` WHERE `title`=%s LIMIT 1", (title,))
    else:
        cur.execute("SELECT 1 FROM `playerlist` WHERE `title`=%s AND `playerlist`<>%s LIMIT 1", (title, exclude_playerlist_id))
    return cur.fetchone() is not None 


# ---------- Endpoint: create ---------- 
@app.post("/api/playerlist", response_model=CreatePlayerListResponse, status_code=201)
def create_playerlist(payload: CreatePlayerListRequest):
    try:
        cnx = get_conn()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {e}")

    try:
        cur = cnx.cursor()

        if not table_exists(cur, "playerlist"):
            raise HTTPException(status_code=500, detail="Table'playerlist' not found in database.")
        cols = get_columns(cur, "playerlist")
        expected = {"PlayerListID", "Title", "CreatedAt", "UserID"}
        # Does not need to match 100%, but must include the columns used below:
        needed = {"PlayerListID", "Title", "CreatedAt", "UserID"}
        if not needed.issubset(cols):
            raise HTTPException(status_code=500, detail="Table 'playerlist' is missing required columns.")

        # Unique checks (Username may not be UNIQUE in the DB → soft check)
        if title_exists(cur, payload .title):
            raise HTTPException(status_code=409, detail="Title already exists")



        cur.execute(
            """
            INSERT INTO `playerlist` (`Title`, `UserID`)
            VALUES (%s, %s)
            """,
            (
                payload.title,
                payload.userId    
            ),
        )
        cnx.commit()
        new_id = cur.lastrowid

        return CreatePlayerListResponse(
            playerlist_id=new_id,
            title=payload.title
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