import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { ticketToken } from '../shared/tickets.js';
let f,
  owner,
  other,
  id,
  publicToken,
  tickets = [];
const now = Date.parse('2026-01-01T00:00:00.000Z');
const input = {
  title: 'Encuentro',
  description: 'Descripción del encuentro',
  venue: 'Local',
  startsAt: '2026-01-02T12:00:00.000Z',
  endsAt: '2026-01-02T15:00:00.000Z',
  timezone: 'UTC',
  capacity: 2,
  color: 'coral',
};
before(async () => {
  f = await fixture({ clock: () => now });
  owner = await f.register('Owner');
  other = await f.register('Other');
});
after(async () => f.close());
test('crea un borrador privado y publica su enlace', async () => {
  const result = await f.request('/workspace/events', {
    cookie: owner.cookie,
    method: 'POST',
    body: input,
  });
  assert.equal(result.status, 201);
  id = result.data.id;
  assert.equal((await f.request('/workspace/events/' + id, { cookie: other.cookie })).status, 404);
  const published = await f.request('/workspace/events/' + id + '/publish', {
    cookie: owner.cookie,
    method: 'POST',
    body: {},
  });
  publicToken = new URL(published.data.url).pathname.split('/')[2];
  assert.equal((await f.request('/event/' + publicToken)).data.remaining, 2);
});
test('solicitudes concurrentes no exceden el aforo', async () => {
  const results = await Promise.all(
    [1, 2, 3].map((i) =>
      f.request('/event/' + publicToken + '/register', {
        method: 'POST',
        body: { name: 'Asistente ' + i, email: 'person' + i + '@tests.invalid' },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, 409]);
  tickets = results
    .filter((r) => r.status === 201)
    .map((r) => new URL(r.data.url).pathname.split('/')[2]);
  assert.equal((await f.request('/event/' + publicToken)).data.remaining, 0);
  assert.equal(
    (
      await f.request('/workspace/events/' + id, {
        cookie: owner.cookie,
        method: 'PUT',
        body: { ...input, capacity: 1 },
      })
    ).status,
    409,
  );
});
test('cancelar libera cupo y una entrada cancelada no ingresa', async () => {
  assert.equal(
    (await f.request('/ticket/' + tickets[0] + '/cancel', { method: 'POST', body: {} })).status,
    200,
  );
  assert.equal((await f.request('/event/' + publicToken)).data.remaining, 1);
  assert.equal(
    (
      await f.request('/workspace/events/' + id + '/check-in', {
        cookie: owner.cookie,
        method: 'POST',
        body: { token: tickets[0] },
      })
    ).status,
    409,
  );
});
test('el control de entrada exige cuenta y rechaza reutilización', async () => {
  const path = '/workspace/events/' + id + '/check-in';
  assert.equal(
    (await f.request(path, { cookie: other.cookie, method: 'POST', body: { token: tickets[1] } }))
      .status,
    404,
  );
  assert.equal(
    (
      await f.request(path, {
        cookie: owner.cookie,
        method: 'POST',
        body: { token: 'https://example.com/ticket/' + tickets[1] },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request(path, { cookie: owner.cookie, method: 'POST', body: { token: tickets[1] } }))
      .status,
    409,
  );
  assert.equal(
    (await f.request('/ticket/' + tickets[1] + '/cancel', { method: 'POST', body: {} })).status,
    409,
  );
});
test('cerrar el evento bloquea nuevas inscripciones y la recepción', async () => {
  await f.request('/workspace/events/' + id + '/close', {
    cookie: owner.cookie,
    method: 'POST',
    body: {},
  });
  assert.equal((await f.request('/event/' + publicToken)).data.canRegister, false);
  assert.equal(
    (
      await f.request('/event/' + publicToken + '/register', {
        method: 'POST',
        body: { name: 'Nuevo asistente', email: 'new@tests.invalid' },
      })
    ).status,
    409,
  );
  assert.equal((await f.request('/ticket/' + tickets[1])).status, 200);
});
test('normaliza el enlace del QR sin hacer solicitudes externas', () => {
  assert.equal(ticketToken('https://example.com/ticket/abc'), 'abc');
  assert.equal(ticketToken(' abc '), 'abc');
});
