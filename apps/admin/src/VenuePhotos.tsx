import { VENUE_ABOUT_MAX, VENUE_LINK_TYPES, VENUE_LINKS_MAX, VENUE_PHOTOS_MAX, VENUE_PHOTOS_MIN, type ManagedVenue, type VenueLink } from '@footy-finder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminClient } from './api.js';

type Photo = { key: string; mediaId?: string; fileId?: string; url: string; thumbUrl?: string; altText: string; attribution: string };

const fromVenue = (venue: ManagedVenue): Photo[] =>
  venue.media.map((item) => ({ key: item.id, mediaId: item.id, url: item.url, thumbUrl: item.thumbUrl, altText: item.altText, attribution: item.attribution }));
const linkName: Record<VenueLink['type'], string> = { WEBSITE: 'Website', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', X: 'X', TIKTOK: 'TikTok', OTHER: 'Other' };
/** A new type relabels the link unless the admin typed their own label. */
const linkLabel = (type: VenueLink['type'], label: string) => (Object.values(linkName).includes(label) || !label ? (type === 'OTHER' ? label || 'Link' : linkName[type]) : label);
const coverOf = (venue: ManagedVenue, photos: Photo[]) => Math.max(0, photos.findIndex(({ url }) => url === venue.coverImageUrl));

/**
 * CEO touch-up batch 3, item 1: venue photos uploaded from a computer or phone gallery (JPG, PNG, WebP), with
 * order, cover and delete. On a live venue, saving creates a change that a second admin approves (D1); the
 * venue stays live with its current photos until then.
 */
export function VenuePhotos({ venue, venuesKey }: { venue: ManagedVenue; venuesKey: readonly unknown[] }) {
  const cache = useQueryClient();
  const [photos, setPhotos] = useState<Photo[]>(() => fromVenue(venue));
  const [cover, setCover] = useState(() => coverOf(venue, fromVenue(venue)));
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  // CEO touch-up batch 3, item 2: "About this venue" and up to five links, saved with the photos.
  const [aboutText, setAboutText] = useState(venue.aboutText ?? '');
  const [links, setLinks] = useState<VenueLink[]>(venue.links);
  const store = (data: ManagedVenue) => cache.setQueryData<ManagedVenue[]>(venuesKey, (current = []) => current.map((item) => (item.id === data.id ? data : item)));
  const mutation = useMutation({
    mutationFn: (action: () => Promise<{ data: ManagedVenue }>) => action(),
    onSuccess: ({ data }) => {
      store(data);
      const next = fromVenue(data);
      setPhotos(next);
      setCover(coverOf(data, next));
      setAboutText(data.aboutText ?? '');
      setLinks(data.links);
    },
  });
  const pending = venue.pendingContentChange;
  const live = venue.publicationStatus === 'PUBLISHED';

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadError('');
    for (const file of Array.from(files).slice(0, VENUE_PHOTOS_MAX - photos.length)) {
      setUploading((count) => count + 1);
      try {
        const { data } = await adminClient.uploadVenuePhoto(venue.id, file);
        setPhotos((current) => [...current, { key: data.fileId, fileId: data.fileId, url: data.url, thumbUrl: data.thumbUrl, altText: `Photo of ${venue.name}`, attribution: `Photo: ${venue.name}` }]);
      } catch (error) {
        setUploadError(`${file.name}: ${(error as Error).message}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setPhotos(next);
    setCover(cover === index ? target : cover === target ? index : cover);
  };
  const remove = (index: number) => {
    setPhotos((current) => current.filter((_, item) => item !== index));
    setCover((value) => (value === index ? 0 : value > index ? value - 1 : value));
  };
  const update = (index: number, change: Partial<Photo>) => setPhotos((current) => current.map((photo, item) => (item === index ? { ...photo, ...change } : photo)));
  const save = () =>
    mutation.mutate(() =>
      adminClient.saveVenueContent(venue.id, {
        photos: photos.map(({ mediaId, fileId, altText, attribution }) => ({ ...(mediaId ? { mediaId } : { fileId }), altText, attribution })),
        coverIndex: cover,
        aboutText,
        links,
      }),
    );

  return (
    <div className="stack">
      <h4>Photos, about and links</h4>
      <p className="muted">
        {VENUE_PHOTOS_MIN} to {VENUE_PHOTOS_MAX} photos (JPG, PNG or WebP, up to 10 MB). They are resized automatically and camera details such as location are removed.
        {live ? ' This venue is live: your changes go live once a second admin approves them.' : ''}
      </p>
      {pending && (
        <div className="pending-change" data-testid="pending-photo-change">
          <strong>Content change waiting for approval</strong>
          <span className="muted">Submitted {new Date(pending.submittedAt).toLocaleString()}. Players still see the current photos, about text and links.</span>
          <div className="photo-strip">
            {pending.payload.photos.map((photo, index) => (
              <img key={photo.url} src={photo.thumbUrl ?? photo.url} alt={photo.altText} className={index === pending.payload.coverIndex ? 'is-cover' : ''} />
            ))}
          </div>
          {pending.payload.aboutText !== undefined && <p><strong>About:</strong> {pending.payload.aboutText || '(empty)'}</p>}
          {pending.payload.links && <p><strong>Links:</strong> {pending.payload.links.length ? pending.payload.links.map((link) => `${link.label} (${link.url})`).join(', ') : '(none)'}</p>}
          <div className="row">
            <button disabled={mutation.isPending} onClick={() => mutation.mutate(() => adminClient.approveVenueContentChange(pending.id))}>Approve and publish</button>
            <input placeholder="Reason for rejecting" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
            <button className="danger" disabled={mutation.isPending || rejectReason.trim().length < 3} onClick={() => mutation.mutate(() => adminClient.rejectVenueContentChange(pending.id, rejectReason))}>Reject</button>
          </div>
        </div>
      )}
      <div className="photo-grid">
        {photos.map((photo, index) => (
          <figure key={photo.key} className={index === cover ? 'photo-tile is-cover' : 'photo-tile'}>
            <img src={photo.thumbUrl ?? photo.url} alt={photo.altText} />
            <label className="check"><input type="radio" name={`cover-${venue.id}`} checked={index === cover} onChange={() => setCover(index)} />Cover photo</label>
            <label>Alt text<input value={photo.altText} onChange={(event) => update(index, { altText: event.target.value })} /></label>
            <label>Attribution<input value={photo.attribution} onChange={(event) => update(index, { attribution: event.target.value })} /></label>
            <div className="row">
              <button className="small" aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>←</button>
              <button className="small" aria-label="Move later" disabled={index === photos.length - 1} onClick={() => move(index, 1)}>→</button>
              <button className="small danger" onClick={() => remove(index)}>Delete</button>
            </div>
          </figure>
        ))}
      </div>
      <label className="upload-button">
        {uploading ? `Uploading ${uploading}…` : 'Add photos from computer or phone'}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={photos.length >= VENUE_PHOTOS_MAX} onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} />
      </label>
      {uploadError && <p className="error">{uploadError}</p>}
      <label>About this venue (plain text, {aboutText.length}/{VENUE_ABOUT_MAX})<textarea maxLength={VENUE_ABOUT_MAX} value={aboutText} onChange={(event) => setAboutText(event.target.value)} /></label>
      <fieldset className="stack">
        <legend>Links (up to {VENUE_LINKS_MAX}, https only)</legend>
        {links.map((link, index) => (
          <div className="form-grid three" key={index}>
            <label>Type<select value={link.type} onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, type: event.target.value as VenueLink['type'], label: linkLabel(event.target.value as VenueLink['type'], item.label) } : item)))}>{VENUE_LINK_TYPES.map((type) => <option key={type} value={type}>{linkName[type]}</option>)}</select></label>
            <label>Label<input maxLength={40} value={link.label} onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))} /></label>
            <label>Web address<input type="url" placeholder="https://" value={link.url} onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)))} /></label>
            <button className="small danger" onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}>Remove link</button>
          </div>
        ))}
        <button className="small" disabled={links.length >= VENUE_LINKS_MAX} onClick={() => setLinks((current) => [...current, { type: 'WEBSITE', label: 'Website', url: 'https://' }])}>Add link</button>
      </fieldset>
      <button disabled={mutation.isPending || uploading > 0 || (live && photos.length < VENUE_PHOTOS_MIN)} onClick={save}>
        {live ? 'Submit for approval' : 'Save photos, about and links'}
      </button>
      {mutation.error && <p className="error">{mutation.error.message}</p>}
    </div>
  );
}
