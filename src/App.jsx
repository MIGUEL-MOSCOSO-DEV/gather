import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Ticket,
  ScanLine,
  Download,
  Camera,
  Check,
  Pencil,
} from 'lucide-react';
import QRCode from 'qrcode';
import { api } from './api.js';
import {
  Session,
  Brand,
  Identity,
  Button,
  Field,
  Modal,
  Notice,
  Empty,
  useTask,
  useData,
  dateLabel,
  LinkModal,
} from './ui.jsx';
const when = (event) =>
  new Intl.DateTimeFormat('es', {
    timeZone: event.timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(event.startsAt));
export default function App() {
  const path = window.location.pathname.split('/');
  if (path[1] === 'event') return <EventPage token={path[2]} />;
  if (path[1] === 'ticket') return <TicketPage token={path[2]} />;
  return <Session>{(user, onUser) => <Organizer user={user} onUser={onUser} />}</Session>;
}
function Organizer({ user, onUser }) {
  const { data, error, reload } = useData('/workspace/state');
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(null);
  return (
    <div className="gather-organizer">
      <header>
        <Brand />
        <span>INDEPENDENT EVENTS / ORGANIZER</span>
        <Identity user={user} onUser={onUser} />
      </header>
      {selected ? (
        <EventDesk id={selected} onBack={() => setSelected('')} reloadList={reload} />
      ) : (
        <main>
          <div className="events-heading">
            <div>
              <span className="eyebrow">QUE NO SE QUEDE EN UNA IDEA.</span>
              <h1>
                Hagamos
                <br />
                <em>que pase.</em>
              </h1>
            </div>
            <div>
              <p>
                Encuentros reales.
                <br />
                Entradas en orden.
              </p>
              <Button onClick={() => setEditing({})}>
                <Plus size={17} /> Crear un evento
              </Button>
            </div>
          </div>
          <Notice error={error} />
          <div className="event-index-heading">
            <span>TUS ENCUENTROS</span>
            <span>{String(data?.events.length || 0).padStart(2, '0')} EVENTOS</span>
          </div>
          <div className="event-posters">
            {data?.events.map((event, index) => (
              <button
                className={'event-poster ' + event.color}
                key={event.id}
                onClick={() => setSelected(event.id)}
              >
                <header>
                  <span>G / {String(index + 1).padStart(2, '0')}</span>
                  <span>
                    {event.status === 'draft'
                      ? 'BORRADOR'
                      : event.status === 'published'
                        ? 'PUBLICADO'
                        : 'CERRADO'}
                  </span>
                </header>
                <h2>{event.title}</h2>
                <div className="poster-date">
                  {new Date(event.startsAt).toLocaleDateString('es', {
                    timeZone: event.timezone,
                    day: '2-digit',
                    month: 'short',
                  })}
                  <ArrowUpRight size={35} />
                </div>
                <footer>
                  <span>{event.venue}</span>
                  <span>
                    {event.registered}/{event.capacity} INSCRITOS · {event.checked} INGRESOS
                  </span>
                </footer>
              </button>
            ))}
          </div>
          {data && !data.events.length && (
            <section className="event-empty">
              <Ticket size={55} strokeWidth={1} />
              <div>
                <h2>El primer encuentro todavía está por escribirse.</h2>
                <p>Crea un evento, abre inscripciones y recibe a tu gente con una entrada QR.</p>
              </div>
              <button onClick={() => setEditing({})} aria-label="Crear primer evento">
                <ArrowUpRight size={45} />
              </button>
            </section>
          )}
          <footer className="gather-manifesto">
            UNA BUENA IDEA NECESITA GENTE.
            <br />
            EL RESTO, LO ORGANIZAMOS.
          </footer>
        </main>
      )}
      {editing && (
        <EventForm
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={async (result) => {
            setEditing(null);
            await reload();
            if (result.id) setSelected(result.id);
          }}
        />
      )}
    </div>
  );
}
function EventForm({ event, onClose, onSaved }) {
  const task = useTask();
  const local = (value) =>
    value
      ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : '';
  function submit(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    task.perform(async () => {
      const result = await api('/workspace/events' + (event.id ? '/' + event.id : ''), {
        method: event.id ? 'PUT' : 'POST',
        body: {
          ...f,
          startsAt: new Date(f.startsAt).toISOString(),
          endsAt: new Date(f.endsAt).toISOString(),
          capacity: Number(f.capacity),
        },
      });
      await onSaved(result);
    });
  }
  return (
    <Modal
      title={event.id ? 'Ajustar el encuentro' : 'Un encuentro empieza aquí'}
      wide
      onClose={onClose}
    >
      <form className="stack" onSubmit={submit}>
        <Notice error={task.error} />
        <Field
          label="Nombre del evento"
          name="title"
          defaultValue={event.title || ''}
          maxLength={160}
          required
        />
        <Field label="Qué va a pasar">
          <textarea
            name="description"
            defaultValue={event.description || ''}
            maxLength={5000}
            required
            rows={4}
          />
        </Field>
        <Field
          label="Lugar"
          name="venue"
          defaultValue={event.venue || ''}
          maxLength={300}
          required
        />
        <div className="grid">
          <Field
            label="Inicio (hora local de tu navegador)"
            type="datetime-local"
            name="startsAt"
            defaultValue={local(event.startsAt)}
            required
          />
          <Field
            label="Final (hora local de tu navegador)"
            type="datetime-local"
            name="endsAt"
            defaultValue={local(event.endsAt)}
            required
          />
          <Field
            label="Zona horaria para mostrar"
            name="timezone"
            defaultValue={event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
            required
          />
          <Field
            label="Aforo"
            name="capacity"
            type="number"
            min="1"
            max="5000"
            defaultValue={event.capacity || ''}
            required
          />
        </div>
        <Field label="Identidad del cartel">
          <select name="color" defaultValue={event.color || 'coral'}>
            <option value="coral">Tinta coral</option>
            <option value="yellow">Papel amarillo</option>
            <option value="violet">Violeta eléctrico</option>
          </select>
        </Field>
        <Button busy={task.busy}>Guardar evento</Button>
      </form>
    </Modal>
  );
}
function EventDesk({ id, onBack, reloadList }) {
  const { data, error, reload } = useData('/workspace/events/' + id);
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState('');
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState('');
  const [token, setToken] = useState('');
  const task = useTask();
  async function refresh() {
    await Promise.all([reload(), reloadList()]);
  }
  function scan(value) {
    setToken(value);
    task.perform(async () => {
      const response = await api('/workspace/events/' + id + '/check-in', {
        method: 'POST',
        body: { token: value },
      });
      setResult(response.registration);
      setToken('');
      await refresh();
    });
  }
  if (!data)
    return (
      <main>
        <Notice error={error} />
        <p>Abriendo recepción…</p>
      </main>
    );
  const { event, registrations } = data;
  return (
    <main className="event-desk">
      <button className="gather-back" onClick={onBack}>
        <ArrowLeft size={15} /> TODOS LOS EVENTOS
      </button>
      <div className="event-desk-heading">
        <h1>{event.title}</h1>
        <div className="row wrap">
          <Button secondary onClick={() => setEditing(true)}>
            <Pencil size={14} /> Editar
          </Button>
          <Button
            busy={task.busy}
            onClick={() =>
              task.perform(async () => {
                const r = await api('/workspace/events/' + id + '/publish', {
                  method: 'POST',
                  body: {},
                });
                setLink(r.url);
                await refresh();
              })
            }
          >
            {event.status === 'draft' ? 'Publicar y abrir inscripciones' : 'Generar nuevo enlace'}
          </Button>
          {event.status === 'published' && (
            <Button
              secondary
              onClick={() =>
                task.perform(async () => {
                  await api('/workspace/events/' + id + '/close', { method: 'POST', body: {} });
                  await refresh();
                })
              }
            >
              Cerrar recepción e inscripciones
            </Button>
          )}
        </div>
      </div>
      <p className="event-facts">
        {when(event)} / {event.venue} / {event.timezone}
      </p>
      <Notice error={error || task.error} />
      <div className="reception-layout">
        <section className="checkin-station">
          <span className="eyebrow">PUERTA DE ENTRADA</span>
          <h2>
            Bienvenidos.
            <br />
            De uno en uno.
          </h2>
          <p>
            {registrations.filter((r) => r.checkedAt).length} ingresaron /{' '}
            {registrations.filter((r) => r.status === 'active').length} inscritos / {event.capacity}{' '}
            cupos
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              scan(token);
            }}
          >
            <Field
              label="Enlace o código de la entrada"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <Button busy={task.busy} disabled={event.status !== 'published'}>
              <ScanLine size={17} /> Validar ingreso
            </Button>
          </form>
          <Scanner onToken={scan} />
          {result && (
            <div className="admission">
              <Check size={26} />
              <div>
                <strong>INGRESO CONFIRMADO</strong>
                <h3>{result.name}</h3>
                <span>{dateLabel(result.checkedAt)}</span>
              </div>
            </div>
          )}
        </section>
        <section className="attendee-sheet">
          <header>
            <h2>La lista.</h2>
            <a href={'/api/workspace/events/' + id + '/export'} download>
              <Download size={15} /> CSV
            </a>
          </header>
          <input
            aria-label="Buscar asistentes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre o correo"
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Asistente</th>
                  <th>Entrada</th>
                  <th>Ingreso</th>
                </tr>
              </thead>
              <tbody>
                {registrations
                  .filter((r) =>
                    [r.name, r.email].join(' ').toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name}
                        <small>{r.email}</small>
                      </td>
                      <td>{r.status === 'active' ? 'Activa' : 'Cancelada'}</td>
                      <td>{r.checkedAt ? dateLabel(r.checkedAt) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!registrations.length && (
            <Empty title="Todavía no hay nombres en la lista.">
              Publica el enlace y abre las inscripciones.
            </Empty>
          )}
        </section>
      </div>
      {editing && (
        <EventForm
          event={event}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      )}
      {link && (
        <LinkModal title="Tu evento, listo para compartir" url={link} onClose={() => setLink('')} />
      )}
    </main>
  );
}
function Scanner({ onToken }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const video = useRef(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false,
      stream,
      timer,
      reading = false;
    async function start() {
      try {
        if (!window.BarcodeDetector)
          throw new Error(
            'Este navegador no tiene lector QR. Pega el enlace o código de la entrada.',
          );
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          if (reading || cancelled) return;
          reading = true;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]) {
              setActive(false);
              onToken(codes[0].rawValue);
            }
          } catch {
          } finally {
            reading = false;
          }
        }, 400);
      } catch (e) {
        setError(e.message);
        setActive(false);
      }
    }
    start();
    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);
  return (
    <div className="scanner">
      <Notice error={error} />
      {active ? (
        <>
          <video ref={video} muted playsInline />
          <Button secondary onClick={() => setActive(false)}>
            Cerrar cámara
          </Button>
        </>
      ) : (
        <Button
          secondary
          type="button"
          onClick={() => {
            setError('');
            setActive(true);
          }}
        >
          <Camera size={16} /> Leer QR con cámara
        </Button>
      )}
    </div>
  );
}
function EventPage({ token }) {
  const { data, error } = useData('/event/' + token);
  const task = useTask();
  function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    task.perform(async () => {
      const result = await api('/event/' + token + '/register', { method: 'POST', body });
      window.location.assign(result.url);
    });
  }
  return (
    <main className={'public-event ' + (data?.event.color || 'coral')}>
      <header>
        <Brand />
        <span>ESTAR AHÍ CAMBIA LAS COSAS.</span>
      </header>
      <Notice error={error} />
      {data && (
        <>
          <div className="public-event-main">
            <section>
              <span className="event-edition">GATHER / ENCUENTRO INDEPENDIENTE</span>
              <h1>{data.event.title}</h1>
              <div className="event-place">
                <span>{when(data.event)}</span>
                <strong>{data.event.venue}</strong>
                <small>{data.event.timezone}</small>
              </div>
              <p className="event-description">{data.event.description}</p>
            </section>
            <aside>
              <span className="registration-index">TU LUGAR / 01</span>
              <h2>
                Nos vemos
                <br />
                ahí.
              </h2>
              <p>
                {data.remaining} cupos disponibles de {data.event.capacity}
              </p>
              {data.canRegister ? (
                <form className="stack" onSubmit={submit}>
                  <Notice error={task.error} />
                  <Field label="Tu nombre" name="name" required minLength={2} maxLength={120} />
                  <Field label="Correo electrónico" name="email" type="email" required />
                  <Button busy={task.busy}>
                    Reservar mi lugar <ArrowUpRight size={17} />
                  </Button>
                  <p className="ticket-warning">
                    Guarda tu entrada al finalizar. No se envía por correo.
                  </p>
                </form>
              ) : (
                <p className="registration-closed">LAS INSCRIPCIONES ESTÁN CERRADAS.</p>
              )}
            </aside>
          </div>
          <footer>
            NO ES UN PLAN MÁS.
            <br />
            ES GENTE EN EL MISMO LUGAR.
          </footer>
        </>
      )}
    </main>
  );
}
function TicketPage({ token }) {
  const { data, error, reload } = useData('/ticket/' + token);
  const [qr, setQr] = useState('');
  const task = useTask();
  useEffect(() => {
    QRCode.toDataURL(window.location.origin + '/ticket/' + token, { width: 500, margin: 2 })
      .then(setQr)
      .catch(() => {});
  }, [token]);
  return (
    <main className="ticket-page">
      <div className="no-print">
        <Brand />
        <Notice error={error || task.error} />
      </div>
      {data && (
        <>
          <article className={'entry-ticket ' + data.event.color}>
            <div className="ticket-paper">
              <span>GATHER / ADMIT ONE</span>
              <h1>{data.event.title}</h1>
              <p>{when(data.event)}</p>
              <strong>{data.event.venue}</strong>
              <div className="ticket-name">
                <small>ESTA ENTRADA ES PARA</small>
                <h2>{data.registration.name}</h2>
              </div>
              <span className="ticket-status">
                {data.registration.status === 'cancelled'
                  ? 'CANCELADA'
                  : data.registration.checkedAt
                    ? 'INGRESO REGISTRADO'
                    : 'ENTRADA ACTIVA'}
              </span>
            </div>
            <div className="ticket-stub">
              {qr && <img src={qr} alt="Código QR privado de esta entrada" />}
              <span>UNA ENTRADA. UN INGRESO.</span>
            </div>
          </article>
          <div className="ticket-controls no-print">
            <Button onClick={() => window.print()}>
              <Download size={15} /> Imprimir o guardar PDF
            </Button>
            {data.registration.status === 'active' && !data.registration.checkedAt && (
              <Button
                secondary
                busy={task.busy}
                onClick={() =>
                  task.perform(async () => {
                    await api('/ticket/' + token + '/cancel', { method: 'POST', body: {} });
                    await reload();
                  })
                }
              >
                Cancelar mi inscripción
              </Button>
            )}
            <p>
              Conserva este enlace. El QR es privado: cualquier persona que lo tenga podría usar tu
              entrada.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
