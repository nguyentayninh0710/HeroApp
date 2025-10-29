# user.py — MusicPlayer Users API (CRUD + JWT, bcrypt-compatible)
import os
import re
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Literal, Dict, Any, Tuple

from dotenv import load_dotenv
import mysql.connector
from mysql.connector import errors as mysql_errors
from fastapi import FastAPI, HTTPException, Depends, status, Header, Request
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from starlette.middleware.base import BaseHTTPMiddleware

# ---- optional bcrypt (recommended). If missing, 'pip install bcrypt'
try:
    import bcrypt  # type: ignore
    HAS_BCRYPT = True
except Exception:
    HAS_BCRYPT = False

# ------------------ Load env ------------------
load_dotenv()
DB_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("MYSQL_PORT", "3306"))
DB_USER = os.getenv("MYSQL_USER", "root")
DB_PASS = os.getenv("MYSQL_PASSWORD", "")
DB_NAME = os.getenv("MYSQL_DB", "musicplayer")  # mặc định theo project MusicPlayer

# JWT env
JWT_SECRET = os.getenv("JWT_SECRET", "change_me_super_secret")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "7"))

# ------------------ Regex/Constants -----------------
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,30}$")
EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# ------------------ FastAPI -----------------
app = FastAPI(title="MusicPlayer – Users API", version="1.0")

# CORS (thêm origin của bạn nếu cần)
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

class LogHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # print("[DEBUG] headers:", dict(request.headers))
        response = await call_next(request)
        return response

app.add_middleware(LogHeadersMiddleware)

# ------------------ DB Helpers -----------------
def get_conn():
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS, database=DB_NAME
    )

def table_exists(cur, table_name: str) -> bool:
    cur.execute("SHOW TABLES LIKE %s", (table_name,))
    return cur.fetchone() is not None

# ------------------ Time helpers -----------------
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _epoch(dt: datetime) -> int:
    return int(dt.timestamp())

# ------------------ Password helpers -----------------
def sha256_hash(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()

def is_bcrypt_hash(s: str) -> bool:
    return s.startswith("$2a$") or s.startswith("$2b$") or s.startswith("$2y$")

def bcrypt_hash(plain: str) -> str:
    if not HAS_BCRYPT:
        # fallback nếu chưa cài bcrypt
        return sha256_hash(plain)
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain: str, stored_hash: str) -> bool:
    try:
        if is_bcrypt_hash(stored_hash) and HAS_BCRYPT:
            return bcrypt.checkpw(plain.encode("utf-8"), stored_hash.encode("utf-8"))
        # fallback SHA-256 legacy
        return sha256_hash(plain) == stored_hash
    except Exception:
        return False

# ------------------ JWT helpers -----------------
import jwt  # PyJWT

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
REVOKED_JTI: set[str] = set()

def create_token(sub: str, kind: Literal["access", "refresh"], extra_claims: Dict[str, Any] | None = None) -> Tuple[str, int, str]:
    jti = str(uuid.uuid4())
    iat = _now_utc()
    exp = iat + (timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES) if kind == "access" else timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))
    payload: Dict[str, Any] = {"sub": sub, "jti": jti, "iat": _epoch(iat), "exp": _epoch(exp), "type": kind}
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, _epoch(exp), jti

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], leeway=60)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def ensure_not_revoked(jti: str):
    if jti in REVOKED_JTI:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

# ------------------ Schemas (Pydantic) -----------------
class UserItem(BaseModel):
    user_id: int
    username: str
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: Optional[datetime] = None

class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    email: Optional[str] = None
    password: str = Field(..., min_length=8)
    phone: Optional[str] = Field(None, min_length=7, max_length=20)

    @validator("username")
    def _check_username(cls, v: str):
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("Invalid username (letters/digits, 3–30)")
        return v

    @validator("email")
    def _check_email(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not EMAIL_RE.match(v):
            raise ValueError("Invalid email format")
        return v

class UpdateUserRequest(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=30)
    email: Optional[str] = None
    password: Optional[str] = Field(None, min_length=8)
    phone: Optional[str] = Field(None, min_length=7, max_length=20)

    @validator("username")
    def _v_username(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("Invalid username (letters/digits, 3–30)")
        return v

    @validator("email")
    def _v_email(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not EMAIL_RE.match(v):
            raise ValueError("Invalid email format")
        return v

# ---- Auth Schemas ----
class LoginRequest(BaseModel):
    identifier: str = Field(..., description="email or username")
    password: str = Field(..., min_length=8)

class TokenPairResponse(BaseModel):
    token_type: Literal["bearer"] = "bearer"
    access_token: str
    access_expires_at: int
    refresh_token: str
    refresh_expires_at: int

class RefreshRequest(BaseModel):
    refresh_token: str

class LogoutResponse(BaseModel):
    detail: str

# ------------------ Row mapper -----------------
def _row_to_user_item(row: dict) -> UserItem:
    # row keys are aliased to snake_case in SELECT
    return UserItem(
        user_id=row["user_id"],
        username=row["username"],
        email=row.get("email"),
        phone=row.get("phone"),
        created_at=row.get("created_at"),
    )

# ------------------ Query helpers (table `user`) -----------------
def _fetch_user_by_id(cur, user_id: int) -> Optional[dict]:
    cur.execute(
        """
        SELECT
          `UserID` AS user_id,
          `Username` AS username,
          `Email` AS email,
          `PhoneNumber` AS phone,
          `PasswordHash` AS password_hash,
          `CreatedAt` AS created_at
        FROM `user`
        WHERE `UserID`=%s
        LIMIT 1
        """,
        (user_id,),
    )
    return cur.fetchone()

def _fetch_user_by_email(cur, email: str) -> Optional[dict]:
    cur.execute(
        """
        SELECT
          `UserID` AS user_id,
          `Username` AS username,
          `Email` AS email,
          `PhoneNumber` AS phone,
          `PasswordHash` AS password_hash,
          `CreatedAt` AS created_at
        FROM `user`
        WHERE `Email`=%s
        LIMIT 1
        """,
        (email,),
    )
    return cur.fetchone()

def _fetch_user_by_username(cur, username: str) -> Optional[dict]:
    cur.execute(
        """
        SELECT
          `UserID` AS user_id,
          `Username` AS username,
          `Email` AS email,
          `PhoneNumber` AS phone,
          `PasswordHash` AS password_hash,
          `CreatedAt` AS created_at
        FROM `user`
        WHERE `Username`=%s
        LIMIT 1
        """,
        (username,),
    )
    return cur.fetchone()

def _email_exists(cur, email: str, exclude_user_id: Optional[int] = None) -> bool:
    if exclude_user_id is None:
        cur.execute("SELECT 1 FROM `user` WHERE `Email`=%s LIMIT 1", (email,))
    else:
        cur.execute("SELECT 1 FROM `user` WHERE `Email`=%s AND `UserID`<>%s LIMIT 1", (email, exclude_user_id))
    return cur.fetchone() is not None

def _username_exists(cur, username: str, exclude_user_id: Optional[int] = None) -> bool:
    if exclude_user_id is None:
        cur.execute("SELECT 1 FROM `user` WHERE `Username`=%s LIMIT 1", (username,))
    else:
        cur.execute("SELECT 1 FROM `user` WHERE `Username`=%s AND `UserID`<>%s LIMIT 1", (username, exclude_user_id))
    return cur.fetchone() is not None

# ------------------ Auth dependency -----------------
def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    data = decode_token(token)
    ensure_not_revoked(data.get("jti", ""))
    if data.get("type") != "access":
        raise HTTPException(status_code=401, detail="Not an access token")
    user_id = int(data.get("sub"))
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        row = _fetch_user_by_id(cur, user_id)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {"user_id": row["user_id"], "username": row["username"], "email": row["email"]}
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

# ------------------ CRUD APIs -----------------
@app.get("/api/users", response_model=List[UserItem])
def list_users():
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        if not table_exists(cur, "user"):
            raise HTTPException(status_code=500, detail="Table `user` not found")
        cur.execute(
            """
            SELECT
              `UserID` AS user_id,
              `Username` AS username,
              `Email` AS email,
              `PhoneNumber` AS phone,
              `CreatedAt` AS created_at
            FROM `user`
            ORDER BY `UserID` ASC
            """
        )
        rows = cur.fetchall() or []
        return [_row_to_user_item(r) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.get("/api/users/{user_id}", response_model=UserItem)
def get_user(user_id: int):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        row = _fetch_user_by_id(cur, user_id)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return _row_to_user_item(row)
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.post("/api/users", response_model=UserItem, status_code=201)
def create_user(payload: CreateUserRequest):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        if not table_exists(cur, "user"):
            raise HTTPException(status_code=500, detail="Table `user` not found")

        # soft unique checks (vì DB có thể chưa đặt UNIQUE)
        if payload.email and _email_exists(cur, payload.email):
            raise HTTPException(status_code=409, detail="Email already exists")
        if _username_exists(cur, payload.username):
            raise HTTPException(status_code=409, detail="Username already exists")

        pwd_hash = bcrypt_hash(payload.password)

        cur.execute(
            """
            INSERT INTO `user` (`Username`, `Email`, `PhoneNumber`, `PasswordHash`)
            VALUES (%s, %s, %s, %s)
            """,
            (payload.username.strip(),
             (payload.email.strip() if payload.email else None),
             (payload.phone.strip() if payload.phone else None),
             pwd_hash),
        )
        cnx.commit()
        new_id = cur.lastrowid
        row = _fetch_user_by_id(cur, new_id)
        return _row_to_user_item(row)
    except mysql_errors.IntegrityError as e:
        cnx.rollback()
        # tôn trọng UNIQUE thực tế trong DB (nếu có)
        raise HTTPException(status_code=409, detail=f"Integrity error: {e.msg}")
    except Exception as e:
        cnx.rollback()
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.put("/api/users/{user_id}", response_model=UserItem)
def update_user(user_id: int, payload: UpdateUserRequest):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        row = _fetch_user_by_id(cur, user_id)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        if payload.email and _email_exists(cur, payload.email, exclude_user_id=user_id):
            raise HTTPException(status_code=409, detail="Email already exists")
        if payload.username and _username_exists(cur, payload.username, exclude_user_id=user_id):
            raise HTTPException(status_code=409, detail="Username already exists")

        sets, vals = [], []

        def add_set(col: str, val):
            sets.append(f"`{col}`=%s"); vals.append(val)

        if payload.username is not None: add_set("Username", payload.username.strip())
        if payload.email is not None: add_set("Email", payload.email.strip() if payload.email else None)
        if payload.phone is not None: add_set("PhoneNumber", payload.phone.strip() if payload.phone else None)
        if payload.password is not None:
            add_set("PasswordHash", bcrypt_hash(payload.password))

        if not sets:
            return _row_to_user_item(row)

        sql = f"UPDATE `user` SET {', '.join(sets)} WHERE `UserID`=%s"
        vals.append(user_id)
        cur.execute(sql, tuple(vals))
        cnx.commit()

        row2 = _fetch_user_by_id(cur, user_id)
        return _row_to_user_item(row2)
    except HTTPException:
        raise
    except Exception as e:
        cnx.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        cur.execute("DELETE FROM `user` WHERE `UserID`=%s", (user_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
        cnx.commit()
        return {"detail": "User deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        cnx.rollback()
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

# ------------------ Auth (JWT) -----------------
@app.post("/api/auth/login", response_model=TokenPairResponse)
def login(payload: LoginRequest):
    ident = payload.identifier.strip()
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        user = _fetch_user_by_email(cur, ident) if EMAIL_RE.match(ident) else _fetch_user_by_username(cur, ident)
        if not user or not verify_password(payload.password, user.get("password_hash") or ""):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        access_token, access_exp, _ = create_token(
            sub=str(user["user_id"]),
            kind="access",
            extra_claims={"username": user["username"], "email": user.get("email")}
        )
        refresh_token, refresh_exp, _ = create_token(sub=str(user["user_id"]), kind="refresh")

        return TokenPairResponse(
            access_token=access_token,
            access_expires_at=access_exp,
            refresh_token=refresh_token,
            refresh_expires_at=refresh_exp,
        )
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.post("/api/auth/refresh", response_model=TokenPairResponse)
def refresh_token(payload: RefreshRequest):
    data = decode_token(payload.refresh_token)
    ensure_not_revoked(data.get("jti", ""))
    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Not a refresh token")
    user_id = int(data.get("sub"))

    old_jti = data.get("jti")
    if old_jti:
        REVOKED_JTI.add(old_jti)

    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        user = _fetch_user_by_id(cur, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        access_token, access_exp, _ = create_token(
            sub=str(user_id), kind="access",
            extra_claims={"username": user["username"], "email": user.get("email")}
        )
        new_refresh, refresh_exp, _ = create_token(sub=str(user_id), kind="refresh")
        return TokenPairResponse(
            access_token=access_token,
            access_expires_at=access_exp,
            refresh_token=new_refresh,
            refresh_expires_at=refresh_exp,
        )
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.post("/api/auth/logout", response_model=LogoutResponse)
def logout(authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=400, detail="Missing Bearer token in Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    data = decode_token(token)
    jti = data.get("jti")
    if not jti:
        raise HTTPException(status_code=400, detail="Token missing jti")
    REVOKED_JTI.add(jti)
    return LogoutResponse(detail="Logged out (access token revoked).")

@app.get("/api/me", response_model=UserItem)
def read_me(current=Depends(get_current_user)):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        row = _fetch_user_by_id(cur, int(current["user_id"]))
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return _row_to_user_item(row)
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

# ------------------ Dev runner ------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("user:app", host="0.0.0.0", port=8000, reload=True)
