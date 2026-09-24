import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
import { TEAM_IMAGE_MAX_BYTES } from './team-image.storage.js';
import { teamImageUpload } from './teams.routes.js';

const uploadApp = express();
uploadApp.post('/upload', teamImageUpload.single('image'), (_req, res) => res.sendStatus(204));
uploadApp.use(errorHandler);

describe('team image upload boundaries', () => {
  it('accepts one bounded image file', async () => {
    const response = await request(uploadApp)
      .post('/upload')
      .attach('image', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        filename: 'team.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(204);
  });

  it('rejects a file that exceeds the byte limit with the stable upload error', async () => {
    const response = await request(uploadApp)
      .post('/upload')
      .attach('image', Buffer.alloc(TEAM_IMAGE_MAX_BYTES + 1), {
        filename: 'oversized.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'TEAM_IMAGE_INVALID' });
  });

  it.each(['metadata', 'items[4294967294]', 'items[0][nested]'])(
    'rejects adversarial or unexpected multipart field %s before building a request body',
    async (fieldName) => {
      const response = await request(uploadApp).post('/upload').field(fieldName, 'x');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'TEAM_IMAGE_INVALID' });
    },
  );

  it('rejects an unexpected file field without invoking the route handler', async () => {
    const response = await request(uploadApp)
      .post('/upload')
      .attach('image[4294967294]', Buffer.from('not an image'), {
        filename: 'hostile.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'TEAM_IMAGE_INVALID' });
  });

  it('returns a bounded client error for a truncated multipart body', async () => {
    const response = await request(uploadApp)
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=footy-finder-boundary')
      .send(
        '--footy-finder-boundary\r\n' +
          'Content-Disposition: form-data; name="image"; filename="team.png"\r\n' +
          'Content-Type: image/png\r\n\r\n' +
          'truncated',
      );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'TEAM_IMAGE_INVALID' });
  });
});
