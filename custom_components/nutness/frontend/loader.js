// Chargeur de la carte, servi par Home Assistant (même origine que la page : une adresse data: est
// refusée par Safari pour l'import). Sur iPhone, l'application revenant au premier plan recharge parfois
// la page avant que le réseau soit prêt : l'import échoue et la carte reste en « Erreur de configuration ».
// On réessaie avec une autre adresse (&r=n) jusqu'au succès ; Home Assistant reconstruit alors la carte.
const url = new URL('nutness-card.js' + new URL(import.meta.url).search, import.meta.url).href;
let n = 0, busy = false;
const load = () => {
  if (busy || customElements.get('nutness-card')) return;
  busy = true;
  import(n ? url + '&r=' + n : url).then(() => { busy = false; }, () => {
    busy = false; n += 1;
    setTimeout(load, Math.min(30000, 1000 * 2 ** Math.min(n, 5)));
  });
};
load();
addEventListener('online', load);
addEventListener('pageshow', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
