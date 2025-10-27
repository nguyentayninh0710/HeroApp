from http.client import HTTPException
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

class CreateUserRequest(BaseModel):
    # ... means requirement.
    username: str = Field(..., descriptio="")
    email: str = Field(..., descripton="")
    password: str = Field(...,min_length=8, description="")
    phone: Optional[str] = Field(None,min_length=10, max_length=20, description="")

    @validator("username")
    def _check_username(cls, v:str):
        v = v.strip() # removes spaces at the start/end (so " alice " becomes "alice").
        if not USERNAME_RE.match(v):
            raise ValueError("Invalid username")
        return v 

    @validator("email")
    def _check_email(cls, v:str):
        v = v.strip()# removes spaces at the start/end (so " alice@gmail.com " becomes "alice@gmail.com").
        if not EMAIL_RE.match(v):
            raise ValueError("Invalid email")
        return v


class CreateUserResponse(BaseModel):
    user_id: int 
    username: str
    email: Optional[str]

class UserItem(BaseModel):
    user_id: int 
    username: str
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: Optional[str] = None

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

def email_exists(cur, email: str, exclude_user_id: Optional[int] = None) -> bool:
    if exclude_user_id is None:
        cur.execute("SELECT 1 FROM `user` WHERE `Email`=%s LIMIT 1", (email,))
    else:
        cur.execute("SELECT 1 FROM `user` WHERE `Email`=%s AND `UserID`<>%s LIMIT 1", (email, exclude_user_id))
    return cur.fetchone() is not None

def username_exists(cur, username: str, exclude_user_id: Optional[int] = None) -> bool:
    if exclude_user_id is None:
        cur.execute("SELECT 1 FROM `user` WHERE `Username`=%s LIMIT 1", (username,))
    else:
        cur.execute("SELECT 1 FROM `user` WHERE `Username`=%s AND `UserID`<>%s LIMIT 1", (username, exclude_user_id))
    return cur.fetchone() is not None 


# ---------- Endpoint: create ---------- 
@app.post("/api/users", response_model=CreateUserResponse, status_code=201)
def create_user(payload: CreateUserRequest):
    try:
        cnx = get_conn()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {e}")

    try:
        cur = cnx.cursor()

        if not table_exists(cur, "user"):
            raise HTTPException(status_code=500, detail="Table 'user' not found in database.")

        cols = get_column(cur, "user")
        expected = {"UserID", "Username", "Email", "PhoneNumber", "PasswordHash", "CreatedAt"}
        # Does not need to match 100%, but must include the columns used below:
        needed = {"Username", "Email", "PhoneNumber", "PasswordHash"}
        if not needed.issubset(cols):
            raise HTTPException(status_code=500, detail="Table 'user' is missing required columns.")

        # Unique checks (Username may not be UNIQUE in the DB → soft check)
        if username_exists(cur, payload.username):
            raise HTTPException(status_code=409, detail="Username already exists")
        if payload.email:
            if email_exists(cur, payload.email):
                raise HTTPException(status_code=409, detail="Email already exists")

        password_hash = (
            hashlib.sha256(payload.password.encode("utf-8")).hexdigest()
            if payload.password
            else None
        )

        cur.execute(
            """
            INSERT INTO `user` (`Username`, `Email`, `PhoneNumber`, `PasswordHash`)
            VALUES (%s, %s, %s, %s)
            """,
            (
                payload.username,
                payload.email,     # can be NULL
                payload.phone,     # can be NULL
                password_hash,     # can be NULL
            ),
        )
        cnx.commit()
        new_id = cur.lastrowid

        return CreateUserResponse(
            user_id=new_id,
            username=payload.username,
            email=payload.email,
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
