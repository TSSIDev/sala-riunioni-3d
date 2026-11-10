// Pianta percorribile della sede: muri, ostacoli, zone e porte. Nessuna dipendenza: si prova anche da node (prova_mondo.mjs).
// Coordinate Blender in pianta (x, y), in metri. I dati arrivano da mappa.json, scritto da costruisci_blender.py.

export function creaMondo(mappa, raggio = .32) {
  const solidi = [];                                     // capsule: segmento (ax, ay)-(bx, by) con raggio r
  const cap = (ax, ay, bx, by, r) => solidi.push({ ax, ay, bx, by, r });
  const rett = ([cx, cy, dx, dy, rot]) => {              // rettangolo come capsula lungo il lato maggiore
    const a = rot * Math.PI / 180, L = Math.max(dx, dy), W = Math.min(dx, dy), h = (L - W) / 2;
    const ux = dx >= dy ? Math.cos(a) : -Math.sin(a), uy = dx >= dy ? Math.sin(a) : Math.cos(a);
    cap(cx - ux * h, cy - uy * h, cx + ux * h, cy + uy * h, W / 2);
  };
  for (const [ax, ay, bx, by, th] of mappa.muri) cap(ax, ay, bx, by, th / 2);
  for (const p of mappa.pilastri) rett(p);
  for (const o of mappa.ostacoli) o.rett ? rett(o.rett) : cap(o.seg[0], o.seg[1], o.seg[2], o.seg[3], o.seg[4] / 2);
  for (const [x, y, r] of mappa.piante) cap(x, y, x, y, r);
  for (const [x, y] of mappa.sedie) cap(x, y, x, y, .24);

  const zone = mappa.zone, pronte = new Set();
  const zonaDi = (x, y) => zone.findIndex(({ r }) => x >= r[0] && x <= r[1] && y >= r[2] && y <= r[3]);

  // ante: cardine in (x, y), l'anta chiusa va lungo ang per w metri
  const ante = mappa.ante.map((a) => {
    const ux = Math.cos(a.ang), uy = Math.sin(a.ang);
    return { ...a, ux, uy, nx: -uy, ny: ux, cx: a.x + ux * a.w / 2, cy: a.y + uy * a.w / 2, f: 0, meta: 0, verso: 1, apribile: false };
  });
  function aggiornaApribili() {                          // una porta si apre solo se dai due lati c'e' una zona gia' caricata
    for (const a of ante) {
      const z1 = zonaDi(a.cx + a.nx * .7, a.cy + a.ny * .7), z2 = zonaDi(a.cx - a.nx * .7, a.cy - a.ny * .7);
      a.apribile = z1 !== z2 && pronte.has(z1) && pronte.has(z2);   // le porte interne a una zona (bagni) restano chiuse
    }
  }

  function distanza(s, x, y) {                            // distanza dal segmento e punto piu' vicino
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0;
    const qx = s.ax + dx * t, qy = s.ay + dy * t;
    return { d: Math.hypot(x - qx, y - qy), qx, qy };
  }
  function spingi(x, y) {                                 // fuori da muri e ostacoli: cosi' si scivola lungo le pareti, anche oblique
    for (let giro = 0; giro < 3; giro++) {
      for (const s of solidi) {
        const { d, qx, qy } = distanza(s, x, y), m = s.r + raggio;
        if (d < m && d > 1e-6) { x = qx + (x - qx) / d * m; y = qy + (y - qy) / d * m; }
      }
      for (const a of ante) {
        if (a.apribile && a.f > .45) continue;            // anta aperta abbastanza: si passa
        const s = { ax: a.x, ay: a.y, bx: a.x + a.ux * a.w, by: a.y + a.uy * a.w, r: .03 };
        const { d, qx, qy } = distanza(s, x, y), m = s.r + raggio;
        if (d < m && d > 1e-6) { x = qx + (x - qx) / d * m; y = qy + (y - qy) / d * m; }
      }
    }
    return [x, y];
  }
  const ammesso = (x, y) => pronte.has(zonaDi(x, y));     // niente passi nel vuoto: fuori dalle zone caricate non si va
  function muovi(p, dx, dy) {
    let [x, y] = spingi(p.x + dx, p.y + dy);
    if (!ammesso(x, y)) {
      [x, y] = spingi(p.x + dx, p.y); if (!ammesso(x, y)) { [x, y] = spingi(p.x, p.y + dy); if (!ammesso(x, y)) return false; }
    }
    if (Math.hypot(x - p.x, y - p.y) > Math.hypot(dx, dy) + .2) return false;   // una spinta troppo lunga vuol dire incastro: si resta fermi
    p.x = x; p.y = y; return true;
  }

  const APRE = 1.7, CHIUDE = 2.5, GIRO = 1.45;            // metri dal centro dell'anta; angolo di apertura in radianti
  function aggiornaAnte(dt, px, py) {
    for (const a of ante) {
      if (!a.apribile) { a.meta = 0; }
      else {
        const d = Math.hypot(px - a.cx, py - a.cy);
        if (d < APRE && a.meta === 0) {                   // si apre dalla parte opposta a chi arriva
          a.meta = 1;
          if (a.f < .05) a.verso = ((px - a.x) * a.nx + (py - a.y) * a.ny) >= 0 ? -1 : 1;
        } else if (d > CHIUDE) a.meta = 0;
      }
      a.f += (a.meta - a.f) * (1 - Math.exp(-dt * 4.5));
      a.angolo = a.verso * GIRO * a.f * a.f * (3 - 2 * a.f);   // partenza e arrivo morbidi
    }
  }
  return { solidi, zone, pronte, zonaDi, ante, aggiornaApribili, muovi, aggiornaAnte, ammesso };
}
