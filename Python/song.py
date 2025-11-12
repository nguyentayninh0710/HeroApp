# song.py — MusicPlayer Songs API (CRUD + JWT-guarded writes)
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal, Dict, Any

from dotenv import load_dotenv
import mysql.connector
from mysql.connector import errors as mysql_errors
from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field, validator

# ------------------ Load env & DB ------------------
load_dotenv()
DB_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("MYSQL_PORT", "3306"))
DB_USER = os.getenv("MYSQL_USER", "root")
DB_PASS = os.getenv("MYSQL_PASSWORD", "")
DB_NAME = os.getenv("MYSQL_DB", "musicplayer")

# JWT env (dùng chung với user.py)
JWT_SECRET = os.getenv("JWT_SECRET", "change_me_super_secret")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

def get_conn():
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS, database=DB_NAME
    )

def table_exists(cur, table_name: str) -> bool:
    cur.execute("SHOW TABLES LIKE %s", (table_name,))
    return cur.fetchone() is not None

# ------------------ FastAPI & CORS ------------------
app = FastAPI(title="MusicPlayer – Songs API", version="1.0")

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

# ------------------ Auth helpers (reuse JWT) ------------------
import jwt  # PyJWT
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], leeway=60)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def require_access(token: str = Depends(oauth2_scheme)) -> dict:
    data = decode_token(token)
    if data.get("type") != "access":
        raise HTTPException(status_code=401, detail="Not an access token")
    return data

# ------------------ Validators & utils ------------------
URL_RE = re.compile(r"^https?://[^\s]{3,}$")
TIME_RE = re.compile(r"^(?P<h>\d{1,2}):(?P<m>[0-5]\d):(?P<s>[0-5]\d)$")

def norm_duration(val: Optional[str]) -> Optional[str]:
    """
    Accepts: 'HH:MM:SS' or 'M:SS' or 'MM:SS' or total seconds (int)
    Returns: 'HH:MM:SS' or None
    """
    if not val:
        return None
    s = val.strip()
    if TIME_RE.match(s):
        # already HH:MM:SS
        return s
    # Try M:SS or MM:SS
    parts = s.split(":")
    if len(parts) == 2 and all(p.isdigit() for p in parts):
        m, sec = parts
        m = int(m); sec = int(sec)
        if 0 <= m <= 599 and 0 <= sec <= 59:
            h = m // 60
            m2 = m % 60
            return f"{h:02d}:{m2:02d}:{sec:02d}"
    # Try seconds only (integer)
    if s.isdigit():
        total = int(s)
        if 0 <= total <= 24*3600:
            h = total // 3600
            rem = total % 3600
            m = rem // 60
            sec = rem % 60
            return f"{h:02d}:{m:02d}:{sec:02d}"
    raise ValueError("Invalid duration format. Use HH:MM:SS, MM:SS, M:SS, or total seconds.")

def _validate_url_or_none(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if len(v) > 500:
        raise ValueError("URL too long (max 500)")
    if not URL_RE.match(v):
        raise ValueError("Invalid URL (must start with http/https)")
    return v

# ------------------ Schemas ------------------
class SongItem(BaseModel):
    song_id: int
    title: Optional[str] = None
    duration: Optional[str] = Field(None, description="HH:MM:SS")
    url_file: Optional[str] = None
    cover_image_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    genre: Optional[str] = None
    language: Optional[str] = None
    lyrics: Optional[str] = None
    spotify_track_id: Optional[str] = None
    spotify_track_uri: Optional[str] = None
    spotify_track_url: Optional[str] = None
    spotify_preview_url: Optional[str] = None

class CreateSongRequest(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    duration: Optional[str] = Field(None, description="HH:MM:SS | MM:SS | seconds")
    url_file: Optional[str] = None
    cover_image_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    genre: Optional[str] = Field(None, max_length=100)
    language: Optional[str] = Field(None, max_length=50)
    lyrics: Optional[str] = None
    spotify_track_id: Optional[str] = Field(None, max_length=64)
    spotify_track_uri: Optional[str] = Field(None, max_length=128)
    spotify_track_url: Optional[str] = Field(None, max_length=255)
    spotify_preview_url: Optional[str] = Field(None, max_length=255)

    @validator("duration")
    def _v_duration(cls, v):
        return norm_duration(v) if v else None

    @validator("url_file", "cover_image_url", "thumbnail_url", "spotify_track_url", "spotify_preview_url")
    def _v_urls(cls, v):
        return _validate_url_or_none(v)

class UpdateSongRequest(CreateSongRequest):
    # For update, all fields optional; duration validator still applies.
    pass

# ------------------ Row mapper ------------------
# IMPORTANT: use %H:%i:%S (capital %S) to avoid mysql-connector treating '%s' as a placeholder
SELECT_FIELDS = """
    `SongID`            AS song_id,
    `Title`             AS title,
    TIME_FORMAT(`Duration`, '%H:%i:%S') AS duration,
    `URL_File`          AS url_file,
    `CoverImageURL`     AS cover_image_url,
    `ThumbnailURL`      AS thumbnail_url,
    `Genre`             AS genre,
    `Language`          AS language,
    `Lyrics`            AS lyrics,
    `SpotifyTrackID`    AS spotify_track_id,
    `SpotifyTrackURI`   AS spotify_track_uri,
    `SpotifyTrackURL`   AS spotify_track_url,
    `SpotifyPreviewURL` AS spotify_preview_url
"""

def _fetch_song_by_id(cur, song_id: int) -> Optional[dict]:
    cur.execute(
        f"SELECT {SELECT_FIELDS} FROM `song` WHERE `SongID`=%s LIMIT 1",
        (song_id,),
    )
    return cur.fetchone()

# ------------------ Endpoints ------------------
@app.get("/api/songs", response_model=List[SongItem])
def list_songs(
    q: Optional[str] = Query(None, description="search in title/genre/language"),
    title: Optional[str] = None,
    genre: Optional[str] = None,
    language: Optional[str] = None,
    has_preview: Optional[int] = Query(None, ge=0, le=1, description="1 = only rows with SpotifyPreviewURL"),
    sort: Optional[str] = Query("id_desc", description="id_asc|id_desc|title_asc|title_desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        if not table_exists(cur, "song"):
            raise HTTPException(status_code=500, detail="Table `song` not found")

        where = []
        vals: List[Any] = []

        if q:
            like = f"%{q.strip()}%"
            where.append("(Title LIKE %s OR Genre LIKE %s OR Language LIKE %s)")
            vals += [like, like, like]
        if title:
            where.append("Title LIKE %s")
            vals.append(f"%{title.strip()}%")
        if genre:
            where.append("Genre LIKE %s")
            vals.append(f"%{genre.strip()}%")
        if language:
            where.append("Language LIKE %s")
            vals.append(f"%{language.strip()}%")
        if has_preview is not None:
            if has_preview == 1:
                where.append("SpotifyPreviewURL IS NOT NULL AND SpotifyPreviewURL <> ''")
            else:
                where.append("(SpotifyPreviewURL IS NULL OR SpotifyPreviewURL = '')")

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        s = (sort or "").lower().strip()
        if   s == "id_asc":      order = "ORDER BY `SongID` ASC"
        elif s == "title_asc":   order = "ORDER BY `Title` ASC"
        elif s == "title_desc":  order = "ORDER BY `Title` DESC"
        else:                    order = "ORDER BY `SongID` DESC"  # default id_desc

        offset = (page - 1) * page_size
        limit_clause = f"LIMIT {int(page_size)} OFFSET {int(offset)}"

        sql = f"SELECT {SELECT_FIELDS} FROM `song` {where_sql} {order} {limit_clause}"
        cur.execute(sql, tuple(vals))  # only bind WHERE params
        rows = cur.fetchall() or []
        return rows

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass


@app.get("/api/songs/{song_id}", response_model=SongItem)
def get_song(song_id: int):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        row = _fetch_song_by_id(cur, song_id)
        if not row:
            raise HTTPException(status_code=404, detail="Song not found")
        return row
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.post("/api/songs", response_model=SongItem, status_code=201)
def create_song(payload: CreateSongRequest, _auth=Depends(require_access)):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        if not table_exists(cur, "song"):
            raise HTTPException(status_code=500, detail="Table `song` not found")

        sql = """
            INSERT INTO `song`
            (`Title`,`Duration`,`URL_File`,`CoverImageURL`,`ThumbnailURL`,
             `Genre`,`Language`,`Lyrics`,
             `SpotifyTrackID`,`SpotifyTrackURI`,`SpotifyTrackURL`,`SpotifyPreviewURL`)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        vals = (
            (payload.title.strip() if payload.title else None),
            payload.duration,  # already HH:MM:SS or None
            _validate_url_or_none(payload.url_file),
            _validate_url_or_none(payload.cover_image_url),
            _validate_url_or_none(payload.thumbnail_url),
            (payload.genre.strip() if payload.genre else None),
            (payload.language.strip() if payload.language else None),
            payload.lyrics,
            (payload.spotify_track_id.strip() if payload.spotify_track_id else None),
            (payload.spotify_track_uri.strip() if payload.spotify_track_uri else None),
            _validate_url_or_none(payload.spotify_track_url),
            _validate_url_or_none(payload.spotify_preview_url),
        )
        cur.execute(sql, vals)
        cnx.commit()
        new_id = cur.lastrowid
        row = _fetch_song_by_id(cur, new_id)
        return row
    except mysql_errors.IntegrityError as e:
        cnx.rollback()
        raise HTTPException(status_code=409, detail=f"Integrity error: {e.msg}")
    except Exception as e:
        cnx.rollback()
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")
    finally:
        try:
            cur.close(); cnx.close()
        except Exception:
            pass

@app.put("/api/songs/{song_id}", response_model=SongItem)
def update_song(song_id: int, payload: UpdateSongRequest, _auth=Depends(require_access)):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        row = _fetch_song_by_id(cur, song_id)
        if not row:
            raise HTTPException(status_code=404, detail="Song not found")

        sets = []
        vals: List[Any] = []

        def add(col: str, val):
            sets.append(f"`{col}`=%s"); vals.append(val)

        if payload.title is not None:
            add("Title", payload.title.strip() if payload.title else None)
        if payload.duration is not None:
            add("Duration", norm_duration(payload.duration) if payload.duration else None)
        if payload.url_file is not None:
            add("URL_File", _validate_url_or_none(payload.url_file))
        if payload.cover_image_url is not None:
            add("CoverImageURL", _validate_url_or_none(payload.cover_image_url))
        if payload.thumbnail_url is not None:
            add("ThumbnailURL", _validate_url_or_none(payload.thumbnail_url))
        if payload.genre is not None:
            add("Genre", payload.genre.strip() if payload.genre else None)
        if payload.language is not None:
            add("Language", payload.language.strip() if payload.language else None)
        if payload.lyrics is not None:
            add("Lyrics", payload.lyrics)
        if payload.spotify_track_id is not None:
            add("SpotifyTrackID", payload.spotify_track_id.strip() if payload.spotify_track_id else None)
        if payload.spotify_track_uri is not None:
            add("SpotifyTrackURI", payload.spotify_track_uri.strip() if payload.spotify_track_uri else None)
        if payload.spotify_track_url is not None:
            add("SpotifyTrackURL", _validate_url_or_none(payload.spotify_track_url))
        if payload.spotify_preview_url is not None:
            add("SpotifyPreviewURL", _validate_url_or_none(payload.spotify_preview_url))

        if not sets:
            return row

        sql = f"UPDATE `song` SET {', '.join(sets)} WHERE `SongID`=%s"
        vals.append(song_id)
        cur.execute(sql, tuple(vals))
        cnx.commit()

        row2 = _fetch_song_by_id(cur, song_id)
        return row2
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

@app.delete("/api/songs/{song_id}")
def delete_song(song_id: int, _auth=Depends(require_access)):
    try:
        cnx = get_conn(); cur = cnx.cursor(dictionary=True)
        cur.execute("DELETE FROM `song` WHERE `SongID`=%s", (song_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Song not found")
        cnx.commit()
        return {"detail": "Song deleted successfully."}
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

# ------------------ Dev runner ------------------
if __name__ == "__main__":
    import uvicorn
    # Chạy riêng cổng 8002 để không trùng user.py (điều chỉnh nếu cần)
    uvicorn.run("song:app", host="0.0.0.0", port=8000, reload=True)
