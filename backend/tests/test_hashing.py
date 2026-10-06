"""
Tests for the content-hash function that drives dedup (§2.3, §5 step 1).

Run with: pytest   (from inside backend/, with the virtual environment active)
"""

import hashlib

from app.services.hashing import sha256_hex


def test_sha256_hex_matches_stdlib():
    data = b"some drawing bytes"
    assert sha256_hex(data) == hashlib.sha256(data).hexdigest()


def test_sha256_hex_is_deterministic():
    data = b"identical content"
    assert sha256_hex(data) == sha256_hex(data)


def test_sha256_hex_differs_for_different_content():
    assert sha256_hex(b"content A") != sha256_hex(b"content B")


def test_sha256_hex_is_64_hex_chars():
    digest = sha256_hex(b"anything")
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)


def test_sha256_hex_handles_empty_bytes():
    # Not a real upload path (empty uploads are rejected before hashing),
    # but the function itself shouldn't choke on it.
    assert sha256_hex(b"") == hashlib.sha256(b"").hexdigest()
