"""S3-compatible object storage (MinIO). Resumable multipart uploads via presigned URLs, checksum
verification, versioned buckets, and an Object-Lock (WORM) bucket for audit snapshots."""
from __future__ import annotations

import hashlib
import io
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from .config import get_settings
from .observability import log
from .resilience import breaker


@lru_cache
def _client(public: bool = False):
    s = get_settings()
    return boto3.client("s3", endpoint_url=s.s3_public_endpoint if public else s.s3_endpoint,
                        aws_access_key_id=s.s3_access_key, aws_secret_access_key=s.s3_secret_key,
                        region_name=s.s3_region,
                        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                                      retries={"max_attempts": 4, "mode": "standard"},
                                      connect_timeout=3, read_timeout=20))


def client():
    return _client(False)


def ensure_buckets() -> dict:
    """Create buckets (idempotent). Images/models are versioned; the audit bucket uses Object Lock."""
    s = get_settings()
    c = client()
    out = {}
    for b, lock in ((s.bucket_images, False), (s.bucket_derived, False), (s.bucket_models, False),
                    (s.bucket_audit, True)):
        try:
            c.head_bucket(Bucket=b)
            out[b] = "exists"
        except ClientError:
            kw = {"Bucket": b}
            if lock:
                kw["ObjectLockEnabledForBucket"] = True
            c.create_bucket(**kw)
            out[b] = "created"
        try:
            c.put_bucket_versioning(Bucket=b, VersioningConfiguration={"Status": "Enabled"})
        except ClientError as e:
            log.warning("bucket_versioning_failed", bucket=b, error=str(e))
    try:
        c.put_object_lock_configuration(
            Bucket=s.bucket_audit,
            ObjectLockConfiguration={"ObjectLockEnabled": "Enabled",
                                     "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE",
                                                                   "Days": s.audit_retention_days}}})
    except ClientError as e:
        log.warning("object_lock_config_failed", error=str(e))
    return out


def put_bytes(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream",
              retain_until: datetime | None = None) -> str:
    kw = {"Bucket": bucket, "Key": key, "Body": data, "ContentType": content_type,
          "Metadata": {"sha256": hashlib.sha256(data).hexdigest()}}
    if retain_until is not None:
        kw.update(ObjectLockMode="GOVERNANCE", ObjectLockRetainUntilDate=retain_until)
    breaker("s3", 5, 15).call(client().put_object, **kw)
    return key


def get_bytes(bucket: str, key: str) -> bytes:
    obj = breaker("s3", 5, 15).call(client().get_object, Bucket=bucket, Key=key)
    return obj["Body"].read()


def exists(bucket: str, key: str) -> bool:
    try:
        client().head_object(Bucket=bucket, Key=key)
        return True
    except ClientError:
        return False


def sha256_of(bucket: str, key: str) -> tuple[str, int]:
    h = hashlib.sha256()
    obj = client().get_object(Bucket=bucket, Key=key)
    n = 0
    for chunk in iter(lambda: obj["Body"].read(1 << 20), b""):
        h.update(chunk)
        n += len(chunk)
    return h.hexdigest(), n


# ── presigned URLs (handed to phones / dashboards; signed for the PUBLIC endpoint) ──
def presign_get(bucket: str, key: str, ttl: int = 900) -> str:
    return _client(True).generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=ttl)


def presign_put(bucket: str, key: str, content_type: str, ttl: int = 900) -> str:
    return _client(True).generate_presigned_url("put_object", Params={"Bucket": bucket, "Key": key,
                                                                      "ContentType": content_type}, ExpiresIn=ttl)


def start_multipart(bucket: str, key: str, content_type: str, parts: int, ttl: int = 3600) -> dict:
    """Resumable upload: the phone uploads parts independently and can retry any part."""
    up = client().create_multipart_upload(Bucket=bucket, Key=key, ContentType=content_type)
    pub = _client(True)
    urls = [pub.generate_presigned_url("upload_part", Params={"Bucket": bucket, "Key": key,
                                                              "UploadId": up["UploadId"], "PartNumber": i},
                                       ExpiresIn=ttl) for i in range(1, parts + 1)]
    return {"upload_id": up["UploadId"], "part_urls": urls}


def complete_multipart(bucket: str, key: str, upload_id: str, parts: list[dict]) -> None:
    client().complete_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id,
                                       MultipartUpload={"Parts": [{"ETag": p["etag"], "PartNumber": p["part_number"]}
                                                                  for p in parts]})


def retain_until(days: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def png_bytes(arr) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG", optimize=True)
    return buf.getvalue()
