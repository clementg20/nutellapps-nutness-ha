// Carte « Nutness » : prochains cours, planning de la semaine, réserver ou annuler en deux appuis.
// Chargée automatiquement par l'intégration (aucune ressource à déclarer). Données : capteur « Prochain cours »
// (attribut nutness_bookings) et actions nutness.planning / reserver / annuler / actualiser.

const DAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const OPENS_MS = 72 * 3600e3;
const ARM_MS = 3000;

// Emoji et couleur par famille d'activité (premier mot-clé trouvé).
const FAMILIES = [
  [['aquabik'], '💦', '#00838f'], [['aqua'], '🏊', '#00796b'], [['sprint'], '⚡', '#0288d1'], [['rpm', 'bike', 'cycl'], '🚴', '#1a3fa8'],
  [['cross'], '🏋️', '#ef6c00'], [['hyrox'], '🔥', '#e64a19'], [['box'], '🥊', '#c62828'], [['pole'], '🤸', '#d81b60'],
  [['grit'], '💥', '#b58900'], [['circuit'], '🔄', '#2e7d32'], [['step'], '👟', '#3949ab'],
  [['pilates', 'yoga', 'recup', 'récup', 'stretch'], '🧘', '#558b2f'], [['self'], '🥋', '#6d4c41'],
  [['danc', 'danse', 'zumba', 'jam', 'latino', 'hip hop'], '💃', '#8e24aa'],
];
const family = (name) => {
  const l = name.toLowerCase();
  const f = FAMILIES.find(([keys]) => keys.some((k) => l.includes(k)));
  return f ? { emoji: f[1], color: f[2] } : { emoji: '🏅', color: '#616161' };
};

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hh = (t) => esc(String(t ?? '').replace(':', 'h'));
const dayLabel = (s) => { const d = parseDay(s); return `${DAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ } },
};

const STATUS_LABEL = {
  booked: '✅ Réservé', waiting: '⏳ Liste d’attente', planned: '🕒 Réservation prévue', cancelled: '🗑️ Annulé',
  already_booked: 'Déjà réservé', already_waiting: 'Déjà en liste d’attente', already_planned: 'Déjà prévu',
};

class NutnessCard extends HTMLElement {
  static getConfigForm() {
    return {
      schema: [
        { name: 'entity', required: true, selector: { entity: { domain: 'sensor', integration: 'nutness' } } },
        { name: 'popup', default: true, selector: { boolean: {} } },
      ],
      computeLabel: (s) => ({ entity: 'Capteur « Prochain cours »', popup: 'Planning dans une fenêtre' }[s.name]),
    };
  }

  static getStubConfig(hass) {
    const entity = Object.values(hass.entities ?? {}).find((e) => e.platform === 'nutness' && e.entity_id.startsWith('sensor.'));
    return { entity: entity?.entity_id ?? '' };
  }

  setConfig(config) {
    if (!config?.entity) throw new Error('Choisir le capteur « Prochain cours » de Nutness (entity)');
    this._config = config;
    this._key = `nutness-card:${config.entity}`;
    this._listOpen = store.get(`${this._key}:list`, true);
    this._masked = new Set(store.get(`${this._key}:masked`, []));
    this._planning = false;
    this._week = 0;
    this._classes = null;
    this._render();
  }

  set hass(hass) {
    const prev = this._hass?.states[this._config?.entity];
    this._hass = hass;
    if (!this._config) return;
    if (hass.states[this._config.entity] !== prev) this._render();
  }

  getCardSize() { return this._planning && !this._popup ? 10 : 3; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  get _popup() { return this._config?.popup !== false; }

  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card id="card"></ha-card><dialog id="dialog"><div id="dialog-body"></div></dialog>`;
    this._card = this.shadowRoot.getElementById('card');
    this._dialog = this.shadowRoot.getElementById('dialog');
    this._dialogBody = this.shadowRoot.getElementById('dialog-body');
    this.shadowRoot.addEventListener('click', (e) => this._onClick(e));
    // Fermeture : bouton ✕, touche Échap ou appui à côté de la fenêtre.
    this._dialog.addEventListener('click', (e) => { if (e.target === this._dialog) this._dialog.close(); });
    this._dialog.addEventListener('close', () => { if (this._planning) { this._planning = false; this._armed = null; this._render(); } });
    this._render();
  }

  disconnectedCallback() { if (this._dialog?.open) this._dialog.close(); }

  // ───── Données ─────

  get _state() { return this._hass?.states[this._config.entity]; }
  get _bookings() { return this._state?.attributes?.nutness_bookings ?? []; }
  get _club() { return this._state?.attributes?.club ?? ''; }
  _short(name) {
    const club = this._club;
    return club ? name.replace(new RegExp(`\\s+${club.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim() : name;
  }

  async _service(service, data = {}) {
    const entry = this._config.config_entry_id ? { config_entry_id: this._config.config_entry_id } : {};
    const r = await this._hass.callWS({ type: 'call_service', domain: 'nutness', service, service_data: { ...data, ...entry }, return_response: true });
    return r?.response;
  }

  _weekStart() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (this._week === 0) return today;
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + 7 * this._week);
    return monday;
  }

  async _loadPlanning() {
    const start = this._weekStart();
    this._loading = true;
    this._classes = null;
    this._render();
    try {
      const r = await this._service('planning', { date: isoDay(start), week: true });
      const monday = new Date(start); monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      this._classes = (r?.classes ?? []).filter((c) => c.date <= isoDay(sunday));
    } catch (err) {
      this._flash(`❌ ${err.message || 'Planning indisponible'}`);
      this._classes = [];
    }
    this._loading = false;
    this._render();
  }

  async _refresh() {
    this._loading = true;
    this._render();
    try {
      await this._service('actualiser');
      if (this._planning) await this._loadPlanning();
    } catch (err) {
      this._flash(`❌ ${err.message || 'Nutness injoignable'}`);
    }
    this._loading = false;
    this._render();
  }

  async _act(op, item) {
    this._armed = null;
    this._busy = `${item.date} ${item.time} ${item.activity}`;
    this._render();
    const name = this._short(item.activity);
    try {
      const r = await this._service(op === 'book' ? 'reserver' : 'annuler', { date: item.date, time: item.time, activity: item.activity });
      this._flash(`${STATUS_LABEL[r?.status] ?? r?.status ?? 'OK'} · ${name} ${hh(item.time)}`);
      if (this._planning) await this._loadPlanning();
    } catch (err) {
      this._flash(`❌ ${err.message || 'Refusé'}`);
    }
    this._busy = null;
    this._render();
  }

  _flash(text) {
    this._msg = text;
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => { this._msg = null; this._render(); }, 5000);
  }

  // ───── Gestes ─────

  _onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action } = el.dataset;
    if (action === 'toggle-list') { this._listOpen = !this._listOpen; store.set(`${this._key}:list`, this._listOpen); this._render(); }
    else if (action === 'refresh') this._refresh();
    else if (action === 'planning') { this._planning = !this._planning; this._week = 0; if (this._planning) this._loadPlanning(); else this._render(); }
    else if (action === 'close-planning') this._dialog.close();
    else if (action === 'week') { this._week = Math.max(0, Math.min(8, this._week + Number(el.dataset.delta))); this._loadPlanning(); }
    else if (action === 'filter') { this._filterOpen = !this._filterOpen; this._render(); }
    else if (action === 'mask') {
      const a = el.dataset.activity;
      if (this._masked.has(a)) this._masked.delete(a); else this._masked.add(a);
      store.set(`${this._key}:masked`, [...this._masked]);
      this._render();
    } else if (action === 'book' || action === 'cancel') {
      // Deux appuis : le premier arme le bouton, le second confirme.
      const item = { date: el.dataset.date, time: el.dataset.time, activity: el.dataset.activity };
      const key = `${action} ${item.date} ${item.time} ${item.activity}`;
      if (this._armed === key) { clearTimeout(this._armTimer); this._act(action, item); return; }
      this._armed = key;
      clearTimeout(this._armTimer);
      this._armTimer = setTimeout(() => { this._armed = null; this._render(); }, ARM_MS);
      this._render();
    }
  }

  // ───── Rendu ─────

  _pill(time, activity) {
    const f = family(activity);
    return `<span class="time">${hh(time)}</span><span class="pill" style="background:${f.color}">${f.emoji} ${esc(this._short(activity))}</span>`;
  }

  _statusOf(b) {
    if (b.status === 'booked') return { icon: 'mdi:check-circle', color: 'var(--success-color, #43a047)', text: 'Réservé' };
    if (b.status === 'waiting') return { icon: 'mdi:timer-sand', color: 'var(--warning-color, #ffa000)', text: `Liste d’attente ${b.waiting_position ?? '?'}/${b.waiting_count ?? '?'}` };
    if (b.status === 'planned') {
      const s = b.scheduled_at ? new Date(b.scheduled_at) : null;
      return { icon: 'mdi:calendar-clock', color: 'var(--info-color, #039be5)', text: s ? `Prévu · résa auto ${DAYS_SHORT[(s.getDay() + 6) % 7]} ${pad(s.getHours())}h${pad(s.getMinutes())}` : 'Prévu' };
    }
    return { icon: 'mdi:alert-circle', color: 'var(--error-color, #e53935)', text: b.error ? `Échec : ${b.error}` : 'Échec de la réservation auto' };
  }

  _actionButton(op, item) {
    const key = `${op} ${item.date} ${item.time} ${item.activity}`;
    const armed = this._armed === key;
    const busy = this._busy === `${item.date} ${item.time} ${item.activity}`;
    const icon = busy ? 'mdi:loading' : op === 'cancel' ? (armed ? 'mdi:close-circle' : 'mdi:close-circle-outline') : (armed ? 'mdi:check-bold' : 'mdi:plus');
    const label = op === 'cancel' ? 'Annuler' : 'Réserver';
    return `<button class="act ${op}${armed ? ' armed' : ''}${busy ? ' busy' : ''}" data-action="${op}" data-date="${esc(item.date)}" data-time="${esc(item.time)}"
      data-activity="${esc(item.activity)}" title="${label}" aria-label="${label}"><ha-icon icon="${icon}"></ha-icon></button>`;
  }

  _renderList() {
    if (!this._listOpen) return '';
    const items = this._bookings.filter((b) => ['booked', 'waiting', 'planned', 'failed'].includes(b.status));
    if (!items.length) return '<div class="empty">Aucun cours réservé</div>';
    return `<div class="list">${items.map((b) => {
      const s = this._statusOf(b);
      return `<div class="row">
        <ha-icon class="st" icon="${s.icon}" style="color:${s.color}"></ha-icon>
        <div class="txt"><div class="primary">${this._pill(b.time, b.activity)}</div><div class="secondary">${dayLabel(b.date)} · ${esc(s.text)}</div></div>
        ${b.status === 'failed' ? '' : this._actionButton('cancel', b)}
      </div>`;
    }).join('')}</div>`;
  }

  _renderPlanning() {
    if (!this._planning) return '';
    const start = this._weekStart();
    const monday = new Date(start); monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const label = `Semaine du ${monday.getDate()}${monday.getMonth() !== sunday.getMonth() ? ` ${MONTHS[monday.getMonth()]}` : ''} au ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;
    const nav = `<div class="nav">
      <button class="icon" data-action="week" data-delta="-1" ${this._week === 0 ? 'disabled' : ''} title="Semaine précédente" aria-label="Semaine précédente"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
      <span class="week">${label}</span>
      <button class="icon" data-action="week" data-delta="1" ${this._week >= 8 ? 'disabled' : ''} title="Semaine suivante" aria-label="Semaine suivante"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
      ${this._popup ? '<button class="icon" data-action="close-planning" title="Fermer" aria-label="Fermer"><ha-icon icon="mdi:close"></ha-icon></button>' : ''}
    </div>`;
    if (!this._classes) return `<div class="planning">${nav}<div class="empty">Chargement…</div></div>`;

    const mine = new Map(this._bookings.map((b) => [`${b.date} ${b.time} ${b.activity}`, b]));
    const now = Date.now();
    const days = [];
    for (let d = new Date(start); d <= sunday; d.setDate(d.getDate() + 1)) days.push(isoDay(d));
    const acts = new Set();
    const body = days.map((day, i) => {
      const classes = this._classes.filter((c) => c.date === day);
      classes.forEach((c) => acts.add(this._short(c.activities?.[0] ?? '?')));
      const visible = classes.filter((c) => new Date(c.datetime).getTime() > now && !this._masked.has(this._short(c.activities?.[0] ?? '?')));
      const d = parseDay(day);
      const rows = visible.map((c) => {
        const activity = c.activities?.[0] ?? '?';
        const item = { date: c.date, time: c.time, activity };
        const start = new Date(c.datetime).getTime();
        const open = start - now <= OPENS_MS;
        const p = c.places ?? 0; const o = c.places_taken ?? 0; const w = c.waiting_count ?? 0;
        let dispo;
        if (open) dispo = `${o < p ? `${p - o}/${p} places` : 'Complet'}${w > 0 ? ` · ${w} en attente` : ''}`;
        else { const ov = new Date(start - OPENS_MS); dispo = `${p} places · ouvre ${DAYS_SHORT[(ov.getDay() + 6) % 7]} ${pad(ov.getHours())}h${pad(ov.getMinutes())}`; }
        const m = mine.get(`${c.date} ${c.time} ${activity}`);
        const status = m?.status ?? (c.waiting_position != null ? 'waiting' : c.already_registered ? 'booked' : null);
        let icon = 'mdi:circle-small'; let color = 'var(--secondary-text-color)'; let text = dispo;
        if (status === 'booked') { icon = 'mdi:check-circle'; color = 'var(--success-color, #43a047)'; text = `Réservé · ${dispo}`; }
        else if (status === 'waiting') { icon = 'mdi:timer-sand'; color = 'var(--warning-color, #ffa000)'; text = `Attente ${c.waiting_position ?? m?.waiting_position ?? '?'}/${w || m?.waiting_count || '?'} · ${dispo}`; }
        else if (status === 'planned') { icon = 'mdi:calendar-clock'; color = 'var(--info-color, #039be5)'; text = `Prévu · ${dispo}`; }
        else if (status === 'failed') { icon = 'mdi:alert-circle'; color = 'var(--error-color, #e53935)'; text = 'Échec résa auto'; }
        else if (open && o >= p) color = 'var(--warning-color, #ffa000)';
        const op = status && status !== 'failed' ? 'cancel' : 'book';
        return `<div class="row">
          <ha-icon class="st" icon="${icon}" style="color:${color}"></ha-icon>
          <div class="txt"><div class="primary">${this._pill(c.time, activity)}</div><div class="secondary">${esc(text)}</div></div>
          ${this._actionButton(op, item)}
        </div>`;
      }).join('');
      return `<div class="day${i % 2 ? ' alt' : ''}"><div class="dayname">${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}</div>${rows || '<div class="empty small">Aucun cours</div>'}</div>`;
    }).join('');

    const all = [...new Set([...acts, ...this._masked])].sort((a, b) => a.localeCompare(b, 'fr'));
    const shown = all.filter((a) => !this._masked.has(a)).length;
    const filter = `<button class="filter" data-action="filter" aria-expanded="${this._filterOpen ? 'true' : 'false'}">
        <ha-icon icon="${this._filterOpen ? 'mdi:chevron-up' : 'mdi:filter-variant'}"></ha-icon><span>${shown}/${all.length}</span></button>
      ${this._filterOpen ? `<div class="chips">${all.map((a) => `<button class="chip${this._masked.has(a) ? '' : ' on'}" data-action="mask" data-activity="${esc(a)}">${family(a).emoji} ${esc(a)}</button>`).join('')}</div>` : ''}`;
    return `<div class="planning">${nav}${body}${filter}</div>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config || !this._hass) return;
    const state = this._state;
    if (!state) {
      this._card.innerHTML = `<div class="warn">Entité introuvable : ${esc(this._config.entity)}</div>`;
      return;
    }
    const items = this._bookings.filter((b) => ['booked', 'waiting', 'planned', 'failed'].includes(b.status));
    const next = items.find((b) => b.status !== 'failed');
    const failed = items.some((b) => b.status === 'failed');
    const summary = this._msg ?? (state.state === 'unavailable' ? 'Indisponible'
      : next ? `${items.length} cours · ${this._short(next.activity)} ${dayLabel(next.date)} · ${hh(next.time)}` : 'Aucun cours prévu');
    const color = failed ? 'var(--error-color, #e53935)' : next ? 'var(--success-color, #43a047)' : 'var(--disabled-text-color, #9e9e9e)';
    this._card.innerHTML = `
      <div class="head">
        <div class="main" data-action="toggle-list" role="button" tabindex="0" aria-expanded="${this._listOpen ? 'true' : 'false'}">
          <div class="badge" style="--c:${color}"><ha-icon icon="mdi:dumbbell"></ha-icon></div>
          <div class="txt"><div class="primary">Nutness</div><div class="secondary">${esc(summary)}</div></div>
        </div>
        <button class="icon${this._loading ? ' spin' : ''}" data-action="refresh" title="Actualiser" aria-label="Actualiser"><ha-icon icon="mdi:refresh"></ha-icon></button>
        <button class="icon accent${this._planning ? ' on' : ''}" data-action="planning" title="Planning" aria-label="Planning"><ha-icon icon="${this._planning ? 'mdi:calendar-remove' : 'mdi:calendar-plus'}"></ha-icon></button>
      </div>
      ${this._renderList()}
      ${this._popup ? '' : this._renderPlanning()}`;
    if (!this._popup) return;
    // Planning dans la fenêtre : le défilement est conservé d'un rendu à l'autre.
    if (this._planning) {
      const scroll = this._dialogBody.scrollTop;
      this._dialogBody.innerHTML = this._renderPlanning();
      this._dialogBody.scrollTop = scroll;
      if (!this._dialog.open) this._dialog.showModal();
    } else if (this._dialog.open) this._dialog.close();
  }
}

const CSS = `
  ha-card { padding: 8px 4px 8px 12px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 4px; }
  .main { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; cursor: pointer; padding: 4px 0; }
  .badge { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent); }
  .txt { min-width: 0; flex: 1; }
  .primary { font-weight: 500; font-size: 14px; color: var(--primary-text-color); display: flex; align-items: center; gap: 8px; }
  .secondary { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
  button.icon { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary-text-color); flex: none; }
  button.icon:hover { background: var(--secondary-background-color); }
  button.icon:disabled { opacity: .3; cursor: default; }
  button.icon.accent { color: var(--primary-color); }
  button.icon.on { background: color-mix(in srgb, var(--primary-color) 18%, transparent); }
  .spin ha-icon, .busy ha-icon { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .list, .planning { margin-top: 4px; border-top: 1px solid var(--divider-color); padding-top: 4px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 4px 0; min-height: 44px; }
  .row .st { --mdc-icon-size: 22px; flex: none; width: 28px; display: grid; place-items: center; }
  .time { font-variant-numeric: tabular-nums; }
  .pill { color: #fff; font-size: .85em; padding: 0 6px; border-radius: 5px; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button.act { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; transition: background .15s, color .15s; }
  button.act.book { color: var(--primary-color); }
  button.act.cancel { color: var(--error-color, #e53935); }
  button.act:hover { background: var(--secondary-background-color); }
  button.act.armed.book { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  button.act.armed.cancel { background: var(--error-color, #e53935); color: #fff; }
  .nav { display: flex; align-items: center; justify-content: space-between; }
  .week { font-weight: 500; font-size: 14px; }
  .day { padding: 2px 6px 2px 0; border-radius: 6px; }
  .day.alt { background: color-mix(in srgb, var(--primary-color) 6%, transparent); }
  .dayname { font-size: 13px; color: var(--secondary-text-color); font-weight: 600; padding: 10px 0 2px; }
  .empty { color: var(--secondary-text-color); font-size: 13px; padding: 8px 0; }
  .empty.small { font-size: 12px; font-style: italic; padding: 2px 0 6px; color: var(--disabled-text-color); }
  .filter { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 0; color: var(--secondary-text-color); font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 6px; }
  .chip { padding: 4px 10px; border-radius: 14px; border: 1px solid var(--divider-color); font-size: 12px; color: var(--secondary-text-color); }
  .chip.on { border-color: var(--primary-color); color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
  .warn { padding: 12px; color: var(--error-color); }
  dialog { padding: 0; border: none; border-radius: var(--ha-dialog-border-radius, 24px); width: min(560px, calc(100vw - 16px));
    max-height: min(88vh, 900px); background: var(--card-background-color, var(--ha-card-background, #1c1c1c));
    color: var(--primary-text-color); box-shadow: 0 8px 32px rgba(0, 0, 0, .45); overflow: hidden; }
  dialog::backdrop { background: rgba(0, 0, 0, .55); }
  #dialog-body { max-height: min(88vh, 900px); overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 12px 16px; }
  dialog .planning { margin-top: 0; border-top: none; padding-top: 0; }
  dialog .nav { position: sticky; top: 0; z-index: 1; background: inherit; padding: 8px 0 4px; background: var(--card-background-color, #1c1c1c); }
  dialog .week { flex: 1; text-align: center; }
  @media (max-width: 600px) { dialog { width: 100vw; max-width: 100vw; max-height: 92vh; border-radius: 16px 16px 0 0; margin: auto auto 0; }
    #dialog-body { max-height: 92vh; padding-bottom: max(12px, env(safe-area-inset-bottom)); } }
`;

if (!customElements.get('nutness-card')) {
  customElements.define('nutness-card', NutnessCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'nutness-card', name: 'Nutness', description: 'Prochains cours, planning et réservations', preview: false });
}
