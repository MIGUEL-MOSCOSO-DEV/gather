import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { createBase, finishApi, problem, text } from './core.js';
import { createToken, hashToken } from './auth.js';
import { transaction } from './db.js';
import { ticketToken, csvCell } from '../shared/tickets.js';
const eventSchema = z
  .object({
    title: text(160).min(1),
    description: text(5000).min(1),
    venue: text(300).min(1),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: text(80).refine((value) => {
      try {
        new Intl.DateTimeFormat('es', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
    capacity: z.number().int().min(1).max(5000),
    color: z.enum(['coral', 'yellow', 'violet']),
  })
  .refine(
    (value) => new Date(value.endsAt) > new Date(value.startsAt),
    'El final debe ser posterior al inicio.',
  );
const read = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  venue: row.venue,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  timezone: row.timezone,
  capacity: row.capacity,
  status: row.status,
  color: row.color,
});
const registration = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  status: row.status,
  checkedAt: row.checked_at,
  createdAt: row.created_at,
});
export function createApp(db, options = { appUrl: 'http://localhost:3900' }) {
  const { app, workspace, origin } = createBase(db, options);
  const clock = options.clock || Date.now;
  function own(id, userId) {
    const row = db.prepare('SELECT * FROM events WHERE id=? AND user_id=?').get(id, userId);
    if (!row) throw problem(404, 'No se encontró el evento.');
    return row;
  }
  function publicEvent(token) {
    const row = db
      .prepare("SELECT * FROM events WHERE token_hash=? AND status!='draft'")
      .get(hashToken(token));
    if (!row) throw problem(404, 'El evento no está disponible.');
    return row;
  }
  function count(id) {
    return db
      .prepare("SELECT count(*) AS n FROM registrations WHERE event_id=? AND status='active'")
      .get(id).n;
  }
  function ticket(token) {
    const row = db.prepare('SELECT * FROM registrations WHERE token_hash=?').get(hashToken(token));
    if (!row) throw problem(404, 'La entrada no está disponible.');
    return row;
  }
  function checkin(event, token) {
    if (event.status !== 'published')
      throw problem(409, 'El evento no está abierto para recepción.');
    const parsed = ticketToken(token);
    if (!/^[A-Za-z0-9_-]{43}$/.test(parsed))
      throw problem(400, 'El código de entrada no es válido.');
    return transaction(db, () => {
      const row = db
        .prepare('SELECT * FROM registrations WHERE token_hash=? AND event_id=?')
        .get(hashToken(parsed), event.id);
      if (!row) throw problem(404, 'La entrada no pertenece a este evento.');
      if (row.status !== 'active') throw problem(409, 'La entrada está cancelada.');
      if (row.checked_at) throw problem(409, 'Esta entrada ya ingresó.');
      db.prepare(
        'UPDATE registrations SET checked_at=?,checked_by=? WHERE id=? AND checked_at IS NULL',
      ).run(new Date(clock()).toISOString(), event.user_id, row.id);
      return registration(db.prepare('SELECT * FROM registrations WHERE id=?').get(row.id));
    });
  }
  workspace.get('/state', (req, res) =>
    res.json({
      events: db
        .prepare('SELECT * FROM events WHERE user_id=? ORDER BY starts_at DESC')
        .all(req.user.id)
        .map((row) => ({
          ...read(row),
          registered: count(row.id),
          checked: db
            .prepare(
              'SELECT count(*) AS n FROM registrations WHERE event_id=? AND checked_at IS NOT NULL',
            )
            .get(row.id).n,
        })),
    }),
  );
  workspace.post('/events', (req, res) => {
    const input = eventSchema.parse(req.body);
    const id = randomUUID();
    db.prepare(
      'INSERT INTO events(id,user_id,title,description,venue,starts_at,ends_at,timezone,capacity,color,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      req.user.id,
      input.title,
      input.description,
      input.venue,
      input.startsAt,
      input.endsAt,
      input.timezone,
      input.capacity,
      input.color,
      new Date(clock()).toISOString(),
    );
    res.status(201).json({ id });
  });
  workspace.put('/events/:id', (req, res) => {
    own(req.params.id, req.user.id);
    const input = eventSchema.parse(req.body);
    transaction(db, () => {
      if (count(req.params.id) > input.capacity)
        throw problem(409, 'No puedes reducir el aforo por debajo de las inscripciones activas.');
      db.prepare(
        'UPDATE events SET title=?,description=?,venue=?,starts_at=?,ends_at=?,timezone=?,capacity=?,color=? WHERE id=?',
      ).run(
        input.title,
        input.description,
        input.venue,
        input.startsAt,
        input.endsAt,
        input.timezone,
        input.capacity,
        input.color,
        req.params.id,
      );
    });
    res.json({ ok: true });
  });
  workspace.post('/events/:id/publish', (req, res) => {
    const event = own(req.params.id, req.user.id);
    if (new Date(event.starts_at).getTime() <= clock())
      throw problem(409, 'La fecha de inicio debe estar en el futuro para publicar.');
    const token = createToken();
    db.prepare("UPDATE events SET status='published',token_hash=? WHERE id=?").run(
      hashToken(token),
      event.id,
    );
    res.json({ url: origin + '/event/' + token });
  });
  workspace.post('/events/:id/close', (req, res) => {
    own(req.params.id, req.user.id);
    db.prepare("UPDATE events SET status='closed' WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  workspace.get('/events/:id', (req, res) => {
    const event = own(req.params.id, req.user.id);
    res.json({
      event: read(event),
      registrations: db
        .prepare('SELECT * FROM registrations WHERE event_id=? ORDER BY created_at DESC')
        .all(event.id)
        .map(registration),
    });
  });
  workspace.post('/events/:id/check-in', (req, res) => {
    const input = z.object({ token: text(2000).min(1) }).parse(req.body);
    res.json({ registration: checkin(own(req.params.id, req.user.id), input.token) });
  });
  workspace.get('/events/:id/export', (req, res) => {
    own(req.params.id, req.user.id);
    const rows = [
      ['Nombre', 'Correo', 'Estado', 'Ingreso'],
      ...db
        .prepare('SELECT * FROM registrations WHERE event_id=?')
        .all(req.params.id)
        .map((row) => [row.name, row.email, row.status, row.checked_at || '']),
    ];
    res
      .attachment('gather-attendees.csv')
      .type('text/csv')
      .send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
  });
  app.get('/api/event/:token', (req, res) => {
    const event = publicEvent(req.params.token);
    res.json({
      event: read(event),
      remaining: event.capacity - count(event.id),
      canRegister:
        event.status === 'published' &&
        new Date(event.starts_at).getTime() > clock() &&
        count(event.id) < event.capacity,
    });
  });
  const limit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas inscripciones. Inténtalo más tarde.' },
  });
  app.post('/api/event/:token/register', limit, (req, res) => {
    const input = z
      .object({
        name: text(120).min(2),
        email: z
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
      })
      .parse(req.body);
    const token = createToken();
    const id = transaction(db, () => {
      const event = publicEvent(req.params.token);
      if (event.status !== 'published' || new Date(event.starts_at).getTime() <= clock())
        throw problem(409, 'La inscripción está cerrada.');
      if (count(event.id) >= event.capacity) throw problem(409, 'Se agotaron los cupos.');
      const previous = db
        .prepare('SELECT * FROM registrations WHERE event_id=? AND email=?')
        .get(event.id, input.email);
      if (previous?.status === 'active')
        throw problem(
          409,
          'Este correo ya tiene una entrada. Conserva el enlace de tu inscripción anterior.',
        );
      if (previous) {
        db.prepare(
          "UPDATE registrations SET name=?,token_hash=?,status='active',checked_at=NULL,checked_by=NULL,created_at=? WHERE id=?",
        ).run(input.name, hashToken(token), new Date(clock()).toISOString(), previous.id);
        return previous.id;
      }
      const id = randomUUID();
      db.prepare(
        'INSERT INTO registrations(id,event_id,name,email,token_hash,created_at) VALUES(?,?,?,?,?,?)',
      ).run(
        id,
        event.id,
        input.name,
        input.email,
        hashToken(token),
        new Date(clock()).toISOString(),
      );
      return id;
    });
    res.status(201).json({ id, url: origin + '/ticket/' + token });
  });
  app.get('/api/ticket/:token', (req, res) => {
    const row = ticket(req.params.token);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(row.event_id);
    res.json({ registration: registration(row), event: read(event) });
  });
  app.post('/api/ticket/:token/cancel', (req, res) => {
    const row = ticket(req.params.token);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(row.event_id);
    if (row.status !== 'active' || row.checked_at || new Date(event.starts_at).getTime() <= clock())
      throw problem(409, 'Ya no se puede cancelar esta entrada desde el enlace.');
    db.prepare("UPDATE registrations SET status='cancelled' WHERE id=?").run(row.id);
    res.json({ ok: true });
  });
  return finishApi(app);
}
