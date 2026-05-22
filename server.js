const express = require('express');
const http = require('http');
const path = require('path');
const { Server: SocketIOServer } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function nanoid(size = 6) {
  let id = '';
  for (let i = 0; i < size; i += 1) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return id;
}
const PORT = process.env.PORT || 3000;
const REPORT_INTERVAL_MS = 10 * 60 * 1000;
const RESEND_API_URL = 'https://api.resend.com/emails';
const REPORT_EMAIL_TO = process.env.REPORT_EMAIL_TO || 'alshuriga@gmail.com';
const REPORT_EMAIL_FROM = process.env.REPORT_EMAIL_FROM || '';
const REPORT_EMAIL_SUBJECT = process.env.REPORT_EMAIL_SUBJECT || 'BBRoyale 10-min report';
const RESEND_API_KEY =
  process.env.RESEND_API_KEY ||
  (process.env.NODE_ENV !== 'production' ? readLocalSecret('resend-api-key.txt') : '');

const TICK_RATE = 30;
const MAP_SIZE = 1200;
const PLAYER_RADIUS = 14;
const MAX_PLAYERS_PER_ROOM = 5;
const RESPAWN_MS = 3000;
const START_HP = 100;
const BASE_PLAYER_SPEED = 312;
const MIN_HUMANS_FOR_NO_BOTS = 3;
const TARGET_BOTS_PER_ROOM = 3;
const BOT_HP = 70;
const BOT_SPEED_MULT = 0.72;
const BOT_DAMAGE_MULT = 0.55;
const BOT_FIRE_CHANCE = 0.55;
const HEAL_DELAY_MS = 2000;
const FULL_HEAL_TIME_SEC = 4;
const PICKUP_MAX_PER_ROOM = 7;
const PICKUP_SPAWN_EVERY_MS = 6000;
const PICKUP_LIFETIME_MS = 18000;
const ZONE_STAGE_MS = 30000;
const ZONE_DAMAGE_PER_SEC = 12;
const DASH_COOLDOWN_MS = 2800;
const DASH_DURATION_MS = 180;
const DASH_SPEED_MULT = 2.8;

const WEAPONS = {
  pistol: {
    name: 'Pistol',
    damage: 24,
    fireCooldown: 330,
    bulletSpeed: 800,
    bulletLife: 900,
    spread: 0.02,
    pelletCount: 1,
  },
  rifle: {
    name: 'Rifle',
    damage: 13,
    fireCooldown: 110,
    bulletSpeed: 900,
    bulletLife: 750,
    spread: 0.045,
    pelletCount: 1,
  },
};

const rooms = new Map();
const clients = new Map();

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (_, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.get('/health', (_, res) => res.json({ ok: true }));

function readLocalSecret(path) {
  try {
    // Local fallback to avoid hardcoding API keys in code.
    return require('fs').readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildBoundarySegments(rects) {
  const cell = 20;
  const grid = Math.floor(MAP_SIZE / cell);
  const occ = new Set();
  const key = (x, y) => `${x},${y}`;
  const has = (x, y) => occ.has(key(x, y));

  for (let gx = 0; gx < grid; gx += 1) {
    for (let gy = 0; gy < grid; gy += 1) {
      const cx = gx * cell + cell / 2;
      const cy = gy * cell + cell / 2;
      if (rects.some((r) => pointInRect(cx, cy, r, 0))) occ.add(key(gx, gy));
    }
  }

  const walls = [];
  for (let gx = 0; gx < grid; gx += 1) {
    for (let gy = 0; gy < grid; gy += 1) {
      if (!has(gx, gy)) continue;
      const x = gx * cell;
      const y = gy * cell;
      if (!has(gx, gy - 1)) walls.push({ x1: x, y1: y, x2: x + cell, y2: y });
      if (!has(gx + 1, gy)) walls.push({ x1: x + cell, y1: y, x2: x + cell, y2: y + cell });
      if (!has(gx, gy + 1)) walls.push({ x1: x + cell, y1: y + cell, x2: x, y2: y + cell });
      if (!has(gx - 1, gy)) walls.push({ x1: x, y1: y + cell, x2: x, y2: y });
    }
  }
  return walls;
}

function generateMapLayout() {
  const roomsOut = [];
  const targetRooms = randomInt(5, 7);
  const border = 40;

  for (let i = 0; i < 260 && roomsOut.length < targetRooms; i += 1) {
    const w = randomInt(220, 360);
    const h = randomInt(180, 320);
    const x = randomInt(border, MAP_SIZE - w - border);
    const y = randomInt(border, MAP_SIZE - h - border);
    const candidate = { x, y, w, h };
    const spacing = { x: x - 24, y: y - 24, w: w + 48, h: h + 48 };
    if (roomsOut.some((r) => intersects(spacing, r))) continue;
    roomsOut.push(candidate);
  }

  if (roomsOut.length < 2) {
    roomsOut.push({ x: 140, y: 160, w: 250, h: 180 }, { x: 680, y: 620, w: 250, h: 200 });
  }

  const centers = roomsOut.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })).sort((a, b) => a.x - b.x);
  const corridors = [];
  const width = 96;
  for (let i = 1; i < centers.length; i += 1) {
    const a = centers[i - 1];
    const b = centers[i];
    if (Math.random() > 0.5) {
      const hx = Math.min(a.x, b.x);
      corridors.push({ x: hx, y: a.y - width / 2, w: Math.abs(a.x - b.x), h: width });
      const vy = Math.min(a.y, b.y);
      corridors.push({ x: b.x - width / 2, y: vy, w: width, h: Math.abs(a.y - b.y) });
    } else {
      const vy = Math.min(a.y, b.y);
      corridors.push({ x: a.x - width / 2, y: vy, w: width, h: Math.abs(a.y - b.y) });
      const hx = Math.min(a.x, b.x);
      corridors.push({ x: hx, y: b.y - width / 2, w: Math.abs(a.x - b.x), h: width });
    }
  }

  const allRects = [...roomsOut, ...corridors];
  const walls = buildBoundarySegments(allRects);
  const map = { rooms: roomsOut, corridors, walls };
  map.decorations = generateDecorations(map);
  return map;
}

function buildZoneForStage(stage) {
  const minRadius = MAP_SIZE * 0.15;
  const maxRadius = MAP_SIZE * 0.62;
  const radius = Math.max(minRadius, maxRadius - stage * MAP_SIZE * 0.085);
  const drift = Math.min(stage * 42, 180);
  const centerX = MAP_SIZE / 2 + randomInt(-drift, drift);
  const centerY = MAP_SIZE / 2 + randomInt(-drift, drift);
  return { centerX, centerY, radius, stage };
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
  for (const rect of map.rooms) {
    if (pointInRect(x, y, rect, pad)) return true;
  }
  for (const rect of map.corridors) {
    if (pointInRect(x, y, rect, pad)) return true;
  }
  return false;
}

function canPlaceCircle(map, x, y, radius) {
  const pts = [
    [x, y],
    [x + radius, y],
    [x - radius, y],
    [x, y + radius],
    [x, y - radius],
    [x + radius * 0.7, y + radius * 0.7],
    [x - radius * 0.7, y + radius * 0.7],
    [x + radius * 0.7, y - radius * 0.7],
    [x - radius * 0.7, y - radius * 0.7],
  ];
  return pts.every(([px, py]) => pointInWalkable(map, px, py, 2));
}

function rectInWalkable(map, x, y, w, h) {
  const pts = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
    [x + w / 2, y + h / 2],
  ];
  return pts.some(([px, py]) => pointInWalkable(map, px, py, 2));
}

function overlapsRect(a, b, pad = 0) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function generateDecorations(map) {
  const decorations = [];
  const presets = [
    { type: 'tree', wMin: 28, wMax: 48, hMin: 28, hMax: 48, countMin: 35, countMax: 65 },
    { type: 'ruin', wMin: 52, wMax: 96, hMin: 52, hMax: 96, countMin: 10, countMax: 18 },
    { type: 'boulder', wMin: 24, wMax: 52, hMin: 20, hMax: 44, countMin: 24, countMax: 40 },
    { type: 'mushroom', wMin: 12, wMax: 24, hMin: 12, hMax: 24, countMin: 26, countMax: 50 },
    { type: 'road', wMin: 120, wMax: 300, hMin: 18, hMax: 34, countMin: 10, countMax: 18 },
  ];

  for (const p of presets) {
    const target = randomInt(p.countMin, p.countMax);
    for (let i = 0, placed = 0; i < target * 24 && placed < target; i += 1) {
      const w = randomInt(p.wMin, p.wMax);
      const h = randomInt(p.hMin, p.hMax);
      const x = randomInt(8, MAP_SIZE - w - 8);
      const y = randomInt(8, MAP_SIZE - h - 8);
      const rect = { x, y, w, h };
      if (rectInWalkable(map, x, y, w, h)) continue;
      if (decorations.some((d) => overlapsRect(rect, d, 8))) continue;
      decorations.push({ ...rect, type: p.type, rot: Math.random() * Math.PI * 2 });
      placed += 1;
    }
  }
  return decorations;
}

function randomSpawn(map) {
  const zones = [...map.rooms, ...map.corridors];
  for (let i = 0; i < 100; i += 1) {
    const zone = zones[randomInt(0, zones.length - 1)];
    const x = randomInt(zone.x + PLAYER_RADIUS + 6, zone.x + zone.w - PLAYER_RADIUS - 6);
    const y = randomInt(zone.y + PLAYER_RADIUS + 6, zone.y + zone.h - PLAYER_RADIUS - 6);
    if (canPlaceCircle(map, x, y, PLAYER_RADIUS)) return { x, y };
  }
  return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
}

function randomPatrolPoint(map) {
  const zonePool = [...map.rooms, ...map.corridors];
  const zone = zonePool[randomInt(0, zonePool.length - 1)];
  return {
    x: randomInt(zone.x + 18, zone.x + zone.w - 18),
    y: randomInt(zone.y + 18, zone.y + zone.h - 18),
  };
}

function createRoom() {
  const id = nanoid();
  const zone = buildZoneForStage(0);
  const room = {
    id,
    map: generateMapLayout(),
    players: new Map(),
    bullets: new Map(),
    bulletSeq: 0,
    killFeed: [],
    pickups: new Map(),
    pickupSeq: 0,
    nextPickupAt: Date.now() + 2500,
    zone,
    nextZoneAt: Date.now() + ZONE_STAGE_MS,
  };
  rooms.set(id, room);
  return room;
}

function getOrCreateRoom(roomId) {
  if (!roomId) return createRoom();
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const zone = buildZoneForStage(0);
  const room = {
    id: roomId,
    map: generateMapLayout(),
    players: new Map(),
    bullets: new Map(),
    bulletSeq: 0,
    killFeed: [],
    pickups: new Map(),
    pickupSeq: 0,
    nextPickupAt: Date.now() + 2500,
    zone,
    nextZoneAt: Date.now() + ZONE_STAGE_MS,
  };
  rooms.set(roomId, room);
  return room;
}

function toPublicPlayer(player) {
  const now = Date.now();
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    hp: player.hp,
    alive: player.alive,
    deaths: player.deaths,
    kills: player.kills,
    weapon: player.weapon,
    color: player.color,
    isBot: !!player.isBot,
    rapidFire: now < (player.rapidFireUntil || 0),
    shielded: now < (player.shieldUntil || 0),
    dashUntil: player.dashUntil || 0,
    nextDashAt: player.nextDashAt || 0,
  };
}

function send(socket, type, payload) {
  if (!socket) return;
  socket.emit('server_message', { type, payload });
}

function broadcast(room, type, payload) {
  for (const player of room.players.values()) {
    send(player.ws, type, payload);
  }
}

function leaveRoom(clientId) {
  const state = clients.get(clientId);
  if (!state) return;
  const room = rooms.get(state.roomId);
  if (!room) return;

  room.players.delete(clientId);
  clients.delete(clientId);
  syncBotsForRoom(room);

  if (room.players.size === 0) {
    rooms.delete(room.id);
    return;
  }

  broadcast(room, 'player_left', { id: clientId });
}

function sanitizeName(name) {
  const n = String(name || '').trim().slice(0, 14);
  return n || 'Player';
}

function humanPlayers(room) {
  return [...room.players.values()].filter((p) => !p.isBot);
}

function botPlayers(room) {
  return [...room.players.values()].filter((p) => p.isBot);
}

function randomBotName() {
  const names = ['Rook', 'Ash', 'Nova', 'Bolt', 'Sable', 'Hex', 'Frost', 'Nash', 'Iris', 'Kite'];
  return `BOT-${names[Math.floor(Math.random() * names.length)]}`;
}

function createBotPlayer(room) {
  const id = `bot-${room.id}-${nanoid(8)}`;
  const spawn = randomSpawn(room.map);
  const patrol = randomPatrolPoint(room.map);
  return {
    id,
    ws: null,
    isBot: true,
    name: randomBotName(),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    speed: BASE_PLAYER_SPEED * BOT_SPEED_MULT,
    maxHp: BOT_HP,
    hp: BOT_HP,
    alive: true,
    respawnAt: 0,
    lastDamagedAt: Date.now(),
    kills: 0,
    deaths: 0,
    weapon: Math.random() > 0.5 ? 'rifle' : 'pistol',
    lastShotAt: 0,
    rapidFireUntil: 0,
    shieldUntil: 0,
    aimAngle: 0,
    input: { up: false, down: false, left: false, right: false, firing: false, moveToAim: true, dash: false },
    color: '#ff9f43',
    patrolX: patrol.x,
    patrolY: patrol.y,
    nextPatrolAt: Date.now() + randomInt(1800, 4200),
    dashUntil: 0,
    nextDashAt: 0,
  };
}

function syncBotsForRoom(room) {
  const humans = humanPlayers(room).length;
  const bots = botPlayers(room);
  const needBots = humans > 0 && humans < MIN_HUMANS_FOR_NO_BOTS ? TARGET_BOTS_PER_ROOM : 0;

  if (bots.length < needBots) {
    for (let i = bots.length; i < needBots; i += 1) {
      const bot = createBotPlayer(room);
      room.players.set(bot.id, bot);
    }
  } else if (bots.length > needBots) {
    const removeCount = bots.length - needBots;
    for (let i = 0; i < removeCount; i += 1) {
      room.players.delete(bots[i].id);
    }
  }
}

function randomColor() {
  const colors = ['#4ecdc4', '#ff6b6b', '#ffd166', '#95e06c', '#73a9ff'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function spawnPickup(room, now) {
  const roll = Math.random();
  const type = roll < 0.5 ? 'medkit' : roll < 0.85 ? 'rapidfire' : 'shield';
  const spawn = randomSpawn(room.map);
  const id = `${room.id}-p-${room.pickupSeq++}`;
  room.pickups.set(id, {
    id,
    type,
    x: spawn.x,
    y: spawn.y,
    expiresAt: now + PICKUP_LIFETIME_MS,
  });
}

function maybeSpawnPickups(room, now) {
  for (const [id, pickup] of room.pickups.entries()) {
    if (pickup.expiresAt <= now) room.pickups.delete(id);
  }
  if (now < room.nextPickupAt) return;
  room.nextPickupAt = now + PICKUP_SPAWN_EVERY_MS;
  if (room.pickups.size >= PICKUP_MAX_PER_ROOM) return;
  spawnPickup(room, now);
}

function applyPickup(player, pickup, now) {
  if (pickup.type === 'medkit') {
    player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.35));
    return;
  }
  if (pickup.type === 'rapidfire') {
    player.rapidFireUntil = now + 6000;
    return;
  }
  if (pickup.type === 'shield') {
    player.shieldUntil = now + 4500;
  }
}

function updatePickupCollection(room, now) {
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    for (const [pickupId, pickup] of room.pickups.entries()) {
      if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > PLAYER_RADIUS + 10) continue;
      applyPickup(player, pickup, now);
      room.pickups.delete(pickupId);
    }
  }
}

function maybeAdvanceZone(room, now) {
  if (now < room.nextZoneAt) return;
  const nextStage = (room.zone?.stage || 0) + 1;
  room.zone = buildZoneForStage(nextStage);
  room.nextZoneAt = now + ZONE_STAGE_MS;
}

function applyZoneDamage(room, player, dt, now) {
  if (!player.alive || !room.zone) return;
  const dx = player.x - room.zone.centerX;
  const dy = player.y - room.zone.centerY;
  const outside = Math.hypot(dx, dy) > room.zone.radius;
  if (!outside) return;
  player.hp -= ZONE_DAMAGE_PER_SEC * dt;
  player.lastDamagedAt = now;
  if (player.hp <= 0) {
    killPlayer(room, player, null);
  }
}

function collectRuntimeStats() {
  const roomStats = [];
  let activePlayers = 0;
  let alivePlayers = 0;
  let bullets = 0;

  for (const room of rooms.values()) {
    const players = [...room.players.values()];
    const alive = players.filter((p) => p.alive).length;
    const roomBullets = room.bullets.size;
    activePlayers += players.length;
    alivePlayers += alive;
    bullets += roomBullets;
    roomStats.push({
      id: room.id,
      players: players.length,
      alive,
      bullets: roomBullets,
      topPlayers: players
        .map((p) => `${p.name} ${p.kills}/${p.deaths}`)
        .sort()
        .slice(0, 5),
    });
  }

  roomStats.sort((a, b) => b.players - a.players || a.id.localeCompare(b.id));

  return {
    generatedAt: new Date().toISOString(),
    rooms: rooms.size,
    connectedClients: clients.size,
    activePlayers,
    alivePlayers,
    bullets,
    roomStats,
  };
}

function buildReportText(stats) {
  const lines = [
    `Generated: ${stats.generatedAt}`,
    `Rooms: ${stats.rooms}`,
    `Connected clients: ${stats.connectedClients}`,
    `Players total/alive: ${stats.activePlayers}/${stats.alivePlayers}`,
    `Bullets in flight: ${stats.bullets}`,
    '',
    'Rooms detail:',
  ];

  if (stats.roomStats.length === 0) {
    lines.push('- No active rooms');
  } else {
    for (const room of stats.roomStats) {
      lines.push(`- ${room.id}: players=${room.players}, alive=${room.alive}, bullets=${room.bullets}`);
      if (room.topPlayers.length > 0) {
        lines.push(`  players: ${room.topPlayers.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

async function sendReportEmail() {
  if (!REPORT_EMAIL_TO || !REPORT_EMAIL_FROM || !RESEND_API_KEY) return;
  const stats = collectRuntimeStats();
  const text = buildReportText(stats);

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: REPORT_EMAIL_FROM,
      to: [REPORT_EMAIL_TO],
      subject: REPORT_EMAIL_SUBJECT,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${body}`);
  }
}

function startEmailReporting() {
  const missing = [];
  if (!REPORT_EMAIL_TO) missing.push('REPORT_EMAIL_TO');
  if (!REPORT_EMAIL_FROM) missing.push('REPORT_EMAIL_FROM');
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');

  if (missing.length > 0) {
    console.log(`Email reporting disabled. Missing: ${missing.join(', ')}`);
    return;
  }

  console.log(`Email reporting enabled: every ${REPORT_INTERVAL_MS / 60000} minutes -> ${REPORT_EMAIL_TO}`);
  const timer = setInterval(async () => {
    try {
      await sendReportEmail();
      console.log(`Email report sent at ${new Date().toISOString()}`);
    } catch (error) {
      console.error('Failed to send periodic email report:', error.message);
    }
  }, REPORT_INTERVAL_MS);
  timer.unref?.();
}

io.on('connection', (socket) => {
  const clientId = nanoid();

  socket.on('client_message', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'join') {
      const room = getOrCreateRoom(msg.payload?.roomId);
      const name = sanitizeName(msg.payload?.name);

      if (humanPlayers(room).length >= MAX_PLAYERS_PER_ROOM) {
        send(socket, 'join_error', { reason: 'Room is full (max 5 players).' });
        return;
      }

      const spawn = randomSpawn(room.map);
      const player = {
        id: clientId,
        ws: socket,
        isBot: false,
        name,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        speed: BASE_PLAYER_SPEED,
        maxHp: START_HP,
        hp: START_HP,
        alive: true,
        respawnAt: 0,
        lastDamagedAt: Date.now(),
        kills: 0,
        deaths: 0,
        weapon: 'pistol',
        lastShotAt: 0,
        rapidFireUntil: 0,
        shieldUntil: 0,
        dashUntil: 0,
        nextDashAt: 0,
        aimAngle: 0,
        input: { up: false, down: false, left: false, right: false, firing: false, moveToAim: false, dash: false },
        color: randomColor(),
      };

      room.players.set(clientId, player);
      clients.set(clientId, { roomId: room.id });
      syncBotsForRoom(room);

      send(socket, 'joined', {
        yourId: clientId,
        roomId: room.id,
        map: room.map,
        rules: {
          maxPlayers: MAX_PLAYERS_PER_ROOM,
          mapSize: MAP_SIZE,
          startHp: START_HP,
          respawnMs: RESPAWN_MS,
          playerSpeed: BASE_PLAYER_SPEED,
          tickRate: TICK_RATE,
          zoneStageMs: ZONE_STAGE_MS,
          zoneDamagePerSec: ZONE_DAMAGE_PER_SEC,
          dashCooldownMs: DASH_COOLDOWN_MS,
          weapons: WEAPONS,
        },
      });

      broadcast(room, 'room_state', {
        players: [...room.players.values()].map(toPublicPlayer),
        bullets: [...room.bullets.values()],
        killFeed: room.killFeed,
        pickups: [...room.pickups.values()],
        zone: room.zone,
        serverNow: Date.now(),
      });
      return;
    }

    const clientState = clients.get(clientId);
    if (!clientState) return;
    const room = rooms.get(clientState.roomId);
    if (!room) return;
    const player = room.players.get(clientId);
    if (!player) return;

    if (msg.type === 'input') {
      player.input = {
        up: !!msg.payload?.up,
        down: !!msg.payload?.down,
        left: !!msg.payload?.left,
        right: !!msg.payload?.right,
        firing: !!msg.payload?.firing,
        moveToAim: !!msg.payload?.moveToAim,
        dash: !!msg.payload?.dash,
      };
      player.aimAngle = Number(msg.payload?.aimAngle || 0);
      return;
    }

    if (msg.type === 'weapon') {
      const weapon = msg.payload?.weapon;
      if (weapon === 'pistol' || weapon === 'rifle') {
        player.weapon = weapon;
      }
    }
  });

  socket.on('disconnect', () => leaveRoom(clientId));
});

function updatePlayerMovement(room, player, dt) {
  const map = room.map;
  const now = Date.now();
  if (player.input.dash && now >= (player.nextDashAt || 0) && player.alive) {
    player.dashUntil = now + DASH_DURATION_MS;
    player.nextDashAt = now + DASH_COOLDOWN_MS;
    player.input.dash = false;
  }
  const speedMult = now < (player.dashUntil || 0) ? DASH_SPEED_MULT : 1;
  const currentSpeed = player.speed * speedMult;
  if (player.input.moveToAim) {
    player.vx = Math.cos(player.aimAngle) * currentSpeed;
    player.vy = Math.sin(player.aimAngle) * currentSpeed;
    const nx = player.x + player.vx * dt;
    const ny = player.y + player.vy * dt;
    if (canPlaceCircle(map, nx, ny, PLAYER_RADIUS)) {
      player.x = nx;
      player.y = ny;
    } else if (canPlaceCircle(map, nx, player.y, PLAYER_RADIUS)) {
      player.x = nx;
    } else if (canPlaceCircle(map, player.x, ny, PLAYER_RADIUS)) {
      player.y = ny;
    } else {
      player.vx = 0;
      player.vy = 0;
    }
    return;
  }

  const x = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
  const y = (player.input.down ? 1 : 0) - (player.input.up ? 1 : 0);

  if (x === 0 && y === 0) {
    player.vx = 0;
    player.vy = 0;
  } else {
    const len = Math.hypot(x, y);
    player.vx = (x / len) * currentSpeed;
    player.vy = (y / len) * currentSpeed;
  }

  const nx = player.x + player.vx * dt;
  const ny = player.y + player.vy * dt;
  if (canPlaceCircle(map, nx, ny, PLAYER_RADIUS)) {
    player.x = nx;
    player.y = ny;
  } else if (canPlaceCircle(map, nx, player.y, PLAYER_RADIUS)) {
    player.x = nx;
  } else if (canPlaceCircle(map, player.x, ny, PLAYER_RADIUS)) {
    player.y = ny;
  }
}

function maybeFire(room, player, now) {
  if (!player.alive || !player.input.firing) return;
  const weapon = WEAPONS[player.weapon];
  if (!weapon) return;
  const fireCooldown =
    now < (player.rapidFireUntil || 0) ? Math.max(70, Math.round(weapon.fireCooldown * 0.65)) : weapon.fireCooldown;
  if (now - player.lastShotAt < fireCooldown) return;

  player.lastShotAt = now;
  if (player.isBot && Math.random() > BOT_FIRE_CHANCE) return;
  for (let i = 0; i < weapon.pelletCount; i += 1) {
    const spreadMult = player.isBot ? 2.4 : 1;
    const spread = (Math.random() * 2 - 1) * weapon.spread * spreadMult;
    const angle = player.aimAngle + spread;
    const id = `${room.id}-${room.bulletSeq++}`;

    room.bullets.set(id, {
      id,
      ownerId: player.id,
      x: player.x + Math.cos(angle) * (PLAYER_RADIUS + 8),
      y: player.y + Math.sin(angle) * (PLAYER_RADIUS + 8),
      vx: Math.cos(angle) * weapon.bulletSpeed,
      vy: Math.sin(angle) * weapon.bulletSpeed,
      damage: Math.round(weapon.damage * (player.isBot ? BOT_DAMAGE_MULT : 1)),
      expiresAt: now + weapon.bulletLife,
    });
  }
}

function updateBotAI(room, bot, now) {
  if (!bot.alive) return;
  const targets = [...room.players.values()].filter((p) => !p.isBot && p.alive);
  if (targets.length === 0) {
    if (now >= bot.nextPatrolAt || !bot.patrolX || !bot.patrolY) {
      const patrol = randomPatrolPoint(room.map);
      bot.patrolX = patrol.x;
      bot.patrolY = patrol.y;
      bot.nextPatrolAt = now + randomInt(1800, 4200);
    }
    const dx = bot.patrolX - bot.x;
    const dy = bot.patrolY - bot.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 24) {
      const patrol = randomPatrolPoint(room.map);
      bot.patrolX = patrol.x;
      bot.patrolY = patrol.y;
      bot.nextPatrolAt = now + randomInt(1800, 4200);
    }
    bot.aimAngle = Math.atan2(bot.patrolY - bot.y, bot.patrolX - bot.x);
    bot.input.firing = false;
    bot.input.moveToAim = true;
    return;
  }

  let target = targets[0];
  let best = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - bot.x, t.y - bot.y);
    if (d < best) {
      best = d;
      target = t;
    }
  }

  bot.aimAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
  const desired = bot.weapon === 'rifle' ? 520 : 420;
  bot.input.moveToAim = best > desired;
  bot.input.firing = best < 520;
  if (now % 7000 < 25 && Math.random() > 0.5) {
    bot.weapon = bot.weapon === 'rifle' ? 'pistol' : 'rifle';
  }
}

function killPlayer(room, victim, killer) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths += 1;
  victim.respawnAt = Date.now() + RESPAWN_MS;

  if (killer && killer.id !== victim.id) {
    killer.kills += 1;
    room.killFeed.unshift(`${killer.name} fragged ${victim.name}`);
  } else {
    room.killFeed.unshift(`${victim.name} is down`);
  }

  room.killFeed = room.killFeed.slice(0, 6);
}

function updateBullets(room, now, dt) {
  for (const [bulletId, bullet] of room.bullets.entries()) {
    const startX = bullet.x;
    const startY = bullet.y;
    const nextX = bullet.x + bullet.vx * dt;
    const nextY = bullet.y + bullet.vy * dt;
    const travel = Math.hypot(nextX - startX, nextY - startY);
    const stepLen = 10;
    const steps = Math.max(1, Math.ceil(travel / stepLen));
    let hitWall = false;

    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const sx = startX + (nextX - startX) * t;
      const sy = startY + (nextY - startY) * t;
      if (!pointInWalkable(room.map, sx, sy, 2)) {
        hitWall = true;
        break;
      }
      bullet.x = sx;
      bullet.y = sy;
    }

    const outOfBounds = hitWall || !pointInWalkable(room.map, bullet.x, bullet.y, 2);

    if (now > bullet.expiresAt || outOfBounds) {
      room.bullets.delete(bulletId);
      continue;
    }

    for (const player of room.players.values()) {
      if (!player.alive || player.id === bullet.ownerId) continue;
      const d = Math.hypot(player.x - bullet.x, player.y - bullet.y);
      if (d > PLAYER_RADIUS + 4) continue;

      const damageMult = now < (player.shieldUntil || 0) ? 0.65 : 1;
      player.hp -= Math.round(bullet.damage * damageMult);
      player.lastDamagedAt = now;
      room.bullets.delete(bulletId);
      if (player.hp <= 0) {
        const killer = room.players.get(bullet.ownerId);
        killPlayer(room, player, killer);
      }
      break;
    }
  }
}

function maybeRespawn(room, player, now) {
  if (player.alive) return;
  if (now < player.respawnAt) return;

  const spawn = randomSpawn(room.map);
  player.x = spawn.x;
  player.y = spawn.y;
  player.hp = player.maxHp;
  player.lastDamagedAt = now;
  player.alive = true;
}

function maybeHeal(player, now, dt) {
  if (!player.alive) return;
  if (player.hp >= player.maxHp) return;
  if (now - player.lastDamagedAt < HEAL_DELAY_MS) return;
  const healPerSec = player.maxHp / FULL_HEAL_TIME_SEC;
  player.hp = Math.min(player.maxHp, player.hp + healPerSec * dt);
}

let previousTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - previousTick) / 1000);
  previousTick = now;

  for (const room of rooms.values()) {
    syncBotsForRoom(room);
    maybeAdvanceZone(room, now);
    for (const player of room.players.values()) {
      maybeRespawn(room, player, now);
      if (player.isBot) updateBotAI(room, player, now);
      if (player.alive) updatePlayerMovement(room, player, dt);
      maybeFire(room, player, now);
      maybeHeal(player, now, dt);
      applyZoneDamage(room, player, dt, now);
    }

    updateBullets(room, now, dt);
    maybeSpawnPickups(room, now);
    updatePickupCollection(room, now);

    broadcast(room, 'room_state', {
      players: [...room.players.values()].map(toPublicPlayer),
      bullets: [...room.bullets.values()],
      killFeed: room.killFeed,
      pickups: [...room.pickups.values()],
      zone: room.zone,
      serverNow: now,
    });
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  startEmailReporting();
  console.log(`Server listening on http://localhost:${PORT}`);
});
