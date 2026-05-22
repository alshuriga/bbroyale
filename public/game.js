const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('playBtn');
const nameInput = document.getElementById('nameInput');
const roomCodeEl = document.getElementById('roomCode');
const weaponEl = document.getElementById('weapon');
const healthEl = document.getElementById('health');
const dashStatusEl = document.getElementById('dashStatus');
const scoreboardEl = document.getElementById('scoreboard');
const killfeedEl = document.getElementById('killfeed');
const mobileControlsEl = document.getElementById('mobileControls');
const joystickBaseEl = document.getElementById('joystickBase');
const joystickKnobEl = document.getElementById('joystickKnob');
const fireBtnEl = document.getElementById('fireBtn');
const dashBtnEl = document.getElementById('dashBtn');

const state = {
  ws: null,
  roomId: '',
  myId: '',
  players: [],
  bullets: [],
  pickups: [],
  zone: null,
  serverNow: Date.now(),
  killFeed: [],
  rules: null,
  map: null,
  input: { up: false, down: false, left: false, right: false, firing: false, moveToAim: false, dash: false, aimAngle: 0 },
  camX: 0,
  camY: 0,
  renderPlayers: new Map(),
  renderBullets: new Map(),
  localBullets: [],
  lastRenderAt: performance.now(),
  lastInputSentAt: 0,
  lastMouseSentAt: 0,
  lastInputSignature: '',
  nextLocalShotAt: 0,
  mobile: {
    active: false,
    inited: false,
    stickTouchId: null,
    fireTouchId: null,
    baseCenterX: 0,
    baseCenterY: 0,
    radius: 45,
    dirX: 0,
    dirY: 0,
  },
};

const PLAYER_RADIUS = 14;
const PLAYER_LERP = 0.55;
const LOCAL_PLAYER_LERP = 0.85;
const BULLET_LERP = 0.72;
const INPUT_SEND_MS = 16;
const MOUSE_SEND_MS = 16;
const CORRECTION_LERP = 0.28;

const assets = {
  player: new Image(),
  playerReady: false,
};
assets.player.src = '/assets/player_character_base.png';
assets.player.onload = () => {
  assets.playerReady = true;
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (state.mobile.inited && joystickBaseEl) {
    const rect = joystickBaseEl.getBoundingClientRect();
    state.mobile.baseCenterX = rect.left + rect.width / 2;
    state.mobile.baseCenterY = rect.top + rect.height / 2;
    state.mobile.radius = rect.width * 0.32;
  }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
resize();

function send(type, payload) {
  if (!state.ws || !state.ws.connected) return;
  state.ws.emit('client_message', { type, payload });
}

function disconnectSession() {
  if (!state.ws) return;
  try {
    state.ws.disconnect();
  } catch {}
}

function applyStickToInput(dirX, dirY) {
  const deadZone = 0.18;
  state.mobile.dirX = dirX;
  state.mobile.dirY = dirY;
  state.input.left = dirX < -deadZone;
  state.input.right = dirX > deadZone;
  state.input.up = dirY < -deadZone;
  state.input.down = dirY > deadZone;
  const len = Math.hypot(dirX, dirY);
  state.input.moveToAim = len > deadZone;
  if (len > deadZone) {
    state.input.aimAngle = Math.atan2(dirY, dirX);
  }
}

function resetStickVisual() {
  if (!joystickKnobEl) return;
  joystickKnobEl.style.transform = 'translate(0px, 0px)';
}

function updateStickFromTouch(touch) {
  const m = state.mobile;
  const dx = touch.clientX - m.baseCenterX;
  const dy = touch.clientY - m.baseCenterY;
  const len = Math.hypot(dx, dy);
  const maxLen = m.radius;
  const clampedLen = Math.min(len, maxLen);
  const nx = len > 0 ? dx / len : 0;
  const ny = len > 0 ? dy / len : 0;
  const tx = nx * clampedLen;
  const ty = ny * clampedLen;
  if (joystickKnobEl) joystickKnobEl.style.transform = `translate(${tx}px, ${ty}px)`;
  applyStickToInput(maxLen > 0 ? tx / maxLen : 0, maxLen > 0 ? ty / maxLen : 0);
  sendInput(true);
}

function initMobileControls() {
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches || window.innerWidth <= 900;
  if (!coarse || !mobileControlsEl || !joystickBaseEl || !joystickKnobEl || !fireBtnEl || state.mobile.inited) return;
  state.mobile.inited = true;
  state.mobile.active = true;
  const rect = joystickBaseEl.getBoundingClientRect();
  state.mobile.baseCenterX = rect.left + rect.width / 2;
  state.mobile.baseCenterY = rect.top + rect.height / 2;
  state.mobile.radius = rect.width * 0.32;

  joystickBaseEl.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (state.mobile.stickTouchId != null) return;
      const t = e.changedTouches[0];
      state.mobile.stickTouchId = t.identifier;
      updateStickFromTouch(t);
    },
    { passive: false }
  );

  joystickBaseEl.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === state.mobile.stickTouchId) {
          updateStickFromTouch(t);
          break;
        }
      }
    },
    { passive: false }
  );

  const releaseStick = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === state.mobile.stickTouchId) {
        state.mobile.stickTouchId = null;
        applyStickToInput(0, 0);
        resetStickVisual();
        sendInput(true);
        break;
      }
    }
  };
  joystickBaseEl.addEventListener('touchend', releaseStick, { passive: false });
  joystickBaseEl.addEventListener('touchcancel', releaseStick, { passive: false });

  fireBtnEl.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (state.mobile.fireTouchId != null) return;
      state.mobile.fireTouchId = e.changedTouches[0].identifier;
      state.input.firing = true;
      sendInput(true);
    },
    { passive: false }
  );

  const releaseFire = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === state.mobile.fireTouchId) {
        state.mobile.fireTouchId = null;
        state.input.firing = false;
        sendInput(true);
        break;
      }
    }
  };
  fireBtnEl.addEventListener('touchend', releaseFire, { passive: false });
  fireBtnEl.addEventListener('touchcancel', releaseFire, { passive: false });
  if (dashBtnEl) {
    dashBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        triggerDash();
      },
      { passive: false }
    );
  }

  const updateGlobalTouch = (touch) => {
    if (state.mobile.stickTouchId == null || !state.mobile.active) return;
    if (touch.identifier !== state.mobile.stickTouchId) return;
    updateStickFromTouch(touch);
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      if (!state.mobile.active) return;
      for (const t of e.changedTouches) {
        const leftHalf = t.clientX < window.innerWidth * 0.5;
        if (leftHalf && state.mobile.stickTouchId == null) {
          state.mobile.stickTouchId = t.identifier;
          updateStickFromTouch(t);
        } else if (!leftHalf && state.mobile.fireTouchId == null) {
          state.mobile.fireTouchId = t.identifier;
          state.input.firing = true;
          sendInput(true);
        }
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!state.mobile.active) return;
      for (const t of e.changedTouches) updateGlobalTouch(t);
    },
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (!state.mobile.active) return;
      for (const t of e.changedTouches) {
        if (t.identifier === state.mobile.stickTouchId) {
          state.mobile.stickTouchId = null;
          applyStickToInput(0, 0);
          resetStickVisual();
          sendInput(true);
        }
        if (t.identifier === state.mobile.fireTouchId) {
          state.mobile.fireTouchId = null;
          state.input.firing = false;
          sendInput(true);
        }
      }
    },
    { passive: false }
  );
}

function inputSignature() {
  const i = state.input;
  return `${+i.up}${+i.down}${+i.left}${+i.right}${+i.firing}${+i.moveToAim}${+i.dash}|${i.aimAngle.toFixed(3)}`;
}

function sendInput(force = false) {
  const now = performance.now();
  if (!force && now - state.lastInputSentAt < INPUT_SEND_MS) return;
  const sig = inputSignature();
  if (!force && sig === state.lastInputSignature) return;
  send('input', state.input);
  state.lastInputSentAt = now;
  state.lastInputSignature = sig;
}

function triggerDash() {
  state.input.dash = true;
  sendInput(true);
  state.input.dash = false;
  sendInput(true);
}

function connectAndJoin(name) {
  const ws = io({ transports: ['websocket', 'polling'] });
  state.ws = ws;

  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get('room') || '';

  ws.on('connect', () => send('join', { roomId: roomFromUrl, name }));

  ws.on('server_message', (msg) => {
    if (msg.type === 'join_error') {
      alert(msg.payload.reason);
      return;
    }

    if (msg.type === 'joined') {
      state.myId = msg.payload.yourId;
      state.roomId = msg.payload.roomId;
      state.rules = msg.payload.rules;
      state.map = msg.payload.map || null;

      const url = new URL(location.href);
      url.searchParams.set('room', state.roomId);
      history.replaceState({}, '', url.toString());

      overlay.style.display = 'none';
      sendInput(true);
      return;
    }

    if (msg.type === 'room_state') {
      state.players = msg.payload.players;
      state.bullets = msg.payload.bullets;
      state.killFeed = msg.payload.killFeed;
      state.pickups = msg.payload.pickups || [];
      state.zone = msg.payload.zone || null;
      state.serverNow = Number(msg.payload.serverNow || Date.now());
      syncRenderState();
    }
  });

  ws.on('disconnect', () => {
    overlay.style.display = 'grid';
  });
}

function key(val, pressed) {
  if (val === 'w') state.input.up = pressed;
  if (val === 's') state.input.down = pressed;
  if (val === 'a') state.input.left = pressed;
  if (val === 'd') state.input.right = pressed;
}

document.addEventListener('keydown', (e) => {
  key(e.key.toLowerCase(), true);
  if (e.key === '1') send('weapon', { weapon: 'pistol' });
  if (e.key === '2') send('weapon', { weapon: 'rifle' });
  if (e.key === 'Shift' || e.key === ' ') triggerDash();
  sendInput(true);
});

document.addEventListener('keyup', (e) => {
  key(e.key.toLowerCase(), false);
  sendInput(true);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) state.input.firing = true;
  if (e.button === 2) state.input.moveToAim = true;
  sendInput(true);
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) state.input.firing = false;
  if (e.button === 2) state.input.moveToAim = false;
  sendInput(true);
});
window.addEventListener('blur', () => {
  state.input.firing = false;
  state.input.moveToAim = false;
  sendInput(true);
});
window.addEventListener('beforeunload', disconnectSession);
window.addEventListener('pagehide', disconnectSession);
canvas.addEventListener('mousemove', (e) => {
  const me = state.renderPlayers.get(state.myId);
  if (!me) return;
  const mx = e.clientX - canvas.width / 2;
  const my = e.clientY - canvas.height / 2;
  state.input.aimAngle = Math.atan2(my, mx);

  const now = performance.now();
  if (now - state.lastMouseSentAt >= MOUSE_SEND_MS) {
    state.lastMouseSentAt = now;
    sendInput(true);
  }
});

playBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  connectAndJoin(name);
});

initMobileControls();

setInterval(() => sendInput(false), INPUT_SEND_MS);

function syncRenderState() {
  const now = performance.now();
  const nextPlayers = new Set();
  for (const p of state.players) {
    nextPlayers.add(p.id);
    const existing = state.renderPlayers.get(p.id);
    if (!existing) {
      state.renderPlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y, serverX: p.x, serverY: p.y });
      continue;
    }
    existing.serverX = p.x;
    existing.serverY = p.y;
    existing.targetX = p.x;
    existing.targetY = p.y;
    existing.vx = p.vx;
    existing.vy = p.vy;
    existing.hp = p.hp;
    existing.alive = p.alive;
    existing.deaths = p.deaths;
    existing.kills = p.kills;
    existing.weapon = p.weapon;
    existing.color = p.color;
    existing.name = p.name;
    existing.rapidFire = !!p.rapidFire;
    existing.shielded = !!p.shielded;
  }
  for (const id of [...state.renderPlayers.keys()]) {
    if (!nextPlayers.has(id)) state.renderPlayers.delete(id);
  }

  const nextBullets = new Set();
  for (const b of state.bullets) {
    nextBullets.add(b.id);
    const existing = state.renderBullets.get(b.id);
    if (!existing) {
      state.renderBullets.set(b.id, { ...b, targetX: b.x, targetY: b.y, updatedAt: now });
      continue;
    }
    existing.targetX = b.x;
    existing.targetY = b.y;
    existing.vx = b.vx;
    existing.vy = b.vy;
    existing.updatedAt = now;
  }
  for (const id of [...state.renderBullets.keys()]) {
    if (!nextBullets.has(id)) state.renderBullets.delete(id);
  }
}

function pointInRect(x, y, rect, pad = 0) {
  return (
    x >= rect.x + pad &&
    x <= rect.x + rect.w - pad &&
    y >= rect.y + pad &&
    y <= rect.y + rect.h - pad
  );
}

function pointInWalkable(map, x, y, pad = 0) {
  if (!map) return true;
  for (const rect of map.rooms || []) if (pointInRect(x, y, rect, pad)) return true;
  for (const rect of map.corridors || []) if (pointInRect(x, y, rect, pad)) return true;
  return false;
}

function canPlaceCircle(x, y, radius) {
  const pts = [
    [x, y], [x + radius, y], [x - radius, y], [x, y + radius], [x, y - radius],
    [x + radius * 0.7, y + radius * 0.7], [x - radius * 0.7, y + radius * 0.7],
    [x + radius * 0.7, y - radius * 0.7], [x - radius * 0.7, y - radius * 0.7],
  ];
  return pts.every(([px, py]) => pointInWalkable(state.map, px, py, 2));
}

function predictLocalMovement(me, dt) {
  if (!me || !me.alive) return;
  const speed = state.rules?.playerSpeed || 312;

  let vx = 0;
  let vy = 0;
  if (state.input.moveToAim) {
    vx = Math.cos(state.input.aimAngle) * speed;
    vy = Math.sin(state.input.aimAngle) * speed;
  } else {
    const x = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
    const y = (state.input.down ? 1 : 0) - (state.input.up ? 1 : 0);
    if (x !== 0 || y !== 0) {
      const len = Math.hypot(x, y);
      vx = (x / len) * speed;
      vy = (y / len) * speed;
    }
  }

  const nx = me.x + vx * dt;
  const ny = me.y + vy * dt;
  if (canPlaceCircle(nx, ny, PLAYER_RADIUS)) {
    me.x = nx;
    me.y = ny;
  } else if (canPlaceCircle(nx, me.y, PLAYER_RADIUS)) {
    me.x = nx;
  } else if (canPlaceCircle(me.x, ny, PLAYER_RADIUS)) {
    me.y = ny;
  }

  me.vx = vx;
  me.vy = vy;
}

function reconcileLocalPlayer(me) {
  if (!me || me.serverX == null || me.serverY == null) return;
  const dx = me.serverX - me.x;
  const dy = me.serverY - me.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 90) {
    me.x = me.serverX;
    me.y = me.serverY;
    return;
  }
  me.x += dx * CORRECTION_LERP;
  me.y += dy * CORRECTION_LERP;
}

function spawnLocalTracer(me) {
  if (!me || !me.alive) return;
  const weapon = state.rules?.weapons?.[me.weapon || 'pistol'];
  if (!weapon) return;
  const now = performance.now();
  if (now < state.nextLocalShotAt) return;
  state.nextLocalShotAt = now + weapon.fireCooldown;

  const angle = state.input.aimAngle;
  state.localBullets.push({
    x: me.x + Math.cos(angle) * (PLAYER_RADIUS + 8),
    y: me.y + Math.sin(angle) * (PLAYER_RADIUS + 8),
    vx: Math.cos(angle) * weapon.bulletSpeed,
    vy: Math.sin(angle) * weapon.bulletSpeed,
    ttl: weapon.bulletLife,
  });
}

function drawMap() {
  ctx.fillStyle = '#0b1424';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state.map) return;

  const pixel = 16;
  const viewLeft = state.camX - canvas.width / 2 - pixel * 2;
  const viewTop = state.camY - canvas.height / 2 - pixel * 2;
  const viewRight = state.camX + canvas.width / 2 + pixel * 2;
  const viewBottom = state.camY + canvas.height / 2 + pixel * 2;

  const startX = Math.floor(viewLeft / pixel) * pixel;
  const startY = Math.floor(viewTop / pixel) * pixel;
  for (let wx = startX; wx < viewRight; wx += pixel) {
    for (let wy = startY; wy < viewBottom; wy += pixel) {
      const h = ((wx * 73856093) ^ (wy * 19349663)) & 3;
      const shade = ['#112338', '#12263d', '#132941', '#142c45'][h];
      const p = worldToScreen(wx, wy);
      ctx.fillStyle = shade;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), pixel, pixel);
    }
  }

  const drawWalkableRect = (rect, palette, border) => {
    const sx = Math.floor(rect.x / pixel) * pixel;
    const sy = Math.floor(rect.y / pixel) * pixel;
    for (let wx = sx; wx < rect.x + rect.w; wx += pixel) {
      for (let wy = sy; wy < rect.y + rect.h; wy += pixel) {
        if (!pointInRect(wx + pixel / 2, wy + pixel / 2, rect, 0)) continue;
        const h = ((wx * 83492791) ^ (wy * 102847737)) & 3;
        const p = worldToScreen(wx, wy);
        ctx.fillStyle = palette[h];
        ctx.fillRect(Math.round(p.x), Math.round(p.y), pixel, pixel);
      }
    }
    const tl = worldToScreen(rect.x, rect.y);
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(tl.x), Math.round(tl.y), Math.round(rect.w), Math.round(rect.h));
  };

  for (const c of state.map.corridors || []) drawWalkableRect(c, ['#2f4e31', '#355b39', '#3a633e', '#345737'], '#7cae8a');
  for (const r of state.map.rooms || []) drawWalkableRect(r, ['#6f5742', '#7a6048', '#82684e', '#765d46'], '#b79f7e');

  for (const d of state.map.decorations || []) {
    const p = worldToScreen(d.x, d.y);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const w = Math.max(pixel, Math.round(d.w));
    const h = Math.max(pixel, Math.round(d.h));
    if (d.type === 'road') {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(d.rot || 0);
      ctx.fillStyle = '#6e5f43';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let i = -w / 2; i < w / 2; i += 8) ctx.fillRect(i, -2, 4, 4);
      ctx.restore();
    } else if (d.type === 'tree') {
      ctx.fillStyle = '#324126';
      ctx.fillRect(x + Math.round(w * 0.42), y + Math.round(h * 0.62), Math.max(4, Math.round(w * 0.15)), Math.round(h * 0.38));
      ctx.fillStyle = '#4e7a44';
      ctx.fillRect(x + 2, y + Math.round(h * 0.18), Math.round(w * 0.86), Math.round(h * 0.52));
      ctx.fillStyle = '#609154';
      ctx.fillRect(x + 6, y + Math.round(h * 0.1), Math.round(w * 0.72), Math.round(h * 0.24));
    } else if (d.type === 'ruin') {
      ctx.fillStyle = '#4e5561';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#646d7c';
      ctx.fillRect(x + 3, y + 3, w - 6, 6);
      ctx.fillStyle = '#2e343e';
      ctx.fillRect(x + Math.round(w * 0.2), y + Math.round(h * 0.35), Math.round(w * 0.16), Math.round(h * 0.65));
      ctx.fillRect(x + Math.round(w * 0.64), y + Math.round(h * 0.35), Math.round(w * 0.16), Math.round(h * 0.65));
    } else if (d.type === 'boulder') {
      ctx.fillStyle = '#596270';
      ctx.fillRect(x, y + Math.round(h * 0.2), w, Math.round(h * 0.8));
      ctx.fillStyle = '#727b89';
      ctx.fillRect(x + 3, y + Math.round(h * 0.28), w - 6, Math.round(h * 0.18));
    } else if (d.type === 'mushroom') {
      ctx.fillStyle = '#d55b62';
      ctx.fillRect(x, y, w, Math.round(h * 0.45));
      ctx.fillStyle = '#f4c8cb';
      ctx.fillRect(x + Math.round(w * 0.38), y + Math.round(h * 0.45), Math.max(3, Math.round(w * 0.24)), Math.round(h * 0.55));
    }
  }

  for (const seg of state.map.walls || []) {
    const a = worldToScreen(seg.x1, seg.y1);
    const b = worldToScreen(seg.x2, seg.y2);
    ctx.strokeStyle = '#9aa7bf';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
    ctx.stroke();
  }
}

function drawZone() {
  if (!state.zone) return;
  const s = worldToScreen(state.zone.centerX, state.zone.centerY);
  ctx.save();
  ctx.fillStyle = 'rgba(14, 19, 31, 0.42)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(s.x, s.y, state.zone.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255, 98, 98, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(s.x, s.y, state.zone.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function worldToScreen(x, y) {
  return { x: x - state.camX + canvas.width / 2, y: y - state.camY + canvas.height / 2 };
}

function render() {
  requestAnimationFrame(render);
  const now = performance.now();
  const frameDt = Math.min(0.05, (now - state.lastRenderAt) / 1000);
  state.lastRenderAt = now;

  const me = state.renderPlayers.get(state.myId);
  predictLocalMovement(me, frameDt);
  if (state.input.firing) spawnLocalTracer(me);

  for (const p of state.renderPlayers.values()) {
    if (p.targetX == null) {
      p.targetX = p.x;
      p.targetY = p.y;
    }
    if (p.id !== state.myId) {
      p.targetX += (p.vx || 0) * frameDt;
      p.targetY += (p.vy || 0) * frameDt;
      p.x += (p.targetX - p.x) * PLAYER_LERP;
      p.y += (p.targetY - p.y) * PLAYER_LERP;
    }
  }

  reconcileLocalPlayer(me);

  for (const b of state.renderBullets.values()) {
    if (b.targetX == null) {
      b.targetX = b.x;
      b.targetY = b.y;
    }
    b.targetX += (b.vx || 0) * frameDt;
    b.targetY += (b.vy || 0) * frameDt;
    b.x += (b.targetX - b.x) * BULLET_LERP;
    b.y += (b.targetY - b.y) * BULLET_LERP;
  }

  state.localBullets = state.localBullets.filter((b) => {
    b.x += b.vx * frameDt;
    b.y += b.vy * frameDt;
    b.ttl -= frameDt * 1000;
    return b.ttl > 0;
  });

  if (me) {
    state.camX += (me.x - state.camX) * 0.25;
    state.camY += (me.y - state.camY) * 0.25;
  }

  drawMap();
  drawZone();

  for (const pickup of state.pickups) {
    const s = worldToScreen(pickup.x, pickup.y);
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    if (pickup.type === 'medkit') {
      ctx.fillStyle = '#d64f4f';
      ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.fillStyle = '#fff4f4';
      ctx.fillRect(x - 2, y - 5, 4, 10);
      ctx.fillRect(x - 5, y - 2, 10, 4);
    } else if (pickup.type === 'rapidfire') {
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.fillStyle = '#fff3d7';
      ctx.fillRect(x - 1, y - 5, 2, 10);
      ctx.fillRect(x - 3, y - 1, 6, 2);
    } else {
      ctx.fillStyle = '#7dc9ff';
      ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.fillStyle = '#e7f7ff';
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
    ctx.strokeStyle = '#0f1726';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 7, y - 7, 14, 14);
  }

  for (const b of state.renderBullets.values()) {
    const s = worldToScreen(b.x, b.y);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(Math.round(s.x - 2), Math.round(s.y - 2), 4, 4);
  }

  for (const b of state.localBullets) {
    const s = worldToScreen(b.x, b.y);
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(Math.round(s.x - 2), Math.round(s.y - 2), 4, 4);
  }

  for (const p of state.renderPlayers.values()) {
    const s = worldToScreen(p.x, p.y);
    if (assets.playerReady) {
      const frameW = 16;
      const frameH = 16;
      const moving = Math.hypot(p.vx || 0, p.vy || 0) > 10;
      const walk = moving ? Math.floor(performance.now() / 100) % 4 : 0;
      const angle = p.id === state.myId ? state.input.aimAngle : Math.atan2(p.vy || 0, p.vx || 1);
      let row = 0;
      // 4x4 sheet mapping from user:
      // row 0 = down, row 1 = up, row 2 = right, row 3 = left.
      if (angle > Math.PI / 4 && angle <= (3 * Math.PI) / 4) row = 0; // down
      else if (angle <= -Math.PI / 4 && angle > (-3 * Math.PI) / 4) row = 1; // up
      else if (angle > -Math.PI / 4 && angle <= Math.PI / 4) row = 2; // right
      else row = 3; // left
      const col = walk;
      ctx.save();
      if (!p.alive) ctx.globalAlpha = 0.5;
      ctx.imageSmoothingEnabled = false;
      const dx = Math.round(s.x - 14);
      const dy = Math.round(s.y - 14);
      ctx.drawImage(assets.player, col * frameW, row * frameH, frameW, frameH, dx, dy, 28, 28);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color || '#66d9ff';
      if (!p.alive) ctx.fillStyle = '#6f7788';
      ctx.fillRect(Math.round(s.x - 12), Math.round(s.y - 12), 24, 24);
      ctx.fillStyle = '#081121';
      ctx.fillRect(Math.round(s.x - 4), Math.round(s.y - 4), 8, 8);
    }

    ctx.fillStyle = '#eaf2ff';
    ctx.font = '12px monospace';
    ctx.fillText(p.name, Math.round(s.x - 20), Math.round(s.y - 20));

    const hpMax = state.rules?.startHp || 100;
    const hpRatio = Math.max(0, Math.min(1, (p.hp || 0) / hpMax));
    const barW = 30;
    const barH = 5;
    const bx = Math.round(s.x - barW / 2);
    const by = Math.round(s.y - 33);
    ctx.fillStyle = '#2b3243';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = p.alive ? '#8bf77b' : '#7b8794';
    ctx.fillRect(bx, by, Math.round(barW * hpRatio), barH);
    ctx.strokeStyle = '#0b1320';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, barW, barH);
    ctx.fillStyle = '#cde7ff';
    ctx.font = '10px monospace';
    ctx.fillText(`${Math.max(0, Math.round(p.hp))}`, bx + barW + 4, by + 5);

    if (p.id === state.myId && p.alive) {
      const angle = state.input.aimAngle;
      ctx.strokeStyle = '#c3dafe';
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x), Math.round(s.y));
      ctx.lineTo(Math.round(s.x + Math.cos(angle) * 24), Math.round(s.y + Math.sin(angle) * 24));
      ctx.stroke();
      if (p.rapidFire || p.shielded) {
        ctx.font = '10px monospace';
        ctx.fillStyle = '#eaf2ff';
        const tags = `${p.rapidFire ? 'RF ' : ''}${p.shielded ? 'SH' : ''}`.trim();
        ctx.fillText(tags, Math.round(s.x - 10), Math.round(s.y + 24));
      }
    }
  }

  roomCodeEl.textContent = state.roomId ? `Room: ${state.roomId}` : 'Room: -';
  if (me) {
    const z = state.zone;
    const outside =
      z && Math.hypot((me.x || 0) - z.centerX, (me.y || 0) - z.centerY) > z.radius;
    healthEl.innerHTML = me.alive
      ? `HP: ${Math.round(me.hp)}${outside ? ' <span class="dead">OUTSIDE ZONE</span>' : ''}`
      : '<span class="dead">Respawning...</span>';
    weaponEl.textContent = `Weapon: ${me.weapon === 'rifle' ? 'Rifle [2]' : 'Pistol [1]'}`;
    const dashLeft = Math.max(0, Math.round((me.nextDashAt || 0) - Date.now()));
    dashStatusEl.textContent = dashLeft > 0 ? `Dash: ${(dashLeft / 1000).toFixed(1)}s` : 'Dash: READY [Shift]';
  }

  scoreboardEl.innerHTML = [...state.renderPlayers.values()]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .map((p) => `<div>${p.name}: ${p.kills}/${p.deaths}</div>`)
    .join('');

  killfeedEl.innerHTML = (state.killFeed || []).map((x) => `<div>${x}</div>`).join('');
}

render();
