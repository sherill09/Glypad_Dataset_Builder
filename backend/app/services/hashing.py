"""
The content-hashing function that drives dedup (IMPLEMENTATION_PLAN.md §2.3,
§4, §5 step 1): "is this the same drawing I've seen before" is answered by
this hash, not by filename or storage location.
"""

import hashlib


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
