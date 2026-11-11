import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
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
renderer.toneMapping = THREE.NoToneMapping;           // tonemapper e colore li fa il passaggio "colore" in fondo (look.lut)
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
// vista come nei render di Blender: look.lut (genera_lut.py) e' la trasformazione OCIO di Blender, AgX + Medium High Contrast
// + esposizione 0.15, campionata in scala logaritmica. Si applica alla luce lineare HDR, prima di qualsiasi quantizzazione:
// niente AgX di base di three.js (piatto) ne' correzioni sopra l'immagine gia' a 8 bit. Il dither toglie le bande sulle pareti.
const EV0 = -10, EV1 = 10;                               // stessi valori di genera_lut.py
const colore = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, lut: { value: null }, esposizione: { value: 1 } },   // esposizione: manopola per tarare a occhio
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `precision highp sampler3D;
    uniform sampler2D tDiffuse; uniform sampler3D lut; uniform float esposizione; varying vec2 vUv;
    void main() {
      vec3 c = max(texture2D(tDiffuse, vUv).rgb * esposizione, vec3(1e-10));
      vec3 t = clamp((log2(c / .18) - float(${EV0})) / float(${EV1 - EV0}), 0., 1.);
      float n = float(textureSize(lut, 0).x);
      vec3 o = texture(lut, t * ((n - 1.) / n) + .5 / n).rgb;
      o += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - .5) / 255.;
      gl_FragColor = vec4(o, 1.);
    }`,
});
composer.addPass(colore);
{
  const r = await fetch('./look.lut');
  if (!r.ok) throw new Error('manca look.lut: lanciare genera_lut.py');
  const dati = new Uint16Array(await r.arrayBuffer()), n = Math.round(Math.cbrt(dati.length / 4));
  const t = new THREE.Data3DTexture(dati, n, n, n);
  t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  colore.uniforms.lut.value = t;
}
// texture nitide anche viste di taglio (pavimento, piani dei tavoli): filtro anisotropico al massimo della scheda, piu' basso sui telefoni
const ANISO = Math.min(renderer.capabilities.getMaxAnisotropy(), TOCCO ? 4 : 16);
function nitida(m) { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) m[k].anisotropy = ANISO; }

const $ = (id) => document.getElementById(id);
const barra = document.querySelector('#barra i');
const manager = new THREE.LoadingManager();
manager.onProgress = (_, n, tot) => { barra.style.width = `${(n / tot) * 100}%`; };
// texture KTX2 (se gli asset sono stati preparati cosi'): restano compresse anche nella scheda video, circa un quinto della memoria. Gli asset WebP si caricano come prima
const ktx2 = new KTX2Loader().setTranscoderPath(BASIS).detectSupport(renderer);
{ // three.js da' per scontato l'ASTC HDR appena c'e' l'estensione ASTC, ma molti iPhone hanno solo il profilo "ldr": le mappe
  // HDR verrebbero nere. Si guarda il profilo vero; senza HDR il transcoder ripiega su half float (o sulle mappe RGBM, vedi sotto)
  const astc = renderer.getContext().getExtension('WEBGL_compressed_texture_astc');
  if (astc && !astc.getSupportedProfiles?.().includes('hdr')) ktx2.workerConfig.astcHDRSupported = false;
}
// Texture condivise tra le zone (texture_condivise.mjs): intonaco, rovere, gres... sono gli stessi file in assets/comune/.
// Un plugin del GLTFLoader, messo davanti a quelli di serie, restituisce a ogni zona la stessa texture: si scarica,
// si decodifica e sta nella scheda video una volta sola (175 texture nelle 9 zone, 38 diverse). Qualita' identica.
const texCondivise = new Map();
class TextureCondivise {
  constructor(parser) { this.parser = parser; this.name = 'texture_condivise'; }
  loadTexture(i) {
    const p = this.parser, j = p.json, def = j.textures[i];
    const src = def.extensions?.KHR_texture_basisu?.source ?? def.source, uri = j.images?.[src]?.uri;
    if (typeof uri !== 'string' || !uri.includes('comune/') || !uri.endsWith('.ktx2')) return null;   // il resto come di serie
    const s = j.samplers?.[def.sampler] ?? {};
    const chiave = `${uri.split('/').pop()}|${s.wrapS}|${s.wrapT}|${s.magFilter}|${s.minFilter}`;
    if (!texCondivise.has(chiave)) texCondivise.set(chiave, p.loadTextureImage(i, src, p.options.ktx2Loader));
    return texCondivise.get(chiave);
  }
}
const caricatori = (m) => {
  const gltf = new GLTFLoader(m).setDRACOLoader(new DRACOLoader(m).setDecoderPath(DRACO)).setKTX2Loader(ktx2);
  gltf.pluginCallbacks.unshift((parser) => new TextureCondivise(parser));
  return { gltf, exr: new EXRLoader(m).setDataType(THREE.HalfFloatType) };
};
const primi = caricatori(manager), dopo = caricatori(undefined);

// versione leggera (<nome>_m.<est>): sui telefoni sempre, sul desktop per la prima stanza (partenza progressiva); se manca, quella piena
async function leggi(caricatore, base, nome, est, leggera = TOCCO) {
  if (leggera) { try { return await caricatore.loadAsync(`${base}${nome}_m.${est}`); } catch { /* niente versione leggera */ } }
  return caricatore.loadAsync(`${base}${nome}.${est}`);
}
// Mappe di luce (demo_prepara.py): KTX2 compresso anche nella scheda video. Desktop: HDR (BC6H, 1 byte/pixel invece degli
// 8 dell'EXR). Telefoni: _m a meta' risoluzione in RGBM (8 bit + moltiplicatore, compresso su qualsiasi GPU mobile).
// Se manca il KTX2 (asset vecchi) si ripiega sull'EXR.
async function leggiLuce(c, base, nome, leggera = TOCCO) {
  const prova = leggera ? [[`${nome}_m.ktx2`, true], [`${nome}.ktx2`, false]] : [[`${nome}.ktx2`, false]];
  for (const [file, rgbm] of prova) {
    try { const t = await ktx2.loadAsync(base + file); t.userData.rgbm = rgbm; return t; } catch { /* prossimo formato */ }
  }
  return leggi(c.exr, base, nome, 'exr', leggera);
}
function mappaLuce(tex) {
  tex.channel = 1; tex.colorSpace = THREE.NoColorSpace; tex.magFilter = THREE.LinearFilter;
  if (tex.isCompressedTexture) {                       // KTX2: mipmap gia' nel file, righe gia' dal basso (non si capovolge)
    tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = tex.mipmaps?.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  } else {
    tex.flipY = true; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.anisotropy = Math.min(ANISO, 8); tex.needsUpdate = true;
  return tex;
}
function gruppoBake(o) {
  for (let p = o; p; p = p.parent) {
    if (p.name.startsWith('BAKE_statico')) return 'statico';
    if (p.name.startsWith('BAKE_sedie')) return 'sedie';
    if (p.name.startsWith('BAKE_esterno')) return 'esterno';   // facciate del piano terra e parapetto (scena_demo.py)
  }
  return null;
}

const cotti = [], liberi = [];
// Vetro delle finestre come un vetro vero: quello che c'e' dietro si moltiplica per la trasmissione della lastra e sopra si
// somma solo il riflesso (Fresnel, dall'envMap). In Blender il Vetro ha tinta (.95,.98,.97): due facce, ~4% riflesso ciascuna
// -> ~(.83,.88,.87). Il velo bianco di prima faceva l'opposto: schiariva e sbiadiva il fuori.
const vetro = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: .04, metalness: 0, transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.ConstantColorFactor });
vetro.blendColor.setRGB(.83, .88, .87);
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
// fughe di piastrelle e pannelli (fughe.json, scritto da fughe_demo.py). In Blender sono un nodo Brick procedurale che il glTF
// non porta, e con lui si perde anche la tinta (il gres usciva troppo chiaro). Si disegnano nello shader: nitide da vicino,
// da lontano sfumano nel loro valore medio invece di sfarfallare.
const FUGHE = await fetch('./fughe.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const GLSL_FUGHE = /* glsl */`
uniform vec3 fC1, fC2, fMalta; uniform vec4 fMisure;          // larghezza e altezza del pannello, meta' fuga, scala (metri)
varying vec2 vUvFughe;
float fHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
vec3 fughe() {
  vec2 p = vec2(vUvFughe.x, 1. - vUvFughe.y) * fMisure.w;     // UV di Blender (il glTF capovolge v)
  vec2 cella = floor(p / fMisure.xy), f = p - cella * fMisure.xy;
  float d = min(min(f.x, fMisure.x - f.x), min(f.y, fMisure.y - f.y));   // distanza dal bordo del pannello
  float aa = max(length(fwidth(p)), 1e-6);
  float malta = 1. - smoothstep(fMisure.z - aa * .5, fMisure.z + aa * .5, d);
  float media = clamp(2. * fMisure.z / fMisure.x + 2. * fMisure.z / fMisure.y, 0., 1.);
  malta = mix(malta, media, smoothstep(fMisure.z, fMisure.z * 6., aa));
  return mix(mix(fC1, fC2, fHash(cella)), fMalta, malta);     // tono variabile per pannello, come il Brick di Blender
}`;
const PBR_COTTO = THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;', 'vec3 indirectDiffuse = vec3( 0.0 );');
if (PBR_COTTO === THREE.ShaderChunk.lights_physical_pars_fragment) console.warn('three cambiato: la diffusa dell\'envMap si somma di nuovo alla mappa di luce');
// grana dell'asfalto del piazzale (scena_demo.py): un velo di rumore, non una texture. Grani da ~2.5 cm che spariscono quando
// diventano piu' piccoli di un pixel (niente sfarfallio da lontano) e macchie larghe un paio di metri, come l'usura vera.
const GRANA = new Set(['Piazzale asfalto']);
const GLSL_GRANA = /* glsl */`
varying vec2 vUvGrana;                                       // UV della facciata/terreno in metri (scena_demo.py)
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}
float grana() {
  vec2 p = vUvGrana;
  float aa = length(fwidth(p));
  float fine = (gNoise(p * 40.) - .5) * (1. - smoothstep(.012, .05, aa));
  float macchie = (gNoise(p * .6) - .5) + .5 * (gNoise(p * 2.3) - .5);
  return 1. + fine * .22 + macchie * .12;
}`;
// mappe per telefoni in RGBM (demo_prepara.py, RGBM_MAX = 16): luce = rgb^2 * a^2 * 16
const MAPPE_RGBM = THREE.ShaderChunk.lights_fragment_maps.replace('vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
  'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapTexel.rgb * ( lightMapTexel.a * lightMapTexel.a * 16.0 ) * lightMapIntensity;');
if (MAPPE_RGBM === THREE.ShaderChunk.lights_fragment_maps) console.warn('three cambiato: le mappe RGBM dei telefoni non si decodificano');
function preparaCotto(m) {
  const nome = m.name.replace(/\.\d+$/, '');
  const f = FUGHE[nome], g = GRANA.has(nome), rgbm = !!m.lightMap?.userData.rgbm;
  if (f && !m.userData.tintato) { m.color.multiply(new THREE.Color().setRGB(...f.tinta, THREE.LinearSRGBColorSpace)); m.userData.tintato = true; }   // una volta sola (anche se si richiama dopo la partenza progressiva)
  m.customProgramCacheKey = () => `cotto${f ? '-fughe' : g ? '-grana' : ''}${rgbm ? '-rgbm' : ''}`;
  m.onBeforeCompile = (sh) => {
    // La mappa di luce ha gia' tutta la luce diffusa (diretta e rimbalzi): dall'envMap si prendono solo i riflessi.
    // three r184 somma l'irradianza dell'envMap anche come diffusa (un riempimento piatto che schiarisce le ombre): quel
    // termine si toglie. L'irradianza resta per sheen dei tessuti e multiscattering, ma presa dalla mappa di luce (la luce
    // vera del punto) invece che dal cubemap: senza, il divano perdeva lo sheen e usciva piu' scuro e saturo che in Blender.
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', PBR_COTTO)
      .replace('#include <lights_fragment_maps>', `${rgbm ? MAPPE_RGBM : '#include <lights_fragment_maps>'}\n\tiblIrradiance = irradiance;`);
    if (g) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUvGrana;').replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvUvGrana = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_GRANA}`).replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= grana();');
    }
    if (!f) return;
    const c = (v) => ({ value: new THREE.Vector3(...v) });
    Object.assign(sh.uniforms, { fC1: c(f.c1), fC2: c(f.c2), fMalta: c(f.malta), fMisure: { value: new THREE.Vector4(f.larghezza, f.altezza, f.spessore, f.scala) } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUvFughe;').replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvUvFughe = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_FUGHE}`).replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= fughe();');
  };
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

async function caricaZona(z, c, leggera = TOCCO) {
  z.stato = 'carico'; z.leggera = leggera;
  const base = `./assets/${z.id}/`;
  const [modello, lmS, lmC, lmE] = await Promise.all([
    leggi(c.gltf, base, z.id, 'gltf', leggera).catch(() => leggi(c.gltf, base, z.id, 'glb', leggera)), leggiLuce(c, base, 'lm_statico', leggera),   // .gltf con texture in comune/; .glb = asset vecchi
    z.info.mappe.BAKE_sedie ? leggiLuce(c, base, 'lm_sedie', leggera) : null,
    z.info.mappe.BAKE_esterno ? leggiLuce(c, base, 'lm_esterno', leggera) : null,
  ]);
  z.modello = modello.scene;
  mappaLuce(lmS); if (lmC) mappaLuce(lmC); if (lmE) mappaLuce(lmE);
  const mappe = { statico: lmS, sedie: lmC, esterno: lmE };
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
      m.lightMap = mappe[g];
      m.lightMapIntensity = Math.PI;                     // Cycles salva E/pi, Three.js vuole l'irradianza
      preparaCotto(m);
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

// --- partenza progressiva (desktop): la prima stanza arriva in versione leggera (~8 MB invece di ~30), poi in sottofondo si
// scarica quella piena e si sostituiscono texture e mappe di luce sugli stessi oggetti. Le due versioni nascono dallo stesso
// bake: stessi oggetti nello stesso ordine, cambia solo la risoluzione. Porte, monitor, prodotti puntabili restano intatti.
const SLOT = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'sheenColorMap', 'sheenRoughnessMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'specularColorMap', 'specularIntensityMap', 'transmissionMap'];
async function affina(z, c) {
  const base = `./assets/${z.id}/`;
  const [modello, lmS, lmC, lmE] = await Promise.all([
    leggi(c.gltf, base, z.id, 'gltf', false), leggiLuce(c, base, 'lm_statico', false),
    z.info.mappe.BAKE_sedie ? leggiLuce(c, base, 'lm_sedie', false) : null,
    z.info.mappe.BAKE_esterno ? leggiLuce(c, base, 'lm_esterno', false) : null,
  ]);
  const vive = [], nuove = [];
  z.modello.traverse((o) => { if (o.isMesh) vive.push(o); });
  modello.scene.traverse((o) => { if (o.isMesh) nuove.push(o); });
  if (vive.length !== nuove.length) { console.warn('versione piena diversa dalla leggera, resta la leggera', z.id); return; }
  mappaLuce(lmS); if (lmC) mappaLuce(lmC); if (lmE) mappaLuce(lmE);
  const mappe = { statico: lmS, sedie: lmC, esterno: lmE }, vecchie = new Set();
  vive.forEach((a, i) => {
    const ma = a.material, mb = nuove[i].material;
    for (const k of SLOT) if (ma[k] && mb[k] && ma[k] !== mb[k]) { vecchie.add(ma[k]); ma[k] = mb[k]; }
    nitida(ma);
    const g = gruppoBake(a);
    if (g && ma.lightMap && mappe[g] && ma.lightMap !== mappe[g]) { vecchie.add(ma.lightMap); ma.lightMap = mappe[g]; preparaCotto(ma); ma.needsUpdate = true; }
  });
  for (const t of vecchie) t.dispose();                  // le texture leggere non le usa piu' nessuno: via dalla memoria video
  for (const k of [...texCondivise.keys()]) if (k.includes('_m.ktx2')) texCondivise.delete(k);
  z.leggera = false;
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
// Cambio di stanza: i riflessi passano in dissolvenza invece che di colpo. Le mappe PMREM hanno sempre la stessa forma
// (stesso cubo di partenza), quindi si mescolano con un solo passaggio a schermo intero. Tre buffer: 'corrente' e' quello che
// i materiali usano (collegato una volta sola: niente piu' ricompilazione degli shader a ogni stanza), 'partenza' e' la
// fotografia di quello che si vedeva al momento del cambio (anche a meta' di un'altra dissolvenza), 'arrivo' la nuova ripresa.
const SFUMA_S = .8;
const misto = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { a: { value: null }, b: { value: null }, t: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: 'uniform sampler2D a, b; uniform float t; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(a, vUv), texture2D(b, vUv), t); }',
  depthTest: false, depthWrite: false,
}));
const rif = { corrente: null, partenza: null, arrivo: null, t: 1 };
let riflessi = null;                                     // = rif.corrente.texture, l'envMap di tutti i materiali
function mescola(a, b, t, dove) {
  const u = misto.material.uniforms; u.a.value = a.texture; u.b.value = b.texture; u.t.value = t;
  const prima = renderer.getRenderTarget(); renderer.setRenderTarget(dove); misto.render(renderer); renderer.setRenderTarget(prima);
}
function nuovoBuffer(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false });
  rt.texture.mapping = THREE.CubeUVReflectionMapping; rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return rt;
}
function riprendi(x, y) {
  for (const m of monitor) m.o.visible = false;
  cuboCam.position.copy(v(x, y, 1.6)); cuboCam.update(renderer, scene);
  const nuovo = pmrem.fromCubemap(cubo.texture);
  if (!rif.corrente) {
    rif.corrente = nuovoBuffer(nuovo.width, nuovo.height); rif.partenza = nuovoBuffer(nuovo.width, nuovo.height);
    riflessi = rif.corrente.texture; rif.arrivo = nuovo; mescola(nuovo, nuovo, 1, rif.corrente); rif.t = 1;
  } else {
    mescola(rif.corrente, rif.corrente, 0, rif.partenza);   // si parte da quello che si vede adesso
    rif.arrivo?.dispose(); rif.arrivo = nuovo; rif.t = 0;
  }
  const collega = (m, k) => { if (m.envMap !== riflessi) { m.envMap = riflessi; m.envMapIntensity = k; m.needsUpdate = true; } };
  for (const m of cotti) collega(m, 1.);
  for (const m of liberi) collega(m, 1.1);
  for (const m of [vetro, satinato, ...vetriCotti.values()]) collega(m, 1.);
}
function aggiornaRiflessi(dt) {
  if (rif.t >= 1 || !rif.arrivo) return;
  rif.t = Math.min(1, rif.t + dt / SFUMA_S);
  mescola(rif.partenza, rif.arrivo, liscio(rif.t), rif.corrente);
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
  caricaZona(prima_zona, primi, true),                   // versione leggera: si entra prima (sul desktop poi si affina)
  leggi(primi.exr, './assets/cda/', 'esterno', 'exr').catch(() => null),
]);
if (esterno) {
  // Esterno a fasce di distanza. Il panorama (demo_prepara.py) e' ripreso dal centro della sala CdA, 1.5 m sopra il pavimento;
  // il terreno e' 3.6 m sotto il pavimento (siamo al primo piano). Uno sfondo all'infinito metteva prato e strada "all'orizzonte"
  // sotto le finestre: guardando giu' l'edificio sembrava sospeso. GroundedSkybox proietta la parte bassa del panorama su un
  // piano alla quota vera del terreno, quindi prato e strada hanno la prospettiva giusta mentre si cammina. Lontano: foschia
  // che cresce con la distanza, perche' il fuori resti uno sfondo e non distragga dall'interno.
  const zc = ZONE.find((z) => z.id === 'cda')?.info?.zona ?? [13.86, 29.27, -.56, 7.18];
  const PANO = { x: (zc[0] + zc[1]) / 2, y: (zc[2] + zc[3]) / 2, z: 1.5 }, TERRA = -3.6;   // come demo_prepara.py e costruisci_blender.py
  esterno.colorSpace = THREE.LinearSRGBColorSpace;
  const cielo = new GroundedSkybox(esterno, PANO.z - TERRA, 1500, 96);   // raggio: piu' grande = terreno piatto piu' lontano (strade dritte); deve restare sotto il far della camera (2000)
  cielo.position.copy(v(PANO.x, PANO.y, PANO.z)); cielo.rotation.y = Math.PI / 2;   // stesso orientamento del vecchio sfondo
  // misurato contro il render Cycles dalla stessa camera (cielo e prato): 1.15. Il vecchio 2.2 era tarato sulla catena
  // colore precedente (AgX di three.js + LUT a 8 bit) e con quella attuale rendeva le finestre slavate.
  cielo.material.color.setScalar(1.15);
  cielo.material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMondo;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvMondo = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMondo;')
      .replace('#include <opaque_fragment>', `
      float dist = distance(vMondo, cameraPosition);
      float velo = (1. - exp(-dist / 450.)) * .16;        // foschia: quasi nulla sotto le finestre, ~15% all'orizzonte
      float l = dot(outgoingLight, vec3(.2126, .7152, .0722));
      outgoingLight = mix(outgoingLight, vec3(l * 1.05) * vec3(.94, .97, 1.), velo);
      #include <opaque_fragment>`);
  };
  cielo.renderOrder = -1; cielo.frustumCulled = false;
  scene.add(cielo);
} else scene.background = new THREE.Color(.75, .82, .9);
riprendi(io.x, io.y);

const distZona = (z) => Math.hypot(Math.max(z.r[0] - io.x, 0, io.x - z.r[1]), Math.max(z.r[2] - io.y, 0, io.y - z.r[3]));
(async () => {
  const caricoEl = $('carico');
  if (!TOCCO && prima_zona.leggera) {                    // prima di tutto la piena qualita' della stanza in cui si e'
    caricoEl.textContent = `Dettagli: ${prima_zona.nome}`; caricoEl.hidden = false;
    try { await affina(prima_zona, dopo); riprendi(io.x, io.y); } catch (e) { console.warn('versione piena non caricata', prima_zona.id, e); }
  }
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

// ingresso: la scena emerge dal buio mentre lo schermo di caricamento si dissolve (CSS, 1.2 s), come luci che si accendono
const avvio = { t: fermo ? 1 : 0, durata: 1.6 };
colore.uniforms.esposizione.value = fermo ? 1 : .04;
document.querySelector('#carica').classList.add('via');
ingresso.hidden = false;
if (!TOCCO) $('entra-pieno').focus({ preventScroll: true });   // Invio = entra a schermo intero

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
  if (!si) { tasti.clear(); mollaLeva(); sguardo.id = null; if (!TOCCO) $('entra-pieno').focus({ preventScroll: true }); }
}
// desktop: schermo intero suggerito (pulsante principale) o in finestra; mouse catturato con lo stesso clic.
// Esc esce da entrambi e la scheda ricompare.
function entraDesktop(pieno) {
  if (pieno && !document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
  tela.requestPointerLock();
}
$('entra-pieno').addEventListener('click', (e) => { e.stopPropagation(); entraDesktop(true); });
$('entra-finestra').addEventListener('click', (e) => { e.stopPropagation(); entraDesktop(false); });
ingresso.addEventListener('click', () => {
  if (!TOCCO) return;
  entra(true);                                           // sui telefoni: schermo intero e orizzontale, dove il browser lo permette
  try {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.then(() => screen.orientation?.lock?.('landscape')?.catch(() => {}), () => {});
  } catch { /* schermo intero non disponibile (iPhone): si resta nella pagina */ }
});
tela.addEventListener('click', () => {
  if (TOCCO) return;
  if (vista.abaco) apriAbaco(false);                    // clic fuori dal pannello: si chiude l'inventario e si riprende il mouse
  else if (document.pointerLockElement !== tela) tela.requestPointerLock();
  else usa();
});
// mouse rilasciato: si esce dalla visita (torna la scheda), tranne quando lo libera l'inventario
document.addEventListener('pointerlockchange', () => {
  if (TOCCO) return;
  if (document.pointerLockElement === tela) entra(true); else if (!vista.abaco) entra(false);
});
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
  if (!bloccato || vista.abaco) return;                  // inventario aperto: la visuale resta ferma
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;   // scarta i salti del puntatore
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
// Desktop: con l'inventario aperto il mouse si libera (si cliccano e si scorrono le voci) e la visita resta ferma; chiudendo
// (I o clic fuori dal pannello, gesti validi per il browser) il mouse si riprende. riprendi=false: Esc, si torna alla scheda.
function apriAbaco(si, riprendi = true) {
  if (si === vista.abaco) return;
  vista.abaco = si;
  document.body.classList.toggle('abaco', si);
  if (si) { tasti.clear(); mollaLeva(); sguardo.id = null; io.vx = 0; io.vy = 0; costruisciAbaco(); scegli(attuale && righe.has(attuale) ? attuale : ordine[0]); }   // niente scivolata residua
  if (TOCCO) return;
  if (si && document.pointerLockElement === tela) document.exitPointerLock();
  else if (!si && riprendi && bloccato) tela.requestPointerLock()?.catch?.(() => {});   // se il browser rifiuta, basta un clic sulla scena
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
  else if (e.code === 'Escape') { apriAbaco(false, false); if (!TOCCO) entra(false); }
}, { capture: true });
addEventListener('wheel', (e) => { if (vista.abaco && document.pointerLockElement) sposta(Math.sign(e.deltaY)); }, { passive: true });   // a mouse libero la rotella scorre l'elenco come di solito

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

// --- disegno su richiesta: da fermi la scena non si ridisegna 60 volte al secondo (batteria e calore sui telefoni). Si disegna
// se la camera si sposta (>1 mm) o ruota, se c'e' un'animazione (porte, monitor, riflessi, ingresso), nei 2 s dopo un input o
// dopo il caricamento di una zona; altrimenti 2 fotogrammi al secondo, che bastano a non perdere nulla.
const ridisegno = { finoA: 0, ultimo: 0, firma: '' };
const sveglia = () => { ridisegno.finoA = performance.now() + 2000; };
for (const ev of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'resize']) addEventListener(ev, sveglia, { passive: true });
function firmaScena() {                                 // posizione e sguardo di chi visita, non la camera: il "respiro" da fermi non conta
  let ante = 0; for (const a of mondo.ante) ante += a.angolo ?? 0;
  return [io.x, io.y].map((x) => Math.round(x * 1000)).join() + '|' + [io.pitch, io.yaw].map((x) => Math.round(x * 1e4)).join() + '|' + Math.round(io.amp * 100)
    + '|' + Math.round(ante * 1e3) + '|' + Math.round(stato.fMonitor * 1e3) + '|' + mondo.pronte.size + '|' + (attuale?.voce ?? '');
}
// --- risoluzione adattiva: se il dispositivo non regge (sotto ~45 fps per 2 s) si scende di un gradino, con margine si risale
const RIS_MAX = renderer.getPixelRatio(), RIS_MIN = Math.max(.6, RIS_MAX * .55);
const adatta = { t: 0, n: 0, somma: 0, buoni: 0 };
function adattaRisoluzione(ms) {
  if (ms > 250) return;                                  // scheda in secondo piano o caricamento: non conta
  adatta.n++; adatta.somma += ms; adatta.t += ms;
  if (adatta.t < 2000) return;
  const medio = adatta.somma / adatta.n, ora = renderer.getPixelRatio();
  let nuova = ora;
  if (medio > 22 && ora > RIS_MIN) { nuova = Math.max(RIS_MIN, ora - .15); adatta.buoni = 0; }
  else if (medio < 15) { if (++adatta.buoni >= 3 && ora < RIS_MAX) { nuova = Math.min(RIS_MAX, ora + .1); adatta.buoni = 0; } }
  else adatta.buoni = 0;
  if (nuova !== ora) { renderer.setPixelRatio(nuova); composer.setPixelRatio(nuova); composer.setSize(innerWidth, innerHeight); }
  adatta.t = 0; adatta.n = 0; adatta.somma = 0;
}

let prima = performance.now();
renderer.setAnimationLoop((ora) => {
  const ms = Math.max(ora - prima, 0), dt = Math.min(ms / 1000, .05);
  prima = ora;
  aggiorna(dt, ora / 1000);
  punta();
  const animazioni = rif.t < 1 || avvio.t < 1 || (stato.fMonitor > 0 && stato.fMonitor < 1);
  aggiornaRiflessi(dt);
  if (avvio.t < 1) {                                    // esposizione da quasi nero a 1, curva morbida all'arrivo
    avvio.t = Math.min(1, avvio.t + dt / avvio.durata);
    colore.uniforms.esposizione.value = .04 + .96 * (1 - (1 - avvio.t) ** 3);
  }
  const firma = firmaScena();
  const serve = animazioni || ora < ridisegno.finoA || firma !== ridisegno.firma || ora - ridisegno.ultimo > 500 || conta.su;
  if (!serve) return;
  if (firma !== ridisegno.firma) sveglia();
  ridisegno.firma = firma;
  renderer.info.reset();
  composer.render();
  if (ora - ridisegno.ultimo < 100) adattaRisoluzione(ora - ridisegno.ultimo);   // solo fotogrammi consecutivi
  ridisegno.ultimo = ora;
  if (conta.su) misura(ora, ms);
});
setInterval(azioni, 1000);                              // la riga dei tasti segue quello che e' gia' stato caricato
window.__demo = { ridisegno, renderer, conta, TOCCO, leva, entra, io, tasti, prova, mondo, punta, usa, stato, zoneProdotti, contenuti, monitor, nodiAnte, ZONE, camera, scene, apriAbaco };
