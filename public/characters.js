import * as THREE from '/vendor/three.module.js';
import {createPlayerActor, PLAYER_MODEL_IDS, ORIGINAL_PLAYER_IDS} from './player-model.js';
import {GUNS} from './arsenal.js';

const $ = id => document.getElementById(id);
const customBases = ORIGINAL_PLAYER_IDS.slice(0, 4);
const params = new URLSearchParams(location.search);
const requested = params.get('model') || 'terror_trump';
const selected = PLAYER_MODEL_IDS.includes(requested) ? requested : 'terror_trump';
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
};
let renderer, actors = [], actorIds = [], selection = 0, stopped = false, raf = 0, error = null;
let cameraAngle = 0, distance = 1.85, portrait = true, rotate = false, paused = false, token = 0, restart = true;
let frames = 0, lastTime = performance.now(), lastDiagnostics = 0;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.02, 50);
const target = new THREE.Vector3(0, 1.35, 0);
Object.defineProperty(window, 'characterReview', {enumerable: true, configurable: false, get: () => immutable({
  schema: 'character-review-v1', model: $('model').value, comparison: $('compare').checked,
  independentOfWebSocket: true, error, frames, paused,
  camera: {angle: cameraAngle, distance, portrait, position: camera.position.toArray(), target: target.toArray()},
  actors: actors.map(actor => actor.info()),
  render: renderer ? {calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures} : null,
})});
for (const id of PLAYER_MODEL_IDS) {
  const option = document.createElement('option'); option.value = id;
  option.textContent = `${id} · ${id.endsWith('_trump') ? 'CUSTOM' : 'ORIGINAL'}`;
  $('model').append(option);
}
$('model').value = selected;
const weaponOptions=Object.entries(GUNS).map(([id,w])=>new Option(w.name,id));weaponOptions.push(new Option('刀（缺少p模型时明确提示）','knife'),new Option('不显示武器',''));$('weapon').replaceChildren(...weaponOptions);$('weapon').value='ak47';
$('compare').checked = params.get('compare') === '1';

function cameraUpdate() {
  const comparison = actors.length === 2;
  const crouched = $('action').value === 'crouch';
  target.set(0, portrait ? (crouched ? 0.75 : 1.35) : 0.88, 0);
  const radius = distance * (comparison ? 1.75 : 1);
  camera.position.set(Math.sin(cameraAngle) * radius, target.y + (portrait ? 0.08 : 0.2), -Math.cos(cameraAngle) * radius);
  camera.lookAt(target);
}
function refresh() {
  const infos = actors.map(actor => actor.info());
  const failed = infos.filter(i => i.error), loading = infos.some(i => i.loading);
  $('status').dataset.error = String(!!failed.length || !!error);
  $('status').textContent = error || (loading ? 'Loading source geometry & textures…'
    : failed.length ? `Asset unavailable · ${failed.map(i => i.id).join(', ')} · magenta wire fallback`
      : `${infos.length} loaded · layer 0 · depth test / write`);
  $('captions').replaceChildren(...infos.map(i => {
    const label = document.createElement('div'); label.className = `caption${i.error ? ' error' : ''}`;
    const name = document.createElement('strong'); name.textContent = i.id || 'Unselected';
    const source = document.createElement('small'); source.textContent = i.error || `${i.source}${i.customCosmetic ? ' · fictional cosmetic' : ''}`;
    label.append(name, source); return label;
  }));
  const primary = infos.find(i => i.id === $('model').value) || infos[0];
  if (!primary) return;
  $('animation-note').textContent = primary.animationWarning || `${primary.sequence || 'No sequence'} · frame ${primary.frame.toFixed(1)} · ${primary.blendSupport}`;
  $('weapon-note').textContent = primary.thirdPersonWeapon.status;
  $('diagnostics').textContent = infos.map(i => [
    i.id, `source: ${i.source}`, `MDL SHA256: ${i.sourceSHA256 || '—'}`,
    i.baseSourceSHA256 ? `base MDL SHA256: ${i.baseSourceSHA256}` : '',
    `JSON SHA256: ${i.convertedSHA256 || '—'}`, `JSON verified: ${i.convertedSHA256Verified}`,
    `sequence: ${i.sequence || '—'} / ${i.action}`, `blends: ${i.blendSupport}`,
    `weapon: ${i.thirdPersonWeapon.status}`, `basis: ${i.transform.goldSrcToWorld}`,
    `origin: ${i.transform.origin}`, i.error ? `ERROR: ${i.error}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}
async function loadSelection() {
  const ticket = ++selection, id = $('model').value, base = id.replace(/_trump$/, '');
  $('compare').disabled = !customBases.includes(base);
  if ($('compare').disabled) $('compare').checked = false;
  actorIds = $('compare').checked ? [base, `${base}_trump`] : [id];
  for (const actor of actors) actor.dispose();
  actors = actorIds.map(() => { const actor = createPlayerActor(THREE, {onChange: refresh}); scene.add(actor.group); return actor; });
  const url = new URL(location.href); url.searchParams.set('model', id);
  if ($('compare').checked) url.searchParams.set('compare', '1'); else url.searchParams.delete('compare');
  history.replaceState(null, '', url);
  $('sequence').replaceChildren(new Option('Automatic state selection', ''));
  restart = true; token++; cameraUpdate();
  await Promise.all(actors.map((actor, i) => actor.setCharacter(actorIds[i])));
  if (ticket !== selection || stopped) return;
  const primary = actors.find((a, i) => actorIds[i] === id) || actors[0];
  for (const sequence of primary.info().availableSequences.filter(s => s.imported)) {
    $('sequence').append(new Option(`${sequence.index}: ${sequence.name} · ${sequence.frames}f / ${sequence.blendCount} blend`, String(sequence.index)));
  }
  refresh();
}
function render(now) {
  if (stopped) return;
  const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
  if (rotate && !paused) cameraAngle += dt * 0.35;
  cameraUpdate();
  const action = $('action').value, exact = $('sequence').value === '' ? undefined : Number($('sequence').value);
  for (let i = 0; i < actors.length; i++) {
    const actor = actors[i];
    if (restart) actor.update(0, {animation: 'idle', animationToken: token - 1, playerSequence: exact, playerFrame: exact === undefined ? undefined : 0});
    actor.update(paused ? 0 : dt * Number($('speed').value), {
      x: actors.length === 2 ? (i === 0 ? 0.6 : -0.6) : 0, y: 0, z: 0, yaw: 0,
      pitch: Number($('pitch').value) * Math.PI / 180, crouch: action === 'crouch',
      alive: action !== 'death', grounded: action !== 'jump', weapon: $('weapon').value,
      animation: action, animationToken: token, playerSequence: exact,
    });
  }
  restart = false;
  renderer.render(scene, camera); frames++;
  if (now - lastDiagnostics > 350) { lastDiagnostics = now; refresh(); }
  raf = requestAnimationFrame(render);
}
function setFraming(value) {
  portrait = value; distance = value ? 1.85 : 3.65;
  $('portrait').setAttribute('aria-pressed', String(value)); $('full').setAttribute('aria-pressed', String(!value));
  cameraUpdate();
}
$('model').addEventListener('change', loadSelection);
$('compare').addEventListener('change', loadSelection);
$('front').addEventListener('click', () => { cameraAngle = 0; rotate = false; $('rotate').setAttribute('aria-pressed', 'false'); });
$('side').addEventListener('click', () => { cameraAngle = Math.PI / 2; rotate = false; $('rotate').setAttribute('aria-pressed', 'false'); });
$('rotate').addEventListener('click', () => { rotate = !rotate; $('rotate').setAttribute('aria-pressed', String(rotate)); });
$('portrait').addEventListener('click', () => setFraming(true));
$('full').addEventListener('click', () => setFraming(false));
$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? 'Play' : 'Pause'; $('pause').setAttribute('aria-pressed', String(paused)); });
$('restart').addEventListener('click', () => { token++; restart = true; });
$('action').addEventListener('change', () => { $('sequence').value = ''; token++; restart = true; });
$('sequence').addEventListener('change', () => { token++; restart = true; });
$('weapon').addEventListener('change', () => { token++; restart = true; });
const viewport = $('viewport');
let drag = null;
viewport.addEventListener('pointerdown', event => { drag = {x: event.clientX, angle: cameraAngle}; viewport.setPointerCapture(event.pointerId); });
viewport.addEventListener('pointermove', event => { if (drag) { cameraAngle = drag.angle + (event.clientX - drag.x) * 0.008; rotate = false; $('rotate').setAttribute('aria-pressed', 'false'); } });
viewport.addEventListener('pointerup', () => { drag = null; });
viewport.addEventListener('pointercancel', () => { drag = null; });
viewport.addEventListener('wheel', event => { event.preventDefault(); distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * 0.001), 0.75, 8); }, {passive: false});
let resize;
try {
  renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Original source character geometry'); viewport.append(renderer.domElement);
  const grid = new THREE.GridHelper(12, 24, 0x607347, 0x293b2e); grid.position.y = -0.025; scene.add(grid);
  resize = new ResizeObserver(() => { const {width, height} = viewport.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); });
  resize.observe(viewport);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); error = 'WebGL context lost. Reload this review page.'; stopped = true; refresh(); });
  loadSelection(); raf = requestAnimationFrame(render);
} catch (cause) { error = `Renderer unavailable: ${cause.message}`; refresh(); }
window.addEventListener('pagehide', () => {
  stopped = true; selection++; cancelAnimationFrame(raf); resize?.disconnect();
  for (const actor of actors) actor.dispose();
  scene.traverse(o => { if (o.isLineSegments) { o.geometry.dispose(); o.material.dispose(); } });
  renderer?.dispose();
}, {once: true});
