# Launch item: durable file storage (CEO touch-up batch 3, D2)

## Where uploaded files live today

| What | Folder (env var) | Served |
|---|---|---|
| Player profile photos (private, 512 px WebP) | `uploads/players` (`PLAYER_UPLOAD_DIR`) | `GET /players/:userId/photo` (hidden photos 404) |
| Team crests (≤512 px WebP) | `uploads/teams` (`TEAM_UPLOAD_DIR`) | `/uploads/teams/<file>` |
| Venue photos (1600 px WebP + 400 px thumbnail) | `uploads/venues` (`VENUE_UPLOAD_DIR`) | `/uploads/venues/<file>` |

All three are on the API server's own disk, behind one interface: `apps/api/src/storage/file-storage.ts`.
Every image is decoded and re-encoded on upload, so camera metadata such as GPS location is never kept.

## Why this must change before launch

On Render and most similar hosts, a web service's disk is **wiped on every deploy or restart**. Every profile
photo, crest and venue photo would disappear. A paid persistent disk keeps the files, but it ties the API to
one server: no zero-downtime deploys, no second instance, and you still need your own backups.

## Recommendation: Cloudflare R2

- 10 GB stored free, then about US$0.015 per GB per month; **no download (egress) fees**, which matters
  because photos are viewed far more often than uploaded.
- S3-compatible: add an `R2FileStorage` implementing `FileStorage` (put, delete, public URL) with the AWS S3
  SDK pointed at the R2 endpoint, and select it with an env var. Player photos stay private (a private bucket,
  streamed by the API or via short-lived signed URLs); crests and venue photos can use a public bucket or a
  custom domain.
- Launch steps: create two buckets (private players, public media), an API token limited to them, set the env
  vars in the host, deploy, then copy any existing files across once.

Nothing paid has been set up. AWS S3 works the same way but charges for every download.
