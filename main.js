import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PRODOTTI, GRUPPI } from './prodotti.js';

// Blender (x, y, z) diventa Three.js (x, z, -y)
const v = (x, y, z) => new THREE.Vector3(x, z, -y);

const OCCHI = 1.62, RAGGIO = .32, PASSO = .75;
const CAMMINA = 1.45, CORRI = 2.6;
const BOB_SU = .016, BOB_LATO = .009;

// pianta della sala per le collisioni, in coordinate Blender (cx, cy, dx, dy)
const LIMITI = { x0: 14.0, x1: 29.2, z0: -7.12, z1: .26 };
const OSTACOLI = [
  [21.52, 3.47, 12.5, 3.3],     // tavolo con le sedute
  [14.21, 3.47, .62, 3.25],     // credenza sotto lo schermo
  [19.21, 6.98, 1.66, .56], [23.55, 6.98, 1.64, .56],   // mobili sul lato corridoio
  [14.72, .42, .62, .62],       // pianta nell'angolo
  [19.38, 0, .7, .8], [29.08, 0, .7, .8],               // pilastri sulla facciata
].map(([cx, cy, dx, dy]) => ({ x0: cx - dx / 2, x1: cx + dx / 2, z0: -cy - dy / 2, z1: -cy + dy / 2 }));

function libero(x, z) {
  if (x < LIMITI.x0 + RAGGIO || x > LIMITI.x1 - RAGGIO || z < LIMITI.z0 + RAGGIO || z > LIMITI.z1 - RAGGIO) return false;
  return !OSTACOLI.some((o) => x > o.x0 - RAGGIO && x < o.x1 + RAGGIO && z > o.z0 - RAGGIO && z < o.z1 + RAGGIO);
}

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .05, 2000);
camera.rotation.order = 'YXZ';

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .14, .5, 6.));   // solo i LED, non le pareti chiare
composer.addPass(new OutputPass());

const barra = document.querySelector('#barra i');
const manager = new THREE.LoadingManager();
manager.onProgress = (_, n, tot) => { barra.style.width = `${(n / tot) * 100}%`; };

const draco = new DRACOLoader(manager).setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/gltf/');
const gltf = new GLTFLoader(manager).setDRACOLoader(draco);
const exr = new EXRLoader(manager).setDataType(THREE.HalfFloatType);

function mappa(tex) {
  tex.channel = 1;
  tex.flipY = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function gruppoBake(o) {
  for (let p = o; p; p = p.parent) {
    if (p.name.startsWith('BAKE_statico')) return 'statico';
    if (p.name.startsWith('BAKE_sedie')) return 'sedie';
  }
  return null;
}

const [modello, lmStatico, lmSedie, esterno] = await Promise.all([
  gltf.loadAsync('./assets/cda.glb'),
  exr.loadAsync('./assets/lm_statico.exr'),
  exr.loadAsync('./assets/lm_sedie.exr'),
  exr.loadAsync('./assets/esterno.exr'),
]);

esterno.mapping = THREE.EquirectangularReflectionMapping;
esterno.colorSpace = THREE.LinearSRGBColorSpace;
scene.background = esterno;
scene.backgroundRotation.set(0, Math.PI / 2, 0);
scene.backgroundIntensity = 8.;                         // il cielo "da finestra" del .blend e' volutamente scuro

// dietro le vetrate verso il corridoio la scena non c'e': un fondale chiaro simula il corridoio illuminato
const fondale = new THREE.Mesh(new THREE.PlaneGeometry(16, 5.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(.95, .9, .82) }));
fondale.position.copy(v(21.5, 7.75, 2.5));
scene.add(fondale);

mappa(lmStatico); mappa(lmSedie);
const cotti = [], liberi = [];
const vetro = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .04, metalness: 0, transparent: true, opacity: .07, depthWrite: false });

modello.scene.traverse((o) => {
  if (!o.isMesh) return;
  const g = gruppoBake(o);
  if (g) {
    const m = o.material.clone();
    m.lightMap = g === 'statico' ? lmStatico : lmSedie;
    m.lightMapIntensity = Math.PI;                       // Cycles salva E/pi, Three.js vuole l'irradianza
    if (/gres/i.test(m.name)) m.color.multiplyScalar(.72);   // il pavimento risultava piu' chiaro che in Blender
    o.material = m; cotti.push(m);
  } else if (o.material.transmission > 0 || /vetr/i.test(o.material.name)) {
    o.material = vetro; o.renderOrder = 2;
  } else {
    liberi.push(o.material);
  }
});
scene.add(modello.scene);

// riflessi: una ripresa a 360 gradi della sala gia' illuminata dal bake
const cubo = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cuboCam = new THREE.CubeCamera(.1, 2000, cubo);
cuboCam.position.copy(v(21.5, 3.5, 1.6));
scene.add(cuboCam);
cuboCam.update(renderer, scene);
const riflessi = new THREE.PMREMGenerator(renderer).fromCubemap(cubo.texture).texture;
for (const m of cotti) { m.envMap = riflessi; m.envMapIntensity = m.metalness > .5 ? 1. : .12; m.needsUpdate = true; }
for (const m of liberi) { m.envMap = riflessi; m.envMapIntensity = 1.1; m.needsUpdate = true; }
vetro.envMap = riflessi; vetro.envMapIntensity = 1.; vetro.needsUpdate = true;

// --- camminata in prima persona ---------------------------------------------------------------
const io = { x: 28.4, z: -3.42, yaw: Math.PI / 2, pitch: -.03, vx: 0, vz: 0, strada: 0, amp: 0 };
const tasti = new Set();
const vista = { abaco: false };                         // abaco aperto: si sta fermi
const ingresso = document.querySelector('#ingresso');
const aiuto = document.querySelector('#titolo');
let bloccato = false;
const prova = { attiva: false };                         // solo per i controlli automatici, senza blocco del mouse
const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;

document.querySelector('#carica').classList.add('via');
ingresso.hidden = false;

ingresso.addEventListener('click', () => renderer.domElement.requestPointerLock());
renderer.domElement.addEventListener('click', () => { if (!bloccato) renderer.domElement.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  bloccato = document.pointerLockElement === renderer.domElement;
  ingresso.hidden = bloccato;
  document.body.classList.toggle('dentro', bloccato);
  aiuto.classList.toggle('discreto', bloccato);
  if (!bloccato) tasti.clear();
});
document.addEventListener('mousemove', (e) => {
  if (!bloccato || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;   // scarta i salti del puntatore
  io.yaw -= e.movementX * .0021;
  io.pitch = THREE.MathUtils.clamp(io.pitch - e.movementY * .0021, -1.35, 1.35);
});
const usati = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', (e) => { if (usati.has(e.code)) { tasti.add(e.code); e.preventDefault(); } });
addEventListener('keyup', (e) => tasti.delete(e.code));
addEventListener('blur', () => tasti.clear());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

function aggiorna(dt, t) {
  const attivo = (bloccato || prova.attiva) && !vista.abaco;
  const av = attivo ? (+(tasti.has('KeyW') || tasti.has('ArrowUp')) - +(tasti.has('KeyS') || tasti.has('ArrowDown'))) : 0;
  const la = attivo ? (+(tasti.has('KeyD') || tasti.has('ArrowRight')) - +(tasti.has('KeyA') || tasti.has('ArrowLeft'))) : 0;
  const n = Math.hypot(av, la) || 1, vel = tasti.has('ShiftLeft') || tasti.has('ShiftRight') ? CORRI : CAMMINA;
  const sy = Math.sin(io.yaw), cy = Math.cos(io.yaw);
  const tx = ((-sy * av) + (cy * la)) / n * vel, tz = ((-cy * av) - (sy * la)) / n * vel;
  const k = 1 - Math.exp(-dt * 9.);                      // accelerazione morbida, niente scatti
  io.vx += (tx - io.vx) * k; io.vz += (tz - io.vz) * k;
  const px = io.x, pz = io.z, nx = io.x + io.vx * dt, nz = io.z + io.vz * dt;
  if (libero(nx, io.z)) io.x = nx; else io.vx = 0;       // assi separati: si scivola lungo gli ostacoli
  if (libero(io.x, nz)) io.z = nz; else io.vz = 0;
  const fatto = Math.hypot(io.x - px, io.z - pz), v_ = dt > 0 ? fatto / dt : 0;
  io.strada += fatto;
  io.amp += (Math.min(v_ / CAMMINA, 1.25) - io.amp) * (1 - Math.exp(-dt * 7.));
  const f = (io.strada / PASSO) * Math.PI;               // una oscillazione verticale a ogni passo
  const su = fermo ? 0 : Math.abs(Math.sin(f)) * 2 * BOB_SU * io.amp - BOB_SU * io.amp + Math.sin(t * 1.3) * .0025;
  const lato = fermo ? 0 : Math.sin(f) * BOB_LATO * io.amp;
  camera.position.set(io.x + cy * lato, OCCHI + su, io.z - sy * lato);
  camera.rotation.set(io.pitch, io.yaw, 0);
}

// --- offerta interattiva: il mirino riconosce i prodotti, il tasto I apre l'abaco della sala ----------
const PORTATA = 13;                                      // la sala e' lunga 15 m: oltre non ha senso
const zone = [];
for (const p of PRODOTTI) for (const [x0, x1, y0, y1, z0, z1] of p.zone ?? [])
  zone.push({ p, box: new THREE.Box3(new THREE.Vector3(x0, z0, -y1), new THREE.Vector3(x1, z1, -y0)) });
const IN_VISTA = PRODOTTI.filter((p) => p.zone);
const raggio = new THREE.Raycaster(), centro = new THREE.Vector2(0, 0), punto = new THREE.Vector3(), angolo = new THREE.Vector3();
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['mirino', 'cornice', 'scheda', 'richiamo', 'r-linea', 'r-punto', 'visti', 's-voce', 's-pezzi', 's-gruppo',
  's-modello', 's-ruolo', 's-dati', 's-nota', 'elenco', 'a-voci', 'a-vista', 'a-trovati'].map((id) => [id, $(id)]));
const trovati = new Set();
let attuale = null;
const due = (n) => String(n).padStart(2, '0');
const pezzi = (p) => `× ${p.n}`;

function dati(dl, p) {
  dl.replaceChildren(...p.dati.flatMap(([k, val]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = val; return [dt, dd];
  }));
}
function scheda(p) {
  ui['s-voce'].textContent = due(p.voce);
  ui['s-pezzi'].textContent = pezzi(p);
  ui['s-gruppo'].textContent = p.gruppo;
  ui['s-modello'].textContent = p.modello;
  ui['s-ruolo'].textContent = p.ruolo;
  dati(ui['s-dati'], p);
  ui['s-nota'].textContent = p.nota;
}

// --- abaco ---------------------------------------------------------------------------------------
const righe = new Map();                                 // prodotto -> riga dell'elenco
let scelto = null;
function costruisciAbaco() {
  const elementi = [];
  for (const g of GRUPPI) {
    const del = PRODOTTI.filter((p) => p.gruppo === g);
    if (!del.length) continue;
    const testa = document.createElement('div');
    testa.className = 'gruppo-testa';
    testa.append(Object.assign(document.createElement('span'), { textContent: g }), Object.assign(document.createElement('i'), { textContent: del.length }));
    elementi.push(testa);
    for (const p of del) {
      const r = document.createElement('button');
      r.type = 'button'; r.className = 'elemento';
      r.innerHTML = '<span class="num"></span><span><div class="nome"><span></span><em></em></div><div class="ruolo"></div></span>'
        + '<span class="dove"><span></span><i class="segno"></i></span><div class="apri"><dl class="dati"></dl><p class="nota"></p></div>';
      r.querySelector('.num').textContent = due(p.voce);
      r.querySelector('.nome span').textContent = p.modello;
      r.querySelector('.nome em').textContent = pezzi(p);
      r.querySelector('.ruolo').textContent = p.ruolo;
      r.querySelector('.dove span').textContent = p.dove;
      const segno = r.querySelector('.segno');
      segno.classList.add(p.zone ? 'vista' : 'nascosto');
      segno.title = p.zone ? 'In vista nella sala' : 'Non in vista';
      dati(r.querySelector('.dati'), p);
      r.querySelector('.nota').textContent = p.nota;
      r.addEventListener('pointerenter', () => { if (!bloccato) scegli(p, false); });
      r.addEventListener('click', () => scegli(p, false));
      righe.set(p, r); elementi.push(r);
    }
  }
  ui.elenco.replaceChildren(...elementi);
  ui['a-voci'].textContent = PRODOTTI.length;
  ui['a-vista'].textContent = IN_VISTA.length;
}
function scegli(p, scorri = true) {
  if (scelto) righe.get(scelto).classList.remove('scelto');
  scelto = p;
  const r = righe.get(p);
  r.classList.add('scelto');
  if (scorri) r.scrollIntoView({ block: 'nearest', behavior: fermo ? 'auto' : 'smooth' });
}
function aggiornaTrovati() {
  ui.visti.textContent = `${trovati.size}/${IN_VISTA.length}`;
  ui['a-trovati'].textContent = trovati.size;
  for (const p of trovati) righe.get(p)?.querySelector('.segno').classList.add('trovato');
}
const ordine = GRUPPI.flatMap((g) => PRODOTTI.filter((p) => p.gruppo === g));
function apriAbaco(si) {
  vista.abaco = si;
  document.body.classList.toggle('abaco', si);
  if (si) { tasti.clear(); scegli(attuale ?? scelto ?? ordine[0]); }
}
function sposta(d) {
  const i = ordine.indexOf(scelto);
  scegli(ordine[THREE.MathUtils.clamp(i + d, 0, ordine.length - 1)]);
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); if (!e.repeat) apriAbaco(!vista.abaco); return; }
  if (!vista.abaco) return;
  if (['ArrowDown', 'KeyS'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); sposta(1); }
  else if (['ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); sposta(-1); }
  else if (e.code === 'Escape' && !bloccato) apriAbaco(false);
}, { capture: true });
addEventListener('wheel', (e) => { if (vista.abaco && bloccato) sposta(Math.sign(e.deltaY)); }, { passive: true });
costruisciAbaco(); aggiornaTrovati();

// --- mirino, angoli, richiamo e scheda -----------------------------------------------------------
function punta() {
  camera.updateMatrixWorld();
  raggio.setFromCamera(centro, camera);
  let meglio = null, d = PORTATA;
  for (const z of zone) {
    if (!raggio.ray.intersectBox(z.box, punto)) continue;
    const dz = punto.distanceTo(camera.position);
    if (dz < d) { d = dz; meglio = z; }
  }
  const p = meglio?.p ?? null;
  if (p !== attuale) {
    attuale = p;
    if (p) {
      scheda(p);
      if (!trovati.has(p)) { trovati.add(p); aggiornaTrovati(); }
    }
    for (const k of ['mirino', 'scheda', 'cornice', 'richiamo']) ui[k].classList.toggle('su', !!p);
  }
  if (!meglio) return;
  // angoli attorno al prodotto: proiezione degli 8 vertici della zona, con un po' d'aria
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const { min, max } = meglio.box;
  for (let i = 0; i < 8; i++) {
    angolo.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera);
    const sx = (angolo.x + 1) / 2 * innerWidth, sy = (1 - angolo.y) / 2 * innerHeight;
    l = Math.min(l, sx); r = Math.max(r, sx); t = Math.min(t, sy); b = Math.max(b, sy);
  }
  const aria = 8, minimo = 32, cx = (l + r) / 2, cy = (t + b) / 2;
  const w = Math.max(r - l + aria * 2, minimo), h = Math.max(b - t + aria * 2, minimo);
  const c = ui.cornice.style;
  c.width = `${w}px`; c.height = `${h}px`; c.transform = `translate(${cx - w / 2}px, ${cy - h / 2}px)`;
  // scheda di lato, staccata quanto basta per la linea di richiamo; a sinistra se a destra non c'e' spazio
  const sw = ui.scheda.offsetWidth, sh = ui.scheda.offsetHeight, bordo = 16, stacco = 48, aggancio = 17;
  const aDestra = cx + w / 2 + stacco + sw <= innerWidth - bordo || cx - w / 2 - stacco - sw < bordo;
  let x = aDestra ? cx + w / 2 + stacco : cx - w / 2 - stacco - sw;
  x = THREE.MathUtils.clamp(x, bordo, innerWidth - bordo - sw);
  const y = THREE.MathUtils.clamp(cy - aggancio, bordo, innerHeight - bordo - sh);
  ui.scheda.style.left = `${x}px`; ui.scheda.style.top = `${y}px`;
  // richiamo: dal bordo della cornice, in diagonale fino a una spalla orizzontale, poi dentro la scheda
  const ax = aDestra ? cx + w / 2 : cx - w / 2, ay = cy;
  const kx = aDestra ? x : x + sw, ky = y + aggancio, spalla = aDestra ? kx - 18 : kx + 18;
  ui['r-linea'].setAttribute('d', `M${ax} ${ay} L${spalla} ${ky} L${kx} ${ky}`);
  ui['r-punto'].setAttribute('cx', ax); ui['r-punto'].setAttribute('cy', ay);
}

let prima = performance.now();
renderer.setAnimationLoop((ora) => {
  const dt = Math.min(Math.max(ora - prima, 0) / 1000, .05);
  prima = ora;
  aggiorna(dt, ora / 1000);
  punta();
  composer.render();
});
window.__demo = { io, tasti, prova, libero, punta, zone, camera, scene: modello.scene, apriAbaco };
