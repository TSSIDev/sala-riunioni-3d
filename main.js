import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { PRODOTTI, GRUPPI } from './prodotti.js';
import { creaMondo } from './mondo.js';

// Visita di tutta la sede. Ogni zona (assets/<zona>) ha il suo modello e le sue mappe di luce cotte in Blender;
// le zone si caricano una dopo l'altra partendo dalla piu' vicina. Muri, porte e ostacoli arrivano da mappa.json.
// Blender (x, y, z) diventa Three.js (x, z, -y).
const v = (x, y, z) => new THREE.Vector3(x, z, -y);
const DRACO = new URL(import.meta.resolve('three/addons/libs/draco/gltf/')).href;
const BASIS = new URL(import.meta.resolve('three/addons/libs/basis/')).href;

// Smartphone e tablet: comandi a tocco, asset leggeri (file con suffisso _m, se ci sono) e meno pixel. ?tocco nell'indirizzo la forza anche col mouse.
const TOCCO = new URLSearchParams(location.search).has('tocco') || matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('tocco', TOCCO);
const OCCHI = 1.62, RAGGIO = .32, PASSO = .75;
const CAMMINA = 1.45, CORRI = 2.6;
const BOB_SU = .016, BOB_LATO = .009;

const mappa = await (await fetch('./mappa.json')).json();
const mondo = creaMondo(mappa, RAGGIO);
const ZONE = mappa.zone.map((z, i) => ({ ...z, i, stato: 'manca', info: null, interni: [], bersagli: [], visto: -1e9, interniSu: true }));
// sedie e piante di ogni zona: cinque punti ciascuna, per capire se da dove ci si trova se ne vede almeno una
for (const [x, y] of [...mappa.sedie, ...mappa.piante]) {
  const z = ZONE[mondo.zonaDi(x, y)];
  if (z) for (const [dx, dy] of [[0, 0], [.28, 0], [-.28, 0], [0, .28], [0, -.28]]) z.bersagli.push(x + dx, y + dy);
}
await Promise.all(ZONE.map(async (z) => {
  try { const r = await fetch(`./assets/${z.id}/info.json`); if (r.ok) { z.info = await r.json(); z.stato = 'attesa'; } } catch { /* zona senza bake */ }
}));

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, TOCCO ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.;
renderer.localClippingEnabled = true;                   // i monitor a scomparsa spariscono sotto il piano del tavolo
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .05, 2000);
camera.rotation.order = 'YXZ';

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: TOCCO ? 0 : 4 }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .12, .5, 11.));  // solo i LED (emissione 14): non il cielo ne' le pareti al sole
composer.addPass(new OutputPass());
// aspetto del render di Blender: three.js ha AgX di base, la tabella look.cube (genera_lut.py) aggiunge contrasto ed esposizione del render.
// Si applica all'immagine gia' pronta per lo schermo. Tasto L per confrontare con e senza; se il file manca si resta su AgX di base.
const look = new LUTPass({ intensity: 1 });
look.enabled = false;
composer.addPass(look);
new LUTCubeLoader().loadAsync('./look.cube').then((t) => { look.lut = t.texture3D; look.enabled = true; }, () => console.warn('look.cube non trovato: resta AgX di base'));
addEventListener('keydown', (e) => { if (e.code === 'KeyL' && !e.repeat && !e.ctrlKey && !e.metaKey && look.lut) look.enabled = !look.enabled; });
// texture nitide anche viste di taglio (pavimento, piani dei tavoli): filtro anisotropico al massimo della scheda, piu' basso sui telefoni
const ANISO = Math.min(renderer.capabilities.getMaxAnisotropy(), TOCCO ? 4 : 16);
function nitida(m) { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) m[k].anisotropy = ANISO; }

const $ = (id) => document.getElementById(id);
const barra = document.querySelector('#barra i');
const manager = new THREE.LoadingManager();
manager.onProgress = (_, n, tot) => { barra.style.width = `${(n / tot) * 100}%`; };
// texture KTX2 (se gli asset sono stati preparati cosi'): restano compresse anche nella scheda video, circa un quinto della memoria. Gli asset WebP si caricano come prima
const ktx2 = new KTX2Loader().setTranscoderPath(BASIS).detectSupport(renderer);
const caricatori = (m) => ({ gltf: new GLTFLoader(m).setDRACOLoader(new DRACOLoader(m).setDecoderPath(DRACO)).setKTX2Loader(ktx2), exr: new EXRLoader(m).setDataType(THREE.HalfFloatType) });
const primi = caricatori(manager), dopo = caricatori(undefined);

// sui telefoni si prova prima il file leggero (<nome>_m.<est>); se manca si prende quello pieno
async function leggi(caricatore, base, nome, est) {
  if (TOCCO) { try { return await caricatore.loadAsync(`${base}${nome}_m.${est}`); } catch { /* niente versione leggera */ } }
  return caricatore.loadAsync(`${base}${nome}.${est}`);
}
function mappaLuce(tex) {
  tex.channel = 1; tex.flipY = true; tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(ANISO, 8); tex.needsUpdate = true;
  return tex;
}
function gruppoBake(o) {
  for (let p = o; p; p = p.parent) {
    if (p.name.startsWith('BAKE_statico')) return 'statico';
    if (p.name.startsWith('BAKE_sedie')) return 'sedie';
  }
  return null;
}

const cotti = [], liberi = [];
const vetro = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .04, metalness: 0, transparent: true, opacity: .07, depthWrite: false });
const satinato = new THREE.MeshStandardMaterial({ color: 0xf2f6f6, roughness: .6, metalness: 0, transparent: true, opacity: .55, depthWrite: false });
// vetri rimasti nei gruppi cotti (tavolo in vetro, sportello fume'): niente trasmissione, altrimenti three.js ridisegna
// tutta la scena una seconda volta a ogni fotogramma. Un velo trasparente con la tinta del vetro, uno per materiale.
const vetriCotti = new Map();
function vetroSemplice(m) {
  if (!vetriCotti.has(m.name)) {
    const chiaro = (m.color.r + m.color.g + m.color.b) / 3;   // piu' il vetro e' scuro, piu' copre
    vetriCotti.set(m.name, new THREE.MeshStandardMaterial({ name: m.name, color: m.color.clone().multiplyScalar(chiaro), roughness: Math.max(m.roughness, .04), metalness: 0,
      transparent: true, opacity: Math.min(.6, .05 + (1 - chiaro)), depthWrite: false, side: m.side, envMap: riflessi, envMapIntensity: 1. }));
  }
  return vetriCotti.get(m.name);
}
const nodiAnte = new Map();                              // nome dell'anta -> { o, base }
const contenuti = [];                                    // immagini su monitor e telo: si accendono e si spengono
const monitor = [];                                      // opzione 3: monitor a scomparsa nel tavolo
const zoneProdotti = [];                                 // { p, zona, box }
const cornici = [];                                      // opzione 3: cornici incassate nel piano, da cui escono i monitor
const stato = { monitorSu: false, fMonitor: 0, monitorVisti: false };
// movimento dei monitor: salgono in verticale dalla feritoia, si inclinano all'indietro, poi si accende l'immagine; uno dopo l'altro lungo il tavolo
const MON = { corsa: .258, piega: 20 * Math.PI / 180, tSale: 1.5, tPiega: .7, tLuce: .35, passo: .09 };   // corsa e piega come in prodotti3d.py
const liscio = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

async function caricaZona(z, c) {
  z.stato = 'carico';
  const base = `./assets/${z.id}/`;
  const [modello, lmS, lmC] = await Promise.all([
    leggi(c.gltf, base, z.id, 'glb'), leggi(c.exr, base, 'lm_statico', 'exr'),
    z.info.mappe.BAKE_sedie ? leggi(c.exr, base, 'lm_sedie', 'exr') : null,
  ]);
  mappaLuce(lmS); if (lmC) mappaLuce(lmC);
  modello.scene.traverse((o) => {
    const anta = /^(?:BAKE_statico_)?(Anta\d\d)$/.exec(o.name);
    if (anta) nodiAnte.set(anta[1], { o, base: o.quaternion.clone() });
    if (/^BAKE_sedie|^Pianta/.test(o.name)) z.interni.push(o);
    if (/^Opzione_3_-_Monitor/.test(o.name)) monitor.push({ o, y: o.position.y, q: o.quaternion.clone(), schermi: null });
    if (/^Opzione_3_-_Cornice/.test(o.name)) { cornici.push(o); o.visible = stato.monitorVisti; }
    if (!o.isMesh) return;
    nitida(o.material);
    const g = gruppoBake(o);
    if (g && o.material.transmission > 0) {
      o.material = vetroSemplice(o.material); o.renderOrder = 3;
    } else if (g) {
      const m = o.material.clone();
      m.lightMap = g === 'statico' ? lmS : lmC;
      m.lightMapIntensity = Math.PI;                     // Cycles salva E/pi, Three.js vuole l'irradianza
      if (/gres/i.test(m.name)) m.color.multiplyScalar(.72);   // il pavimento risultava piu' chiaro che in Blender
      o.material = m; cotti.push(m);
    } else if (/satinato/i.test(o.material.name)) {
      o.material = satinato; o.renderOrder = 2;
    } else if (o.material.transmission > 0 || /vetr/i.test(o.material.name)) {
      o.material = vetro; o.renderOrder = 3;
    } else {
      liberi.push(o.material);
      if (/^Contenuto/.test(o.name) || /^Contenuto/.test(o.parent?.name ?? '')) {
        o.geometry.computeBoundingBox();
        contenuti.push({ o, centro: o.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld), zona: z.id });
      }
    }
  });
  scene.add(modello.scene);
  modello.scene.updateMatrixWorld(true);
  for (const m of monitor) {
    if (m.schermi) continue;
    // sotto il piano del tavolo il pannello non si deve vedere: ogni monitor ha i suoi materiali, tagliati alla quota del piano
    const piano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(m.o.getWorldPosition(new THREE.Vector3()).y + .0002));
    m.schermi = [];
    m.o.traverse((p) => {
      if (!p.isMesh) return;
      const mat = p.material.clone(); mat.clippingPlanes = [piano]; p.material = mat; liberi.push(mat);
      if (mat.emissiveMap) m.schermi.push({ mat, e: mat.emissiveIntensity });
    });
  }
  monitor.sort((a, b) => (a.o.position.x - b.o.position.x) || (a.o.position.z - b.o.position.z));
  for (const k of contenuti) if (k.zona === z.id) { k.o.geometry.computeBoundingBox(); k.centro = k.o.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(k.o.matrixWorld); }
  for (const p of PRODOTTI) {
    if (!p.sale.includes(z.id)) continue;
    for (const nome of p.oggetti ?? []) for (const [x0, y0, z0, x1, y1, z1] of z.info.prodotti[nome] ?? []) {
      const box = new THREE.Box3(new THREE.Vector3(x0, z0, -y1), new THREE.Vector3(x1, z1, -y0));
      const d = box.getSize(new THREE.Vector3());          // oggetti sottili (prese, diffusori): un minimo di spessore per puntarli
      box.expandByVector(new THREE.Vector3(Math.max(.02, (.1 - d.x) / 2), Math.max(.02, (.1 - d.y) / 2), Math.max(.02, (.1 - d.z) / 2)));
      zoneProdotti.push({ p, zona: z, box });
    }
  }
  z.stato = 'pronta'; mondo.pronte.add(z.i); mondo.aggiornaApribili();
}

// --- vista: sedie e piante sono quasi tutti i triangoli della scena. Si disegnano solo quelle delle zone che da qui si possono vedere:
// muri ciechi e porte in legno chiuse nascondono, le vetrate no. Pareti, arredi e prodotti restano sempre (niente buchi attorno alle porte).
const INTORNO = [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]];
let vistaT = -1;
function aggiornaVista(t) {
  if (t - vistaT < .2) return;
  vistaT = t;
  for (const z of ZONE) {
    if (z.stato !== 'pronta' || !z.interni.length) continue;
    let si = !mondo.conVista || z === zonaOra || !z.bersagli.length;   // mappa senza muri ciechi (file vecchio): si disegna tutto
    for (let k = 0; !si && k < INTORNO.length; k++) {
      const px = io.x + INTORNO[k][0], py = io.y + INTORNO[k][1], b = z.bersagli;
      for (let i = 0; i < b.length; i += 2) if (mondo.vede(px, py, b[i], b[i + 1])) { si = true; break; }
    }
    if (si) z.visto = t;
    const su = t - z.visto < .6;                           // resta acceso un attimo dopo l'ultima volta che si e' visto
    if (su !== z.interniSu) { z.interniSu = su; for (const o of z.interni) o.visible = su; }
  }
}

// --- riflessi: una ripresa a 360 gradi dal punto in cui ci si trova, gia' illuminata dal bake -----------------
const cubo = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cuboCam = new THREE.CubeCamera(.1, 2000, cubo);
scene.add(cuboCam);
const pmrem = new THREE.PMREMGenerator(renderer);
let riflessi = null;
function riprendi(x, y) {
  for (const m of monitor) m.o.visible = false;
  cuboCam.position.copy(v(x, y, 1.6)); cuboCam.update(renderer, scene);
  const nuovo = pmrem.fromCubemap(cubo.texture).texture;
  riflessi?.dispose(); riflessi = nuovo;
  for (const m of cotti) { m.envMap = riflessi; m.envMapIntensity = m.metalness > .5 ? 1. : .12; m.needsUpdate = true; }
  for (const m of liberi) { m.envMap = riflessi; m.envMapIntensity = 1.1; m.needsUpdate = true; }
  for (const m of [vetro, satinato, ...vetriCotti.values()]) { m.envMap = riflessi; m.envMapIntensity = 1.; m.needsUpdate = true; }
}

// --- partenza: la zona in cui si entra si carica per prima, le altre in ordine di distanza --------------------
const io = { x: mappa.partenza.x, y: mappa.partenza.y, yaw: Math.PI / 2, pitch: -.03, vx: 0, vy: 0, strada: 0, amp: 0 };
let prima_zona = ZONE[mondo.zonaDi(io.x, io.y)];
if (!prima_zona?.info) {                                   // se la sala CdA non c'e' si parte dal centro della prima zona disponibile
  prima_zona = ZONE.find((z) => z.info);
  if (prima_zona) { io.x = (prima_zona.r[0] + prima_zona.r[1]) / 2; io.y = (prima_zona.r[2] + prima_zona.r[3]) / 2; }
}
if (!prima_zona) { document.querySelector('#carica div').textContent = 'Mancano gli asset: lanciare prima il bake'; throw new Error('nessuna zona in assets/'); }
const [, esterno] = await Promise.all([
  caricaZona(prima_zona, primi),
  leggi(primi.exr, './assets/cda/', 'esterno', 'exr').catch(() => null),
]);
if (esterno) {
  esterno.mapping = THREE.EquirectangularReflectionMapping; esterno.colorSpace = THREE.LinearSRGBColorSpace;
  scene.background = esterno; scene.backgroundRotation.set(0, Math.PI / 2, 0);
  scene.backgroundIntensity = 2.2;                       // confrontato con il render di Blender: a 8 il paesaggio bruciava e accendeva il bloom
} else scene.background = new THREE.Color(.75, .82, .9);
riprendi(io.x, io.y);

const distZona = (z) => Math.hypot(Math.max(z.r[0] - io.x, 0, io.x - z.r[1]), Math.max(z.r[2] - io.y, 0, io.y - z.r[3]));
(async () => {
  const caricoEl = $('carico');
  for (;;) {
    const z = ZONE.filter((q) => q.stato === 'attesa').sort((a, b) => distZona(a) - distZona(b))[0];
    if (!z) break;
    caricoEl.textContent = `Carico: ${z.nome}`; caricoEl.hidden = false;
    try { await caricaZona(z, dopo); riprendi(io.x, io.y); azioni(); } catch (e) { z.stato = 'manca'; console.warn('zona non caricata', z.id, e); }
  }
  caricoEl.hidden = true; azioni();
})();

// --- camminata in prima persona ---------------------------------------------------------------
const tasti = new Set();
const vista = { abaco: false };                         // abaco aperto: si sta fermi
const ingresso = document.querySelector('#ingresso');
const aiuto = document.querySelector('#titolo');
let bloccato = false;
const prova = { attiva: false };                         // solo per i controlli automatici, senza blocco del mouse
const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;

document.querySelector('#carica').classList.add('via');
ingresso.hidden = false;

const tela = renderer.domElement;
// comandi a tocco: a sinistra la leva per camminare, altrove si trascina per guardare, un tocco breve usa quello che si punta
const leva = { id: null, x0: 0, y0: 0, x: 0, y: 0 };     // x verso destra, y in avanti, da -1 a 1
const sguardo = { id: null, x: 0, y: 0, strada: 0, t: 0 };
const R_LEVA = 54, levaEl = $('leva'), pomello = levaEl.firstElementChild;
function mollaLeva() { leva.id = null; leva.x = 0; leva.y = 0; levaEl.hidden = true; }
function entra(si) {                                     // dentro la visita (mouse bloccato o comandi a tocco attivi) oppure fermi sulla guida
  bloccato = si;
  ingresso.hidden = si;
  document.body.classList.toggle('dentro', si);
  aiuto.classList.toggle('discreto', si);
  if (!si) { tasti.clear(); mollaLeva(); sguardo.id = null; }
}
ingresso.addEventListener('click', () => {
  if (!TOCCO) { tela.requestPointerLock(); return; }
  entra(true);                                           // sui telefoni: schermo intero e orizzontale, dove il browser lo permette
  try {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.then(() => screen.orientation?.lock?.('landscape')?.catch(() => {}), () => {});
  } catch { /* schermo intero non disponibile (iPhone): si resta nella pagina */ }
});
tela.addEventListener('click', () => { if (TOCCO) return; if (!bloccato) tela.requestPointerLock(); else usa(); });
document.addEventListener('pointerlockchange', () => { if (!TOCCO) entra(document.pointerLockElement === tela); });
tela.addEventListener('pointerdown', (e) => {
  if (!TOCCO || !bloccato || vista.abaco) return;
  e.preventDefault();
  if (leva.id === null && e.clientX < innerWidth * .42) {
    leva.id = e.pointerId; leva.x0 = e.clientX; leva.y0 = e.clientY;
    levaEl.style.left = `${e.clientX}px`; levaEl.style.top = `${e.clientY}px`; pomello.style.transform = ''; levaEl.hidden = false;
  } else if (sguardo.id === null) {
    Object.assign(sguardo, { id: e.pointerId, x: e.clientX, y: e.clientY, strada: 0, t: performance.now() });
  } else return;
  try { tela.setPointerCapture(e.pointerId); } catch { /* puntatore gia' rilasciato */ }
});
tela.addEventListener('pointermove', (e) => {
  if (e.pointerId === leva.id) {
    let dx = e.clientX - leva.x0, dy = e.clientY - leva.y0; const d = Math.hypot(dx, dy);
    if (d > R_LEVA) { dx *= R_LEVA / d; dy *= R_LEVA / d; }
    pomello.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(d, R_LEVA) / R_LEVA, k = m < .14 ? 0 : (m - .14) / .86 / m;   // zona morta al centro
    leva.x = dx / R_LEVA * k; leva.y = -dy / R_LEVA * k;
  } else if (e.pointerId === sguardo.id) {
    const dx = e.clientX - sguardo.x, dy = e.clientY - sguardo.y;
    sguardo.x = e.clientX; sguardo.y = e.clientY; sguardo.strada += Math.abs(dx) + Math.abs(dy);
    io.yaw -= dx * .0046;
    io.pitch = THREE.MathUtils.clamp(io.pitch - dy * .0046, -1.35, 1.35);
  }
});
function finePuntatore(e) {
  if (e.pointerId === leva.id) mollaLeva();
  else if (e.pointerId === sguardo.id) {
    sguardo.id = null;
    if (e.type === 'pointerup' && sguardo.strada < 12 && performance.now() - sguardo.t < 350) usa();
  }
}
tela.addEventListener('pointerup', finePuntatore);
tela.addEventListener('pointercancel', finePuntatore);
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

const asseY = new THREE.Vector3(0, 1, 0), asseX = new THREE.Vector3(1, 0, 0), giro = new THREE.Quaternion();
let zonaOra = null;
function aggiorna(dt, t) {
  const attivo = (bloccato || prova.attiva) && !vista.abaco;
  const av = attivo ? (+(tasti.has('KeyW') || tasti.has('ArrowUp')) - +(tasti.has('KeyS') || tasti.has('ArrowDown'))) + leva.y : 0;
  const la = attivo ? (+(tasti.has('KeyD') || tasti.has('ArrowRight')) - +(tasti.has('KeyA') || tasti.has('ArrowLeft'))) + leva.x : 0;
  // con i tasti la direzione e' normalizzata; con la leva la velocita' segue quanto la si spinge (a fondo corsa un passo svelto)
  const n = Math.max(Math.hypot(av, la), 1), vel = leva.id !== null ? 1.9 : tasti.has('ShiftLeft') || tasti.has('ShiftRight') ? CORRI : CAMMINA;
  const sy = Math.sin(io.yaw), cy = Math.cos(io.yaw);
  // in pianta Blender: avanti = (-sin yaw, cos yaw), destra = (cos yaw, sin yaw)
  const tx = ((-sy * av) + (cy * la)) / n * vel, ty = ((cy * av) + (sy * la)) / n * vel;
  const k = 1 - Math.exp(-dt * 9.);                      // accelerazione morbida, niente scatti
  io.vx += (tx - io.vx) * k; io.vy += (ty - io.vy) * k;
  const px = io.x, py = io.y;
  if (!mondo.muovi(io, io.vx * dt, io.vy * dt)) { io.vx = 0; io.vy = 0; }
  const fatto = Math.hypot(io.x - px, io.y - py), v_ = dt > 0 ? fatto / dt : 0;
  io.strada += fatto;
  io.amp += (Math.min(v_ / CAMMINA, 1.25) - io.amp) * (1 - Math.exp(-dt * 7.));
  const f = (io.strada / PASSO) * Math.PI;               // una oscillazione verticale a ogni passo
  const su = fermo ? 0 : Math.abs(Math.sin(f)) * 2 * BOB_SU * io.amp - BOB_SU * io.amp + Math.sin(t * 1.3) * .0025;
  const lato = fermo ? 0 : Math.sin(f) * BOB_LATO * io.amp;
  camera.position.set(io.x + cy * lato, OCCHI + su, -io.y - sy * lato);
  camera.rotation.set(io.pitch, io.yaw, 0);

  // porte: si aprono da sole quando ci si avvicina, dalla parte opposta a chi arriva
  mondo.aggiornaAnte(dt, io.x, io.y);
  for (const a of mondo.ante) {
    const nodo = nodiAnte.get(a.nome);
    if (nodo) nodo.o.quaternion.copy(giro.setFromAxisAngle(asseY, a.angolo)).multiply(nodo.base);
  }
  // opzione 3: i monitor salgono dal piano del tavolo
  if (stato.monitorSu) stato.monitorVisti = true;         // l'opzione compare sul tavolo la prima volta che la si usa, poi le cornici restano
  const tUno = MON.tSale + MON.tPiega + MON.tLuce, tTutti = tUno + MON.passo * Math.max(0, monitor.length - 1);
  stato.fMonitor = Math.min(1, Math.max(0, stato.fMonitor + (stato.monitorSu ? dt : -dt) / tTutti));
  const piega = cornici.length ? MON.piega : 0;            // asset vecchi (pannello gia' inclinato nella mesh): solo salita
  for (const c of cornici) c.visible = stato.monitorVisti;
  monitor.forEach((m, i) => {
    const t = stato.fMonitor * tTutti - i * MON.passo;
    const sale = liscio(t / MON.tSale), piegato = liscio((t - MON.tSale) / MON.tPiega), luce = liscio((t - MON.tSale - MON.tPiega) / MON.tLuce);
    m.o.visible = stato.monitorVisti;
    m.o.position.y = m.y - (1 - sale) * MON.corsa;
    m.o.quaternion.copy(m.q).multiply(giro.setFromAxisAngle(asseX, piega * (1 - piegato)));
    for (const k of m.schermi ?? []) { k.mat.emissiveIntensity = k.e * luce; k.mat.color.setScalar(luce); }
  });

  const z = ZONE[mondo.zonaDi(io.x, io.y)] ?? null;
  if (z !== zonaOra) { zonaOra = z; vistaT = -1; aggiornaVista(t); cambiaZona(); if (z?.stato === 'pronta') riprendi(io.x, io.y); }
  aggiornaVista(t);
}

// --- offerta interattiva: il mirino riconosce i prodotti, il tasto I apre l'abaco dell'ambiente ---------------
const PORTATA = 13;
const raggio = new THREE.Raycaster(), centro = new THREE.Vector2(0, 0), punto = new THREE.Vector3(), angolo = new THREE.Vector3();
const ui = Object.fromEntries(['mirino', 'cornice', 'scheda', 'richiamo', 'r-linea', 'r-punto', 'visti', 's-voce', 's-pezzi', 's-gruppo',
  's-modello', 's-ruolo', 's-dati', 's-nota', 's-usa', 's-usa-testo', 'elenco', 'a-voci', 'a-vista', 'a-trovati', 'nome-zona', 'tav', 'a-nome', 'a-vuoto', 'azioni', 'invito', 'invito-testo'].map((id) => [id, $(id)]));
const trovati = new Set();
let attuale = null, zonaPuntata = null;
const due = (n) => String(n).padStart(2, '0');
const pezzi = (p) => `× ${p.n}`;
const inVista = (p, z) => zoneProdotti.some((q) => q.p === p && q.zona === z);

// --- interazioni: E (o clic) sul prodotto puntato ------------------------------------------------------------
function vicino(box, filtro = () => true) {              // l'immagine piu' vicina al prodotto puntato
  const c = box.getCenter(new THREE.Vector3()); let meglio = null, d = 4;
  for (const k of contenuti) { if (!filtro(k)) continue; const dk = k.centro.distanceTo(c); if (dk < d) { d = dk; meglio = k; } }
  return meglio;
}
function bersaglio(q) {
  if (!q?.p.usa) return null;
  if (q.p.usa === 'monitor') return { testo: stato.monitorSu ? 'abbassa i monitor nel tavolo' : 'alza i monitor dal tavolo (opzione 3)', fai: () => { stato.monitorSu = !stato.monitorSu; } };
  const k = q.p.usa === 'proiettore' ? contenuti.find((c) => c.zona === q.zona.id && /telo/i.test(c.o.name + (c.o.parent?.name ?? ''))) ?? vicino(q.box, (c) => c.zona === q.zona.id) : vicino(q.box);
  if (!k) return null;
  const cosa = q.p.usa === 'proiettore' ? 'il proiettore' : 'lo schermo';
  return { testo: `${k.o.visible ? 'spegni' : 'accendi'} ${cosa}`, fai: () => { k.o.visible = !k.o.visible; } };
}
function usa() {
  if (vista.abaco) return;
  const b = bersaglio(zonaPuntata);
  if (b) { b.fai(); mostraUso(); azioni(); }
}
function mostraUso() {
  const b = bersaglio(zonaPuntata);
  ui['s-usa'].hidden = !b;
  if (b) ui['s-usa-testo'].textContent = b.testo;
  ui.invito.hidden = !b;                                 // invito accanto al mirino: si vede anche senza leggere la scheda
  if (b) ui['invito-testo'].textContent = b.testo;
}
addEventListener('keydown', (e) => {
  if (e.repeat || vista.abaco || !(bloccato || prova.attiva)) return;
  if (e.code === 'KeyE') usa();
  else if (e.code === 'KeyM') azioneMonitor();           // scorciatoie dell'ambiente, senza dover puntare
  else if (e.code === 'KeyP') azioneSchermo();
});
function azioneMonitor() { if (zonaOra?.id === 'cda' && monitor.length) { stato.monitorSu = !stato.monitorSu; azioni(); mostraUso(); } }
function azioneSchermo() { const k = contenuti.find((c) => c.zona === zonaOra?.id); if (k) { k.o.visible = !k.o.visible; azioni(); mostraUso(); } }
function azioni() {                                      // riga del cartiglio: cosa si puo' fare in questo ambiente
  const z = zonaOra, k = contenuti.find((c) => c.zona === z?.id), voci = [];
  if (z?.id === 'cda' && monitor.length) voci.push(['M', stato.monitorSu ? 'abbassa i monitor nel tavolo' : 'alza i monitor dal tavolo', azioneMonitor, stato.monitorSu ? 'Abbassa i monitor' : 'Alza i monitor']);
  if (k) { const cosa = z.id === 'formazione' ? 'il proiettore' : 'lo schermo', verbo = k.o.visible ? 'spegni' : 'accendi'; voci.push(['P', `${verbo} ${cosa}`, azioneSchermo, `${verbo[0].toUpperCase()}${verbo.slice(1)} ${cosa}`]); }
  const firma = voci.map((q) => q[3]).join('|');
  if (firma === azioni.firma) return;                      // niente da cambiare: i pulsanti non vanno ricreati sotto il dito
  azioni.firma = firma;
  ui.azioni.hidden = !voci.length;
  ui.azioni.replaceChildren(...voci.map(([t, testo]) => { const s_ = document.createElement('span'); s_.append(Object.assign(document.createElement('kbd'), { textContent: t }), testo); return s_; }));
  $('t-azioni').replaceChildren(...voci.map(([, , fai, breve]) => { const b = Object.assign(document.createElement('button'), { type: 'button', textContent: breve }); b.addEventListener('click', fai); return b; }));
}
$('t-inventario').addEventListener('click', () => apriAbaco(true));
$('a-chiudi').addEventListener('click', () => apriAbaco(false));
$('t-guida').addEventListener('click', () => entra(false));
if (TOCCO) for (const k of document.querySelectorAll('#invito kbd, #s-usa kbd')) k.textContent = 'Tocca';

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

// --- abaco dell'ambiente in cui ci si trova ------------------------------------------------------------------
const righe = new Map();                                 // prodotto -> riga dell'elenco
let scelto = null, ordine = [];
function costruisciAbaco() {
  const z = zonaOra, suoi = z ? PRODOTTI.filter((p) => p.sale.includes(z.id)) : [];
  const elementi = []; righe.clear(); scelto = null;
  for (const g of GRUPPI) {
    const del = suoi.filter((p) => p.gruppo === g);
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
      const segno = r.querySelector('.segno'), vista_ = inVista(p, z);
      segno.classList.add(vista_ ? 'vista' : 'nascosto');
      segno.title = vista_ ? 'In vista' : 'Non in vista';
      dati(r.querySelector('.dati'), p);
      r.querySelector('.nota').textContent = p.nota;
      r.addEventListener('pointerenter', () => { if (!bloccato) scegli(p, false); });
      r.addEventListener('click', () => scegli(p, false));
      righe.set(p, r); elementi.push(r);
    }
  }
  ordine = GRUPPI.flatMap((g) => suoi.filter((p) => p.gruppo === g));
  ui.elenco.replaceChildren(...elementi);
  ui['a-vuoto'].hidden = suoi.length > 0;
  ui['a-voci'].textContent = suoi.length;
  ui['a-vista'].textContent = suoi.filter((p) => inVista(p, z)).length;
  aggiornaTrovati();
}
function scegli(p, scorri = true) {
  if (!p || !righe.has(p)) return;
  if (scelto) righe.get(scelto)?.classList.remove('scelto');
  scelto = p;
  const r = righe.get(p);
  r.classList.add('scelto');
  if (scorri) r.scrollIntoView({ block: 'nearest', behavior: fermo ? 'auto' : 'smooth' });
}
function aggiornaTrovati() {
  const z = zonaOra, qui = z ? PRODOTTI.filter((p) => p.sale.includes(z.id) && inVista(p, z)) : [];
  const n = qui.filter((p) => trovati.has(`${z.id}/${p.voce}/${p.modello}`)).length;
  ui.visti.textContent = `${n}/${qui.length}`;
  ui['a-trovati'].textContent = n;
  for (const p of qui) if (trovati.has(`${z.id}/${p.voce}/${p.modello}`)) righe.get(p)?.querySelector('.segno').classList.add('trovato');
}
function cambiaZona() {
  const z = zonaOra;
  ui['nome-zona'].textContent = z?.nome ?? 'Sede';
  ui['a-nome'].textContent = z?.nome ?? 'Sede';
  ui.tav.textContent = `Tav. ${due((z?.i ?? 0) + 1)}`;
  document.title = z?.nome ?? 'Sede';
  costruisciAbaco(); azioni();
}
function apriAbaco(si) {
  vista.abaco = si;
  document.body.classList.toggle('abaco', si);
  if (si) { tasti.clear(); mollaLeva(); sguardo.id = null; costruisciAbaco(); scegli(attuale && righe.has(attuale) ? attuale : ordine[0]); }
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

// --- mirino, angoli, richiamo e scheda -----------------------------------------------------------
function punta() {
  camera.updateMatrixWorld();
  raggio.setFromCamera(centro, camera);
  let meglio = null, d = PORTATA;
  for (const q of zoneProdotti) {
    if (q.zona !== zonaOra || (q.p.quando === 'monitor' && stato.fMonitor < .6)) continue;   // si puntano solo i prodotti dell'ambiente in cui si e'
    if (!raggio.ray.intersectBox(q.box, punto)) continue;
    const dz = punto.distanceTo(camera.position);
    if (dz < d) { d = dz; meglio = q; }
  }
  const p = meglio?.p ?? null;
  zonaPuntata = meglio;
  if (!meglio) ui.invito.hidden = true;
  if (p !== attuale) {
    attuale = p;
    if (p) {
      scheda(p);
      const chiave = `${meglio.zona.id}/${p.voce}/${p.modello}`;
      if (!trovati.has(chiave)) { trovati.add(chiave); aggiornaTrovati(); }
    }
    for (const k of ['mirino', 'scheda', 'cornice', 'richiamo']) ui[k].classList.toggle('su', !!p);
  }
  if (!meglio) return;
  mostraUso();
  // angoli attorno al prodotto: proiezione degli 8 vertici della zona, con un po' d'aria
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const { min, max } = meglio.box;
  for (let i = 0; i < 8; i++) {
    angolo.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera);
    const sx = (angolo.x + 1) / 2 * innerWidth, sy = (1 - angolo.y) / 2 * innerHeight;
    l = Math.min(l, sx); r = Math.max(r, sx); t = Math.min(t, sy); b = Math.max(b, sy);
  }
  const aria = 8, minimo = 32, cx = (l + r) / 2, cy = (t + b) / 2;
  const w = Math.min(Math.max(r - l + aria * 2, minimo), innerWidth * .9), h = Math.min(Math.max(b - t + aria * 2, minimo), innerHeight * .9);
  const c = ui.cornice.style;
  c.width = `${w}px`; c.height = `${h}px`; c.transform = `translate(${cx - w / 2}px, ${cy - h / 2}px)`;
  if (TOCCO) return;
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

// --- contatore (tasto F, oppure ?fps nell'indirizzo): fotogrammi al secondo, fotogramma peggiore, triangoli e oggetti disegnati
const conta = { su: false, n: 0, t0: 0, peggio: 0, el: $('conta'), fps: $('c-fps'), ms: $('c-ms'), tri: $('c-tri'), gpu: $('c-gpu') };
renderer.info.autoReset = false;                         // il fotogramma passa da piu' riprese (scena, bloom): si azzera a mano per contarle tutte
{
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const nome = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti (0x...) Direct3D11 ...)" -> "GeForce RTX 3060 Ti"; SwiftShader = senza scheda video
  const breve = (/ANGLE \([^,]*,\s*([^,(]+)/.exec(nome)?.[1] ?? nome).replace(/^(NVIDIA|AMD|Intel\(R\))\s+/, '').trim();
  conta.gpu.textContent = /swiftshader|llvmpipe|basic render/i.test(nome) ? 'Senza scheda video (software)'
    : /ANGLE|NVIDIA|GeForce|AMD|Radeon|Intel|Apple|Adreno|Mali/i.test(nome) ? breve : 'Scheda video nascosta dal browser';
}
function mostraConta(si) {
  conta.su = si; conta.el.hidden = !si; conta.n = 0; conta.peggio = 0; conta.t0 = performance.now();
  try { localStorage.setItem('conta', si ? '1' : ''); } catch { /* navigazione privata */ }
}
function misura(ora, ms) {
  conta.n++; conta.peggio = Math.max(conta.peggio, ms);
  if (ora - conta.t0 < 500) return;
  const r = renderer.info.render;
  conta.fps.textContent = Math.round(conta.n * 1000 / (ora - conta.t0));
  conta.ms.textContent = `peggiore ${Math.round(conta.peggio)} ms`;
  const tri = r.triangles >= 1e6 ? `${(r.triangles / 1e6).toFixed(2).replace('.', ',')} M` : `${Math.round(r.triangles / 1000)} mila`;
  conta.tri.textContent = `${tri} triangoli · ${r.calls} disegni`;
  conta.n = 0; conta.peggio = 0; conta.t0 = ora;
}
addEventListener('keydown', (e) => { if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey) mostraConta(!conta.su); });
let contaSalvato = false; try { contaSalvato = !!localStorage.getItem('conta'); } catch { /* navigazione privata */ }
mostraConta(new URLSearchParams(location.search).has('fps') || contaSalvato);

let prima = performance.now();
renderer.setAnimationLoop((ora) => {
  const ms = Math.max(ora - prima, 0), dt = Math.min(ms / 1000, .05);
  prima = ora;
  renderer.info.reset();
  aggiorna(dt, ora / 1000);
  punta();
  composer.render();
  if (conta.su) misura(ora, ms);
});
setInterval(azioni, 1000);                              // la riga dei tasti segue quello che e' gia' stato caricato
window.__demo = { renderer, conta, TOCCO, leva, entra, io, tasti, prova, mondo, punta, usa, stato, zoneProdotti, contenuti, monitor, nodiAnte, ZONE, camera, scene, apriAbaco };
