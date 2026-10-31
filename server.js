'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = 3000;

const PLAYER_DATA_DIR = path.join(__dirname, 'data', 'players');
const PLAYER_DATA_VERSION = 1;
const MAP_VERSION = 3;
const PLAYER_SAVE_DEBOUNCE_MS = 120;
const PLAYER_AUTOSAVE_MS = 10000;

const PLAYER_MAX_HEALTH = 10;
const PLAYER_MAX_LEVEL = 66;
const PLAYER_BASE_MOVE_SPEED = 300;
const PLAYER_HEALTH_PER_LEVEL = 3;
const PLAYER_SPEED_PER_LEVEL = 2;
const XP_PER_LEVEL = 50;

// 小鬼伤害 50 > 玩家 10 点血量，因此一口就会倒地，3 秒后自动复活，避免卡死。
const PLAYER_RESPAWN_DELAY = 3000;

const JUMP_INITIAL_SPEED = 7.2;
const JUMP_GRAVITY = 20;
const JUMP_COOLDOWN_MS = 360;
const JUMP_TICK_MS = 33;

const WORLD_DAY_SECONDS = 180;
const WORLD_NIGHT_SECONDS = 60;
const WORLD_CYCLE_SECONDS = WORLD_DAY_SECONDS + WORLD_NIGHT_SECONDS;
const WORLD_DAY_FRACTION = WORLD_DAY_SECONDS / WORLD_CYCLE_SECONDS;
const WORLD_START_PROGRESS = 0.18;
const worldCycleStartedAt =
  Date.now() - WORLD_START_PROGRESS * WORLD_CYCLE_SECONDS * 1000;

function getWorldTimeState() {
  const elapsedSeconds =
    ((Date.now() - worldCycleStartedAt) / 1000) %
    WORLD_CYCLE_SECONDS;
  const progress = elapsedSeconds / WORLD_CYCLE_SECONDS;

  return {
    progress: Math.round(progress * 10000) / 10000,
    isNight: progress >= WORLD_DAY_FRACTION,
    cycleSeconds: WORLD_CYCLE_SECONDS,
    dayFraction: WORLD_DAY_FRACTION
  };
}

const GEAR_TYPES = ['axe', 'pickaxe', 'knife', 'bow', 'arrow', 'armor'];
const WEAPON_TYPES = new Set(['axe', 'pickaxe', 'knife', 'bow']);
const CRAFT_LEVELS = [1, 2, 3, 4];
const ARROWS_PER_CRAFT = 10;

const CRAFT_RECIPES = {
  1: { wood: 5 },
  2: { ore1: 3, impHeart: 1 },
  3: { ore2: 3, impHeart: 2 },
  4: { ore3: 3, impHeart: 3 }
};

const ARMOR_HP_BONUS = {
  1: 10,
  2: 20,
  3: 30,
  4: 40
};

const FEED_TYPES = new Set(['beefFeed', 'wolfFeed', 'tigerFeed']);

const FEED_RECIPES = {
  beefFeed: { wildMeat: 1, wheat: 1 },
  wolfFeed: { wildMeat: 1, wolfGrass: 1 },
  tigerFeed: { wildMeat: 1, tigerGrass: 1 }
};

const BOAT_TYPE = 'boat';
const BOAT_RECIPE = { wood: 10 };

const PLANT_TYPES = new Set(['wheat', 'wolfGrass', 'tigerGrass']);
const MAX_PLANTS = 160;
const PLANT_SPAWN_INTERVAL = 10000;
const WOLF_GRASS_ISLANDS = [0, 2];
const TIGER_GRASS_ISLANDS = [1, 3];

const WILD_ANIMAL_TYPES = new Set(['cow', 'wolf', 'tiger']);
const FEED_BY_SPECIES = {
  cow: 'beefFeed',
  wolf: 'wolfFeed',
  tiger: 'tigerFeed'
};
const FEED_REQUIRED = 3;
const CAPTURE_HP_RATIO = 0.2;
const CAPTURE_CHANCE = 0.5;
const CAPTURE_RANGE = 8;

const PET_POTENTIAL_RANGES = {
  cow: {
    attack: [0.5, 0.8],
    hp: [2, 5],
    speed: [1, 4]
  },
  wolf: {
    attack: [1, 1.4],
    hp: [2, 3],
    speed: [4, 8]
  },
  tiger: {
    attack: [1, 2],
    hp: [1, 6],
    speed: [1, 6]
  }
};

// 宠物/坐骑基础值。宠物攻击每 2 秒一次，伤害取整。
const PET_INITIAL_ATTACK = {
  cow: 4,
  wolf: 6,
  tiger: 8
};
const PET_INITIAL_MOUNT_SPEED = {
  cow: 45,
  wolf: 70,
  tiger: 90
};
const PET_ATTACK_INTERVAL = 2000;
const PET_ATTACK_TARGET_TYPES = new Set(['imp', 'cow', 'wolf', 'tiger']);
const PET_XP_BASE = 50;
const PET_XP_STEP = 30;
const PET_MAX_LEVEL = 50;
const COMPANION_TICK_MS = 100;
const COMPANION_FOLLOW_DAMP = 7;

const TRADE_RANGE = 10;
const TRADE_REQUEST_TIMEOUT = 30000;
const TRADE_MAX_ITEM_KINDS = 20;

// 场景常量需要与 index.html 保持一致。
const WORLD_LIMIT = 260;
const ISLAND_TOP_Y = 6.2;
const ISLAND_MAX_RADIUS = 46;
const PLAYER_LAND_Y = ISLAND_TOP_Y + 0.76;
const SWIM_SURFACE_Y = 1.16;
const TERRAIN_OFFSET = 0.025;
const TERRAIN_RELIEF = 1.05;
const TELEPORT_RANGE = 3.5;
const DOCK_RANGE = 52;
const TELEPORT_ARRIVAL_RADIUS = 2.8;
const IMP_AGGRO_RANGE = 15;
const IMP_LEASH_RADIUS = 44;
const NIGHT_IMP_TARGET_PER_ISLAND = 2;
const IMP_SPAWN_INTERVAL = 5000;
const WILDLIFE_TARGET_PER_ISLAND = 2;
const WILDLIFE_SPAWN_INTERVAL = 6000;
const NEUTRAL_DEAGGRO_RANGE = 20;
const NEUTRAL_DEAGGRO_MS = 5000;
const NEUTRAL_RETURN_HEAL_RATIO = 0.15;

const MELEE_ATTACK_RANGE = 3.5;
const MELEE_ATTACK_CONE_DOT = 0.35;
const BOW_MIN_RANGE = 12;
const BOW_MAX_RANGE = 25;
const BOW_MIN_DAMAGE_MULTIPLIER = 0.5;
const BOW_MAX_DAMAGE_MULTIPLIER = 1.7;
const ATTACK_COOLDOWN_MS = 240;

const RANGED_HIT_RADII = {
  tree: 0.95,
  ore: 0.95,
  ore2: 1.05,
  ore3: 1.15,
  cow: 1.0,
  wolf: 0.9,
  tiger: 1.15,
  imp: 0.75
};

const ORE_LEVEL_BY_TYPE = {
  ore: 1,
  ore2: 2,
  ore3: 3,
  ore4: 4
};

function chaikinClosed(points, iterations) {
  let result = points.map((point) => [point[0], point[1]]);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [];
    for (let i = 0; i < result.length; i += 1) {
      const current = result[i];
      const following = result[(i + 1) % result.length];
      next.push([
        current[0] * 0.75 + following[0] * 0.25,
        current[1] * 0.75 + following[1] * 0.25
      ]);
      next.push([
        current[0] * 0.25 + following[0] * 0.75,
        current[1] * 0.25 + following[1] * 0.75
      ]);
    }
    result = next;
  }

  return result;
}

function createCrescentPolygon() {
  const outerRadius = 34;
  const innerRadius = 24;
  const innerOffset = 20;
  const intersectionX =
    (outerRadius * outerRadius -
      innerRadius * innerRadius +
      innerOffset * innerOffset) /
    (2 * innerOffset);
  const intersectionZ = Math.sqrt(
    outerRadius * outerRadius - intersectionX * intersectionX
  );
  const outerAngle = Math.atan2(intersectionZ, intersectionX);
  const innerAngle = Math.atan2(
    intersectionZ,
    intersectionX - innerOffset
  );
  const points = [];

  for (let i = 0; i <= 80; i += 1) {
    const angle =
      outerAngle + ((Math.PI * 2 - outerAngle * 2) * i) / 80;
    points.push([
      Math.cos(angle) * outerRadius,
      Math.sin(angle) * outerRadius
    ]);
  }

  for (let i = 1; i < 60; i += 1) {
    const angle =
      Math.PI * 2 -
      innerAngle -
      ((Math.PI * 2 - innerAngle * 2) * i) / 60;
    points.push([
      innerOffset + Math.cos(angle) * innerRadius,
      Math.sin(angle) * innerRadius
    ]);
  }

  return points;
}

function createLongPolygon() {
  const points = [];
  for (let i = 0; i < 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    points.push([
      Math.cos(angle) * 46,
      Math.sin(angle) * 14 + Math.sin(angle * 2 + 0.3) * 4
    ]);
  }
  return points;
}

function createCloverPolygon() {
  const points = [];
  for (let i = 0; i < 120; i += 1) {
    const angle = (i / 120) * Math.PI * 2;
    const radius =
      35 *
      (0.62 +
        0.3 * Math.cos(angle * 3) +
        0.06 * Math.cos(angle + 0.8));
    points.push([
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    ]);
  }
  return points;
}

function createRoundedTrianglePolygon() {
  const radius = 38;
  const base = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = -Math.PI / 2 + (i / 3) * Math.PI * 2;
    base.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return chaikinClosed(base, 4);
}

function scalePolygon(points, factor) {
  return points.map(([x, z]) => [x * factor, z * factor]);
}

const ISLAND_SHAPE_DATA = [
  {
    land: createCrescentPolygon(),
    towerX: -14,
    towerZ: 0
  },
  {
    land: createLongPolygon(),
    towerX: 0,
    towerZ: 0
  },
  {
    land: createCloverPolygon(),
    towerX: 0,
    towerZ: 0
  },
  {
    land: createRoundedTrianglePolygon(),
    towerX: 0,
    towerZ: 0
  }
].map((shape) => ({
  ...shape,
  beach: scalePolygon(shape.land, 1.1)
}));

const ISLANDS = [
  { x: -120, z: -128 },
  { x: 124, z: -108 },
  { x: 156, z: 152 },
  { x: -156, z: 160 }
].map((island, index) => ({
  ...island,
  ...ISLAND_SHAPE_DATA[index]
}));
const HOME_ISLAND_INDEX = 0;

function pointInPolygon(x, z, points) {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const zi = points[i][1];
    const xj = points[j][0];
    const zj = points[j][1];

    if (
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInIslandLand(island, x, z) {
  return pointInPolygon(x - island.x, z - island.z, island.land);
}

function pointInIslandBeach(island, x, z) {
  return pointInPolygon(x - island.x, z - island.z, island.beach);
}

function distanceToPolygonEdge(x, z, points) {
  let minimum = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const lengthSquared = abx * abx + abz * abz;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((x - a[0]) * abx + (z - a[1]) * abz) / lengthSquared
            )
          )
        : 0;
    const closestX = a[0] + abx * t;
    const closestZ = a[1] + abz * t;
    minimum = Math.min(
      minimum,
      Math.hypot(x - closestX, z - closestZ)
    );
  }

  return minimum;
}

function randomPointInIsland(island, margin = 3) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  island.land.forEach(([x, z]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  });

  for (let attempt = 0; attempt < 260; attempt += 1) {
    const x = minX + Math.random() * (maxX - minX);
    const z = minZ + Math.random() * (maxZ - minZ);
    if (
      pointInPolygon(x, z, island.land) &&
      distanceToPolygonEdge(x, z, island.land) >= margin
    ) {
      return { x: island.x + x, z: island.z + z };
    }
  }

  return {
    x: island.x + island.towerX,
    z: island.z + island.towerZ
  };
}

function isOnIslandGround(x, z) {
  return ISLANDS.some((island) => pointInIslandLand(island, x, z));
}

function smoothstepNumber(value, min, max) {
  if (value <= min) {
    return 0;
  }
  if (value >= max) {
    return 1;
  }

  const t = (value - min) / (max - min);
  return t * t * (3 - 2 * t);
}

function islandTerrainNoise(seed, x, z) {
  return (
    Math.sin(x * 0.17 + seed * 1.3) * 0.22 +
    Math.cos(z * 0.21 - seed * 0.8) * 0.16 +
    Math.sin((x + z) * 0.09 + seed * 2.1) * 0.1
  );
}

function getIslandGroundHeightAt(x, z) {
  for (let i = 0; i < ISLANDS.length; i += 1) {
    const island = ISLANDS[i];
    if (!pointInIslandLand(island, x, z)) {
      continue;
    }

    const localX = x - island.x;
    const localZ = z - island.z;
    const seed = island.phase * 1.7 + island.x * 0.03;
    const edgeDistance = distanceToPolygonEdge(
      localX,
      localZ,
      island.land
    );
    const edgeFade = smoothstepNumber(edgeDistance, 0, 5.5);
    const towerDistance = Math.hypot(
      localX - island.towerX,
      localZ - island.towerZ
    );
    const towerFade = clamp(
      (towerDistance - 1.5) / 4.5,
      0,
      1
    );

    return (
      ISLAND_TOP_Y +
      TERRAIN_OFFSET +
      islandTerrainNoise(seed, localX, localZ) *
        TERRAIN_RELIEF *
        edgeFade *
        towerFade
    );
  }

  return null;
}

function isOutsideIslandRanges(x, z) {
  return ISLANDS.every((island) => !pointInIslandBeach(island, x, z));
}

function getNearestTowerInfo(x, z) {
  let nearest = null;

  ISLANDS.forEach((island, index) => {
    const towerX = island.x + island.towerX;
    const towerZ = island.z + island.towerZ;
    const distance = Math.hypot(x - towerX, z - towerZ);

    if (!nearest || distance < nearest.distance) {
      nearest = { index, island, distance, towerX, towerZ };
    }
  });

  return nearest;
}

const ENTITY_TYPES = {
  tree: {
    label: '树木',
    maxHp: 20,
    xp: 10
  },
  ore: {
    label: '1级矿',
    maxHp: 30,
    xp: 30
  },
  ore2: {
    label: '2级矿',
    maxHp: 40,
    xp: 40
  },
  ore3: {
    label: '3级矿',
    maxHp: 50,
    xp: 50
  },
  cow: {
    label: '牛',
    maxHp: 60,
    xp: 40,
    damage: 8,
    speed: 2.2,
    biteRange: 2.8,
    biteCooldown: 2300
  },
  wolf: {
    label: '狼',
    maxHp: 80,
    xp: 60,
    damage: 12,
    speed: 3.1,
    biteRange: 2.6,
    biteCooldown: 1900
  },
  tiger: {
    label: '虎',
    maxHp: 100,
    xp: 80,
    damage: 18,
    speed: 3.5,
    biteRange: 2.8,
    biteCooldown: 1700
  },
  imp: {
    label: '小鬼',
    maxHp: 50,
    xp: 50,
    damage: 50,
    speed: 3.4,
    biteRange: 2.6,
    biteCooldown: 2000
  }
};

const PLAYER_COLORS = [
  '#4ea8ff',
  '#ffc247',
  '#b777ff',
  '#45e4a0',
  '#ff7bd5',
  '#3ee6ff',
  '#ff9f5a',
  '#9cff6b'
];

const ENTITY_DROP_TYPES = {
  tree: 'wood',
  ore: 'ore1',
  ore2: 'ore2',
  ore3: 'ore3',
  cow: 'wildMeat',
  wolf: 'wildMeat',
  tiger: 'wildMeat',
  imp: 'impHeart'
};

const ITEM_TYPES = {
  wood: '木头',
  ore1: '1级矿',
  ore2: '2级矿',
  ore3: '3级矿',
  impHeart: '鬼心',
  wildMeat: '野生肉',
  wheat: '小麦',
  wolfGrass: '狼草',
  tigerGrass: '虎草',
  beefFeed: '牛饲料',
  wolfFeed: '狼饲料',
  tigerFeed: '虎饲料',
  boat: '小船'
};

const GEAR_LABELS = {
  axe: '斧头',
  pickaxe: '镐子',
  knife: '刀',
  bow: '弓',
  arrow: '箭',
  armor: '防具'
};

const PICKUP_RANGE = 8;

const players = new Map();
const entities = new Map();
const companions = new Map();
const trades = new Map();
const pendingTradeRequests = new Map();
const drops = new Map();

let nextPlayerNumber = 1;
let nextEntityNumber = 1;
let nextDropNumber = 1;
let nextPetNumber = 1;
let nextTradeNumber = 1;
let lastImpTick = Date.now();
let lastImpSpawnAt = 0;
let lastWildlifeSpawnAt = 0;

function createEmptyInventory() {
  const inventory = {};

  Object.keys(ITEM_TYPES).forEach((type) => {
    inventory[type] = 0;
  });

  return inventory;
}

function createEmptyGear() {
  return {
    axe: [],
    pickaxe: [],
    knife: [],
    bow: [],
    armor: []
  };
}

function createEmptyArrows() {
  return {
    1: 0,
    2: 0,
    3: 0,
    4: 0
  };
}

function cloneGear(gear) {
  const result = {};

  GEAR_TYPES.forEach((type) => {
    if (type === 'arrow') {
      return;
    }
    result[type] = Array.isArray(gear[type]) ? [...gear[type]] : [];
  });

  return result;
}

function getHighestArrowLevel(player) {
  for (let level = CRAFT_LEVELS.length; level >= 1; level -= 1) {
    if ((player.arrows[level] || 0) > 0) {
      return level;
    }
  }

  return 0;
}

function getEquipmentState(player) {
  return {
    equipped: { ...player.equipped },
    gear: cloneGear(player.gear),
    arrows: { ...player.arrows }
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getXpToNextLevel(level) {
  if (level >= PLAYER_MAX_LEVEL) {
    return 0;
  }

  return level * XP_PER_LEVEL;
}

function getPublicPlayer(player) {
  return {
    id: player.id,
    color: player.color,
    x: player.x,
    y: player.y,
    z: player.z,
    hp: player.hp,
    maxHp: player.maxHp,
    xp: player.xp,
    xpToNext: getXpToNextLevel(player.level),
    level: player.level,
    moveSpeed: player.moveSpeed,
    rotation: player.rotation,
    isSailing: Boolean(player.isSailing),
    isSwimming: Boolean(player.isSwimming),
    isGrounded: Boolean(player.isGrounded),
    trading: Boolean(player.trading),
    alive: player.alive,
    equipped: { ...player.equipped }
  };
}

function isWeakWildAnimal(entity) {
  return (
    WILD_ANIMAL_TYPES.has(entity.type) &&
    entity.hp > 0 &&
    entity.hp / entity.maxHp < CAPTURE_HP_RATIO
  );
}

function getCaptureState(entity) {
  return {
    id: entity.id,
    type: entity.type,
    hp: entity.hp,
    maxHp: entity.maxHp,
    feedCount: entity.feedCount || 0,
    feedRequired: FEED_REQUIRED,
    capturable: Boolean(entity.capturable),
    weak: isWeakWildAnimal(entity),
    feedType: FEED_BY_SPECIES[entity.type] || null
  };
}

function getPublicEntity(entity) {
  return {
    id: entity.id,
    type: entity.type,
    islandIndex: entity.islandIndex,
    x: entity.x,
    y: entity.y,
    z: entity.z,
    hp: entity.hp,
    maxHp: entity.maxHp,
    ...getCaptureState(entity)
  };
}

function randomDecimal(min, max, digits = 2) {
  const factor = 10 ** digits;
  return (
    Math.floor((min + Math.random() * (max - min)) * factor) / factor
  );
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getPetXpToNext(level) {
  return PET_XP_BASE + Math.max(0, level - 1) * PET_XP_STEP;
}

function clonePet(pet) {
  return {
    ...pet,
    potential: { ...pet.potential }
  };
}

function createPet(species, ownerId) {
  const ranges = PET_POTENTIAL_RANGES[species];
  const pet = {
    id: `pet_${nextPetNumber}`,
    ownerId,
    species,
    level: 1,
    xp: 0,
    xpToNext: getPetXpToNext(1),
    potential: {
      attack: randomDecimal(ranges.attack[0], ranges.attack[1], 2),
      hp: randomInteger(ranges.hp[0], ranges.hp[1]),
      speed: randomInteger(ranges.speed[0], ranges.speed[1])
    },
    createdAt: new Date().toISOString()
  };

  nextPetNumber += 1;
  return pet;
}

function getPetById(player, petId) {
  if (!player || !petId) {
    return null;
  }
  return player.pets.find((pet) => pet.id === petId) || null;
}

function getActivePet(player, role) {
  if (!player) {
    return null;
  }
  const id = role === 'mount' ? player.summonedMountId : player.summonedPetId;
  return getPetById(player, id);
}

function getMountSpeedBonus(pet) {
  if (!pet) {
    return 0;
  }
  return (
    (PET_INITIAL_MOUNT_SPEED[pet.species] || 0) +
    pet.level * (pet.potential.speed || 0)
  );
}

function refreshPlayerMoveSpeed(player) {
  if (!player) {
    return 0;
  }
  const mount = getActivePet(player, 'mount');
  const bonus = getMountSpeedBonus(mount);
  const normalSpeed = player.baseMoveSpeed + bonus;
  player.moveSpeed = player.isSailing ? normalSpeed * 2 : normalSpeed;
  return bonus;
}

function getPetAttackDamage(pet) {
  if (!pet) {
    return 1;
  }
  return Math.max(
    1,
    Math.round(
      (PET_INITIAL_ATTACK[pet.species] || 1) +
        pet.level * (pet.potential.attack || 0)
    )
  );
}

function getPublicCompanion(companion) {
  const player = players.get(companion.playerId);
  const pet = player ? getPetById(player, companion.petId) : null;

  if (!player || !pet) {
    return null;
  }

  return {
    id: companion.id,
    playerId: companion.playerId,
    role: companion.role,
    petId: companion.petId,
    species: pet.species,
    level: pet.level,
    x: Math.round(companion.x * 100) / 100,
    y: Math.round(companion.y * 100) / 100,
    z: Math.round(companion.z * 100) / 100,
    attacking: Date.now() < companion.attackingUntil,
    targetId: companion.targetId
  };
}

function getPublicCompanions() {
  return Array.from(companions.values())
    .map(getPublicCompanion)
    .filter(Boolean);
}

function emitPetsUpdated(player) {
  if (!player || !player.socketId) {
    return;
  }

  const mount = getActivePet(player, 'mount');
  io.to(player.socketId).emit('petsUpdated', {
    pets: player.pets.map(clonePet),
    activePetId: player.summonedPetId,
    activeMountId: player.summonedMountId,
    moveSpeed: player.moveSpeed,
    mountSpeedBonus: getMountSpeedBonus(mount)
  });
}

function addPetExperience(pet, amount) {
  if (!pet || pet.level >= PET_MAX_LEVEL) {
    if (pet) {
      pet.xp = 0;
    }
    return 0;
  }

  pet.xp += Math.max(0, Math.round(amount));
  let levelsGained = 0;

  while (pet.level < PET_MAX_LEVEL && pet.xp >= pet.xpToNext) {
    pet.xp -= pet.xpToNext;
    pet.level += 1;
    pet.xpToNext = getPetXpToNext(pet.level);
    levelsGained += 1;
  }

  if (pet.level >= PET_MAX_LEVEL) {
    pet.xp = 0;
  }

  return levelsGained;
}

function grantCompanionExperience(player, amount) {
  if (!player || amount <= 0) {
    return;
  }

  const activePets = [];
  const pet = getActivePet(player, 'pet');
  const mount = getActivePet(player, 'mount');

  if (pet) {
    activePets.push(pet);
  }
  if (mount && mount.id !== pet?.id) {
    activePets.push(mount);
  }

  if (activePets.length === 0) {
    return;
  }

  const shared = Math.max(1, Math.round(amount * 0.5));
  const levelUps = [];

  activePets.forEach((activePet) => {
    const levelsGained = addPetExperience(activePet, shared);
    if (levelsGained > 0) {
      levelUps.push(clonePet(activePet));
    }
  });

  refreshPlayerMoveSpeed(player);
  emitPetsUpdated(player);

  if (levelUps.length > 0 && player.socketId) {
    io.to(player.socketId).emit('companionLevelUp', {
      pets: levelUps,
      moveSpeed: player.moveSpeed,
      mountSpeedBonus: getMountSpeedBonus(getActivePet(player, 'mount'))
    });
  }
}

function getCompanionId(playerId, role) {
  return `${playerId}:${role}`;
}

function summonCompanion(player, role, petId) {
  const pet = getPetById(player, petId);

  if (!pet) {
    return { ok: false, reason: '你没有这只宠物' };
  }

  const activeKey = role === 'mount' ? 'summonedMountId' : 'summonedPetId';
  const otherKey = role === 'mount' ? 'summonedPetId' : 'summonedMountId';
  const otherLabel = role === 'mount' ? '宠物' : '坐骑';

  if (player[otherKey] === pet.id) {
    return {
      ok: false,
      reason: `该宠物已经作为${otherLabel}召唤，不能同时承担两个位置`
    };
  }

  if (player[activeKey] === pet.id) {
    emitPetsUpdated(player);
    return { ok: true, unchanged: true };
  }

  removeCompanion(player.id, role);
  player[activeKey] = pet.id;

  const companion = createCompanionRuntime(player, role, pet);
  companions.set(companion.id, companion);

  refreshPlayerMoveSpeed(player);
  emitPetsUpdated(player);
  schedulePlayerSave(player);

  const publicCompanion = getPublicCompanion(companion);
  if (publicCompanion) {
    io.emit('companionSummoned', publicCompanion);
  }

  console.log(
    `玩家 ${player.id} 召唤${role === 'mount' ? '坐骑' : '宠物'} ` +
      `${pet.id}（${ENTITY_TYPES[pet.species].label} Lv.${pet.level}）`
  );

  return { ok: true, pet };
}

function recallCompanion(player, role) {
  const activeKey = role === 'mount' ? 'summonedMountId' : 'summonedPetId';
  const currentId = player[activeKey];

  if (currentId) {
    player[activeKey] = null;
    removeCompanion(player.id, role);
    refreshPlayerMoveSpeed(player);
    console.log(
      `玩家 ${player.id} 收回了${role === 'mount' ? '坐骑' : '宠物'}`
    );
  }

  emitPetsUpdated(player);
  schedulePlayerSave(player);
  return { ok: true };
}

function createCompanionRuntime(player, role, pet) {
  const angle = Number(player.rotation) || 0;
  const back = role === 'pet' ? 2.25 : 1.65;
  const side = role === 'pet' ? -0.9 : 0.9;
  const x =
    player.x -
    Math.sin(angle) * back +
    Math.cos(angle) * side;
  const z =
    player.z -
    Math.cos(angle) * back -
    Math.sin(angle) * side;

  return {
    id: getCompanionId(player.id, role),
    playerId: player.id,
    role,
    petId: pet.id,
    x,
    y: player.y + 0.06,
    z,
    targetId: null,
    nextAttackAt: 0,
    attackingUntil: 0
  };
}

function removeCompanion(playerId, role) {
  const id = getCompanionId(playerId, role);
  if (companions.delete(id)) {
    io.emit('companionRemoved', { id });
  }
}

function getNearestIslandInfo(x, z) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  ISLANDS.forEach((island, index) => {
    const distance = Math.hypot(x - island.x, z - island.z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { index, island, distance };
    }
  });

  return nearest;
}

function snapCompanionsToPlayer(player) {
  Array.from(companions.values()).forEach((companion) => {
    if (companion.playerId !== player.id) {
      return;
    }

    const angle = Number(player.rotation) || 0;
    const back = companion.role === 'pet' ? 2.25 : 1.65;
    const side = companion.role === 'pet' ? -0.9 : 0.9;
    companion.x =
      player.x -
      Math.sin(angle) * back +
      Math.cos(angle) * side;
    companion.z =
      player.z -
      Math.cos(angle) * back -
      Math.sin(angle) * side;
    companion.y = player.y + 0.06;
    companion.targetId = null;
  });
}

function broadcastPlayerSailing(player) {
  io.emit('playerSailing', {
    id: player.id,
    isSailing: Boolean(player.isSailing),
    isSwimming: Boolean(player.isSwimming),
    moveSpeed: player.moveSpeed
  });
}

function isTradeableItemType(item) {
  return Object.prototype.hasOwnProperty.call(ITEM_TYPES, item);
}

function cloneTradeOffers(offers) {
  const result = {};
  Object.keys(offers || {}).forEach((playerId) => {
    result[playerId] = { ...(offers[playerId] || {}) };
  });
  return result;
}

function getPlayerTrade(player) {
  return player && player.trading ? trades.get(player.trading) : null;
}

function getOtherTradePlayer(trade, playerId) {
  return players.get(trade.aId === playerId ? trade.bId : trade.aId);
}

function getTradePayload(trade) {
  return {
    id: trade.id,
    aId: trade.aId,
    bId: trade.bId,
    offers: cloneTradeOffers(trade.offers),
    locked: { ...trade.locked },
    confirmed: { ...trade.confirmed },
    verified: Boolean(trade.verified),
    status: trade.status
  };
}

function emitTradeUpdated(trade) {
  const playerA = players.get(trade.aId);
  const playerB = players.get(trade.bId);
  const payload = getTradePayload(trade);

  if (playerA && playerA.socketId) {
    io.to(playerA.socketId).emit('tradeUpdated', payload);
  }
  if (playerB && playerB.socketId) {
    io.to(playerB.socketId).emit('tradeUpdated', payload);
  }
}

function validateTradeOffers(trade) {
  const playerA = players.get(trade.aId);
  const playerB = players.get(trade.bId);

  if (!playerA || !playerB) {
    return { ok: false, reason: '交易双方已不在线' };
  }

  for (const [playerId, player] of [
    [trade.aId, playerA],
    [trade.bId, playerB]
  ]) {
    const offer = trade.offers[playerId] || {};
    const entries = Object.entries(offer);

    if (entries.length > TRADE_MAX_ITEM_KINDS) {
      return { ok: false, reason: '交易物品种类过多' };
    }

    for (const [item, amount] of entries) {
      if (!isTradeableItemType(item)) {
        return { ok: false, reason: '交易中包含未知物品' };
      }
      if (
        !Number.isInteger(amount) ||
        amount <= 0 ||
        amount > 999999
      ) {
        return { ok: false, reason: '交易物品数量无效' };
      }
      if ((player.inventory[item] || 0) < amount) {
        return {
          ok: false,
          reason: `${player.id} 的 ${ITEM_TYPES[item]} 数量不足`
        };
      }
    }
  }

  return { ok: true };
}

function cancelTrade(trade, reason, byId = null) {
  if (!trade || trade.status !== 'active') {
    return;
  }

  trade.status = 'cancelled';
  trades.delete(trade.id);

  const playerA = players.get(trade.aId);
  const playerB = players.get(trade.bId);

  if (playerA && playerA.trading === trade.id) {
    playerA.trading = null;
  }
  if (playerB && playerB.trading === trade.id) {
    playerB.trading = null;
  }

  [playerA, playerB].forEach((player) => {
    if (player && player.socketId) {
      io.to(player.socketId).emit('tradeCancelled', {
        tradeId: trade.id,
        reason,
        by: byId
      });
    }
  });

  console.log(`交易 ${trade.id} 已取消：${reason}`);
}

function completeTrade(trade) {
  const validation = validateTradeOffers(trade);

  if (!validation.ok) {
    cancelTrade(trade, validation.reason, null);
    return;
  }

  const playerA = players.get(trade.aId);
  const playerB = players.get(trade.bId);

  if (!playerA || !playerB) {
    cancelTrade(trade, '交易双方已不在线', null);
    return;
  }

  const inventoryA = { ...playerA.inventory };
  const inventoryB = { ...playerB.inventory };
  const offerA = trade.offers[trade.aId] || {};
  const offerB = trade.offers[trade.bId] || {};

  Object.entries(offerA).forEach(([item, amount]) => {
    inventoryA[item] -= amount;
    inventoryB[item] = (inventoryB[item] || 0) + amount;
  });

  Object.entries(offerB).forEach(([item, amount]) => {
    inventoryB[item] -= amount;
    inventoryA[item] = (inventoryA[item] || 0) + amount;
  });

  playerA.inventory = inventoryA;
  playerB.inventory = inventoryB;
  playerA.trading = null;
  playerB.trading = null;
  schedulePlayerSave(playerA);
  schedulePlayerSave(playerB);
  trade.status = 'completed';
  trades.delete(trade.id);

  [
    [playerA, playerB, offerB, offerA],
    [playerB, playerA, offerA, offerB]
  ].forEach(([receiver, giver, received, given]) => {
    if (!receiver || !receiver.socketId) {
      return;
    }

    io.to(receiver.socketId).emit('inventoryUpdated', {
      inventory: { ...receiver.inventory }
    });

    io.to(receiver.socketId).emit('tradeCompleted', {
      tradeId: trade.id,
      partnerId: giver ? giver.id : null,
      inventory: { ...receiver.inventory },
      received,
      given
    });
  });

  console.log(
    `交易 ${trade.id} 完成：${playerA.id} 与 ${playerB.id} 已互换物品`
  );
}

function clearPendingTradeRequest(targetId, requesterMessage = null) {
  const pending = pendingTradeRequests.get(targetId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingTradeRequests.delete(targetId);

  const requester = players.get(pending.fromId);
  const target = players.get(targetId);

  if (requester && requester.socketId && requesterMessage) {
    io.to(requester.socketId).emit('tradeRequestExpired', {
      targetId,
      reason: requesterMessage
    });
  }
  if (target && target.socketId) {
    io.to(target.socketId).emit('tradeRequestExpired', {
      fromId: pending.fromId,
      reason: '交易请求已失效'
    });
  }
}

function clearPendingRequestsInvolving(playerId) {
  Array.from(pendingTradeRequests.entries()).forEach(([targetId, pending]) => {
    if (targetId === playerId || pending.fromId === playerId) {
      clearPendingTradeRequest(targetId, '对方已离开，交易请求取消');
    }
  });
}

function handleEntityDeath(entity) {
  if (!entity || entity.hp > 0 || !entities.has(entity.id)) {
    return;
  }

  entities.delete(entity.id);

  const killerId = entity.lastAttackerId;
  const killer = killerId ? players.get(killerId) : null;
  let killerXp = null;

  if (killer) {
    const xpResult = grantExperience(killer, entity.xp);
    killerXp = killer.xp;

    io.to(killer.socketId).emit('xpGained', {
      amount: entity.xp,
      xp: killer.xp,
      totalXp: killer.xp,
      xpToNext: getXpToNextLevel(killer.level),
      level: killer.level,
      maxHp: killer.maxHp,
      moveSpeed: killer.moveSpeed,
      entityId: entity.id,
      entityType: entity.type,
      leveledUp: xpResult.leveledUp
    });
  }

  io.emit('entityDied', {
    id: entity.id,
    type: entity.type,
    xp: entity.xp,
    killedBy: killer ? killer.id : null,
    killerXp
  });

  const dropType = ENTITY_DROP_TYPES[entity.type];
  const drop = {
    id: `drop_${nextDropNumber}`,
    type: dropType,
    x: entity.x,
    y: entity.y + 0.55,
    z: entity.z,
    sourceEntityId: entity.id,
    createdAt: Date.now()
  };

  nextDropNumber += 1;
  drops.set(drop.id, drop);

  io.emit('dropSpawned', getPublicDrop(drop));

  console.log(
    `实体 ${entity.id}（${ENTITY_TYPES[entity.type].label}）死亡，` +
      `${killer ? `玩家 ${killer.id} 获得 ${entity.xp} 经验` : '没有玩家获得经验'}，` +
      `掉落 ${ITEM_TYPES[drop.type]}`
  );
}

function tryPetAutoAttack(companion, player, now = Date.now()) {
  if (
    !companion ||
    companion.role !== 'pet' ||
    !player ||
    !player.alive ||
    !companion.targetId ||
    now < companion.nextAttackAt
  ) {
    return false;
  }

  const entity = entities.get(companion.targetId);
  const pet = getPetById(player, companion.petId);

  if (!entity || entity.hp <= 0 || !pet) {
    companion.targetId = null;
    return false;
  }

  if (!PET_ATTACK_TARGET_TYPES.has(entity.type)) {
    companion.targetId = null;
    return false;
  }

  const damage = getPetAttackDamage(pet);
  entity.hp = clamp(entity.hp - damage, 0, entity.maxHp);
  entity.lastAttackerId = player.id;

  if (entity.hp > 0) {
    enrageNeutral(entity, player.id);
  }

  companion.nextAttackAt = now + PET_ATTACK_INTERVAL;
  companion.attackingUntil = now + 480;

  io.emit('entityUpdated', {
    id: entity.id,
    type: entity.type,
    hp: entity.hp,
    maxHp: entity.maxHp,
    damage,
    attackerId: player.id,
    petAttack: true,
    petId: pet.id,
    ...getCaptureState(entity)
  });

  io.emit('companionAttack', {
    id: companion.id,
    playerId: player.id,
    petId: pet.id,
    species: pet.species,
    targetId: entity.id,
    damage,
    x: Math.round(companion.x * 100) / 100,
    y: Math.round(companion.y * 100) / 100,
    z: Math.round(companion.z * 100) / 100
  });

  console.log(
    `宠物 ${pet.id}（${ENTITY_TYPES[pet.species].label}）自动攻击 ` +
      `${entity.id}，造成 ${damage} 点伤害`
  );

  if (entity.hp <= 0) {
    companion.targetId = null;
    handleEntityDeath(entity);
  }

  return true;
}

function updateCompanions(deltaSeconds) {
  const now = Date.now();
  const blend = 1 - Math.exp(-COMPANION_FOLLOW_DAMP * deltaSeconds);

  Array.from(companions.values()).forEach((companion) => {
    const player = players.get(companion.playerId);
    const pet = player ? getPetById(player, companion.petId) : null;

    if (!player || !pet) {
      companions.delete(companion.id);
      io.emit('companionRemoved', { id: companion.id });
      return;
    }

    const angle = Number(player.rotation) || 0;
    const back = companion.role === 'pet' ? 2.25 : 1.65;
    const side = companion.role === 'pet' ? -0.9 : 0.9;
    const targetX =
      player.x -
      Math.sin(angle) * back +
      Math.cos(angle) * side;
    const targetZ =
      player.z -
      Math.cos(angle) * back -
      Math.sin(angle) * side;

    companion.x += (targetX - companion.x) * blend;
    companion.z += (targetZ - companion.z) * blend;
    companion.y += (player.y + 0.06 - companion.y) * blend;

    if (companion.role === 'pet' && player.alive) {
      tryPetAutoAttack(companion, player, now);
    } else if (!player.alive) {
      companion.targetId = null;
    }
  });

  if (companions.size > 0) {
    io.emit('companionsMoved', getPublicCompanions());
  }
}

function getPublicDrop(drop) {
  return {
    id: drop.id,
    type: drop.type,
    x: drop.x,
    y: drop.y,
    z: drop.z
  };
}

function getRandomPlayerSpawn() {
  const island = ISLANDS[HOME_ISLAND_INDEX];
  const towerX = island.x + island.towerX;
  const towerZ = island.z + island.towerZ;
  let point = randomPointInIsland(island, 7);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (Math.hypot(point.x - towerX, point.z - towerZ) > 5) {
      break;
    }
    point = randomPointInIsland(island, 7);
  }

  return {
    x: clamp(point.x, -WORLD_LIMIT, WORLD_LIMIT),
    y: PLAYER_LAND_Y,
    z: clamp(point.z, -WORLD_LIMIT, WORLD_LIMIT)
  };
}

function pickEntityPosition(island, occupiedPositions) {
  const towerX = island.x + island.towerX;
  const towerZ = island.z + island.towerZ;

  for (let attempt = 0; attempt < 260; attempt += 1) {
    const point = randomPointInIsland(island, 2.2);
    const tooClose = occupiedPositions.some((position) => {
      return Math.hypot(position.x - point.x, position.z - point.z) < 2.6;
    });
    const tooCloseToTower =
      Math.hypot(point.x - towerX, point.z - towerZ) < 4.5;

    if (!tooClose && !tooCloseToTower) {
      return point;
    }
  }

  // 极端情况下也保证能返回一个落在陆地内的位置。
  const fallback = randomPointInIsland(island, 0.5);
  return fallback;
}

const WILDLIFE_BY_ISLAND = [
  ['cow', 'cow'],
  ['wolf', 'wolf'],
  ['tiger', 'cow'],
  ['cow', 'tiger']
];

function createEntityInstance(type, islandIndex, position) {
  const definition = ENTITY_TYPES[type];
  const isNeutralWildlife = WILD_ANIMAL_TYPES.has(type);

  return {
    id: `entity_${nextEntityNumber}`,
    type,
    islandIndex,
    x: position.x,
    y: ISLAND_TOP_Y,
    z: position.z,
    spawnX: position.x,
    spawnZ: position.z,
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    xp: definition.xp,
    feedCount: 0,
    capturable: false,
    lastAttackerId: null,
    lastBiteAt: 0,
    aiState:
      type === 'imp'
        ? 'hunt'
        : isNeutralWildlife
          ? 'wander'
          : 'idle',
    targetPlayerId: null,
    outOfRangeSince: 0,
    wanderTargetX: position.x,
    wanderTargetZ: position.z,
    wanderNextAt: 0
  };
}

function getOccupiedIslandPositions(islandIndex) {
  return Array.from(entities.values())
    .filter((entity) => entity.islandIndex === islandIndex)
    .map((entity) => ({ x: entity.x, z: entity.z }));
}

function spawnWorldEntity(type, islandIndex) {
  const island = ISLANDS[islandIndex];
  if (!island) {
    return null;
  }

  const position = pickEntityPosition(
    island,
    getOccupiedIslandPositions(islandIndex)
  );
  const entity = createEntityInstance(type, islandIndex, position);

  nextEntityNumber += 1;
  entities.set(entity.id, entity);
  io.emit('entitySpawned', getPublicEntity(entity));

  return entity;
}

function clearNightImps(reason = '天亮') {
  const imps = Array.from(entities.values()).filter(
    (entity) => entity.type === 'imp'
  );

  if (imps.length === 0) {
    return;
  }

  imps.forEach((entity) => {
    entities.delete(entity.id);
    io.emit('entityDied', {
      id: entity.id,
      type: entity.type,
      xp: 0,
      killedBy: null,
      despawned: true,
      reason
    });
  });

  console.log(`${reason}，强制清除地图上的 ${imps.length} 只小鬼`);
}

function syncNightImps(now = Date.now(), force = false) {
  const worldTime = getWorldTimeState();

  if (!worldTime.isNight) {
    lastImpSpawnAt = 0;
    clearNightImps('天亮');
    return;
  }

  if (!force && now - lastImpSpawnAt < IMP_SPAWN_INTERVAL) {
    return;
  }

  lastImpSpawnAt = now;

  ISLANDS.forEach((island, islandIndex) => {
    const currentImps = Array.from(entities.values()).filter(
      (entity) =>
        entity.type === 'imp' && entity.islandIndex === islandIndex
    ).length;

    for (
      let count = currentImps;
      count < NIGHT_IMP_TARGET_PER_ISLAND;
      count += 1
    ) {
      const entity = spawnWorldEntity('imp', islandIndex);
      if (entity) {
        console.log(
          `夜色降临，${island.name || `岛屿${islandIndex + 1}`} 刷新小鬼 ${entity.id}`
        );
      }
    }
  });
}

function syncWildlifeSpawns(now = Date.now()) {
  if (now - lastWildlifeSpawnAt < WILDLIFE_SPAWN_INTERVAL) {
    return;
  }

  lastWildlifeSpawnAt = now;
  const worldTime = getWorldTimeState();
  // 白天刷新野生生物的概率更高，夜里也仍有机会刷新。
  const spawnChance = worldTime.isNight ? 0.35 : 0.8;

  ISLANDS.forEach((island, islandIndex) => {
    const currentWildlife = Array.from(entities.values()).filter(
      (entity) =>
        entity.islandIndex === islandIndex &&
        WILD_ANIMAL_TYPES.has(entity.type)
    ).length;

    if (currentWildlife >= WILDLIFE_TARGET_PER_ISLAND) {
      return;
    }

    if (Math.random() > spawnChance) {
      return;
    }

    const types = WILDLIFE_BY_ISLAND[islandIndex] || ['cow'];
    const type = types[Math.floor(Math.random() * types.length)];
    const entity = spawnWorldEntity(type, islandIndex);

    if (entity) {
      console.log(
        `野生生物刷新：${island.name || `岛屿${islandIndex + 1}`} ` +
          `${ENTITY_TYPES[type].label} ${entity.id}`
      );
    }
  });
}

function generateEntities() {
  entities.clear();
  nextEntityNumber = 1;

  // 树木和矿物永久存在；小鬼只在夜间动态刷新；牛狼虎初始各岛 2 只。
  const layout = ['tree', 'tree', 'tree', 'ore', 'ore2', 'ore3'];

  ISLANDS.forEach((island, islandIndex) => {
    const occupiedPositions = [];
    const islandLayout = layout.concat(
      WILDLIFE_BY_ISLAND[islandIndex] || []
    );

    islandLayout.forEach((type) => {
      const position = pickEntityPosition(island, occupiedPositions);
      occupiedPositions.push(position);

      const entity = createEntityInstance(type, islandIndex, position);
      nextEntityNumber += 1;
      entities.set(entity.id, entity);
    });
  });

  const counts = {
    tree: 0,
    ore: 0,
    ore2: 0,
    ore3: 0,
    imp: 0,
    cow: 0,
    wolf: 0,
    tiger: 0
  };

  entities.forEach((entity) => {
    counts[entity.type] += 1;
  });

  console.log(
    `场景实体生成完毕：树木 ${counts.tree}、1级矿 ${counts.ore}、` +
      `2级矿 ${counts.ore2}、3级矿 ${counts.ore3}、` +
      `牛 ${counts.cow}、狼 ${counts.wolf}、虎 ${counts.tiger}`
  );

  // 如果服务器恰好在夜间启动，立即补刷小鬼。
  syncNightImps(Date.now(), true);
}

function countPlants() {
  let count = 0;

  drops.forEach((drop) => {
    if (PLANT_TYPES.has(drop.type)) {
      count += 1;
    }
  });

  return count;
}

function spawnGroundPlant(type) {
  let x;
  let y;
  let z;

  if (type === 'wheat' && Math.random() < 0.42) {
    const islandIndex = Math.floor(Math.random() * ISLANDS.length);
    const island = ISLANDS[islandIndex];
    const point = randomPointInIsland(island, 2.2);

    x = point.x;
    y = ISLAND_TOP_Y + 0.35;
    z = point.z;
  } else {
    const islandIndex =
      type === 'wolfGrass'
        ? WOLF_GRASS_ISLANDS[
            Math.floor(Math.random() * WOLF_GRASS_ISLANDS.length)
          ]
        : type === 'tigerGrass'
          ? TIGER_GRASS_ISLANDS[
              Math.floor(Math.random() * TIGER_GRASS_ISLANDS.length)
            ]
          : -1;

    if (islandIndex !== -1) {
      const island = ISLANDS[islandIndex];
      const point = randomPointInIsland(island, 2.2);

      x = point.x;
      y = ISLAND_TOP_Y + 0.35;
      z = point.z;
    } else {
      // 小麦可以漂在海面上，避开岛屿和沙滩轮廓。
      let attempts = 0;

      do {
        x = (Math.random() * 2 - 1) * (WORLD_LIMIT - 12);
        z = (Math.random() * 2 - 1) * (WORLD_LIMIT - 12);
        attempts += 1;
      } while (attempts < 40 && !isOutsideIslandRanges(x, z));

      y = 0.75;
    }
  }

  const drop = {
    id: `drop_${nextDropNumber}`,
    type,
    x,
    y,
    z,
    source: 'plant',
    createdAt: Date.now()
  };

  nextDropNumber += 1;
  drops.set(drop.id, drop);
  io.emit('dropSpawned', getPublicDrop(drop));
}

function spawnPlants() {
  const available = MAX_PLANTS - countPlants();

  if (available <= 0) {
    return;
  }

  const planned = ['wheat', 'wheat', 'wolfGrass', 'tigerGrass'];

  planned.slice(0, available).forEach((type) => {
    spawnGroundPlant(type);
  });

  console.log(
    `植物刷新：小麦、狼草、虎草；当前地面植物 ${countPlants()}/${MAX_PLANTS}`
  );
}

function damagePlayer(player, damage, sourceEntityId) {
  if (!player || !player.alive) {
    return;
  }

  player.hp = clamp(player.hp - damage, 0, player.maxHp);
  schedulePlayerSave(player);

  io.emit('playerHealth', {
    id: player.id,
    hp: player.hp,
    maxHp: player.maxHp,
    damage,
    sourceEntityId,
    alive: player.hp > 0
  });

  console.log(
    `玩家 ${player.id} 受到 ${damage} 点伤害，剩余血量 ${player.hp}/${player.maxHp}`
  );

  if (player.hp > 0) {
    return;
  }

  player.alive = false;
  player.respawnAt = Date.now() + PLAYER_RESPAWN_DELAY;
  resetPlayerVertical(player, player.groundY);

  const activeTrade = getPlayerTrade(player);
  if (activeTrade) {
    cancelTrade(
      activeTrade,
      `${player.id} 已倒下，交易取消`,
      player.id
    );
  }

  console.log(
    `玩家 ${player.id} 被击倒，${PLAYER_RESPAWN_DELAY / 1000} 秒后复苏`
  );

  setTimeout(() => {
    respawnPlayer(player.id);
  }, PLAYER_RESPAWN_DELAY);
}

function resetPlayerVertical(player, y = player.y) {
  if (!player) {
    return;
  }

  player.groundY = clamp(toFiniteNumber(y, player.y), 0, 30);
  player.y = player.groundY;
  player.isGrounded = true;
  player.jumpOffset = 0;
  player.verticalVelocity = 0;
}

function respawnPlayer(playerId) {
  const player = players.get(playerId);

  if (!player || player.alive) {
    return;
  }

  const spawn = getRandomPlayerSpawn();

  player.x = spawn.x;
  player.y = spawn.y;
  player.z = spawn.z;
  resetPlayerVertical(player, spawn.y);
  player.isSwimming = false;
  player.hp = player.maxHp;
  player.alive = true;
  player.respawnAt = 0;

  const playerSocket = io.sockets.sockets.get(player.socketId);
  if (playerSocket) {
    playerSocket.emit('respawn', {
      x: player.x,
      y: player.y,
      z: player.z,
      hp: player.hp,
      maxHp: player.maxHp
    });
  }

  io.emit('playerHealth', {
    id: player.id,
    hp: player.hp,
    maxHp: player.maxHp,
    damage: 0,
    sourceEntityId: null,
    alive: true
  });

  io.emit('playerMoved', {
    id: player.id,
    color: player.color,
    x: player.x,
    y: player.y,
    z: player.z,
    isGrounded: true,
    isSwimming: false
  });

  schedulePlayerSave(player);

  console.log(`玩家 ${player.id} 已复苏`);
}

function getEntityHome(entity, island) {
  return {
    x: Number.isFinite(entity.spawnX) ? entity.spawnX : island.x,
    z: Number.isFinite(entity.spawnZ) ? entity.spawnZ : island.z
  };
}

function moveEntityToward(
  entity,
  island,
  targetX,
  targetZ,
  speed,
  deltaTime,
  stopDistance
) {
  const deltaX = targetX - entity.x;
  const deltaZ = targetZ - entity.z;
  const horizontalDistance = Math.hypot(deltaX, deltaZ);

  if (horizontalDistance > stopDistance) {
    const step = Math.min(
      speed * deltaTime,
      horizontalDistance - stopDistance
    );
    const nextX = entity.x + (deltaX / horizontalDistance) * step;
    const nextZ = entity.z + (deltaZ / horizontalDistance) * step;

    if (pointInIslandLand(island, nextX, nextZ)) {
      entity.x = nextX;
      entity.z = nextZ;
    } else if (pointInIslandLand(island, nextX, entity.z)) {
      entity.x = nextX;
    } else if (pointInIslandLand(island, entity.x, nextZ)) {
      entity.z = nextZ;
    }
  }

  const entityGroundY = getIslandGroundHeightAt(
    entity.x,
    entity.z
  );
  const targetY = Number.isFinite(entityGroundY)
    ? entityGroundY
    : SWIM_SURFACE_Y;
  entity.y += (targetY - entity.y) * Math.min(1, deltaTime * 2.8);
}

function startNeutralReturn(entity) {
  if (!WILD_ANIMAL_TYPES.has(entity.type) || entity.hp <= 0) {
    return;
  }

  if (entity.aiState !== 'return') {
    const healAmount = Math.max(
      4,
      Math.ceil(entity.maxHp * NEUTRAL_RETURN_HEAL_RATIO)
    );
    entity.hp = clamp(entity.hp + healAmount, 0, entity.maxHp);

    io.emit('entityUpdated', {
      id: entity.id,
      type: entity.type,
      hp: entity.hp,
      maxHp: entity.maxHp,
      damage: 0,
      attackerId: null,
      ...getCaptureState(entity)
    });

    console.log(
      `${ENTITY_TYPES[entity.type].label} ${entity.id} 脱战，返回出生点并恢复 ${healAmount} 点生命`
    );
  }

  entity.aiState = 'return';
  entity.targetPlayerId = null;
  entity.outOfRangeSince = 0;
  entity.lastBiteAt = 0;
}

function enrageNeutral(entity, playerId) {
  if (
    !entity ||
    entity.hp <= 0 ||
    !WILD_ANIMAL_TYPES.has(entity.type)
  ) {
    return;
  }

  const target = players.get(playerId);
  if (!target || !target.alive) {
    return;
  }

  entity.aiState = 'combat';
  entity.targetPlayerId = playerId;
  entity.outOfRangeSince = 0;
  entity.lastBiteAt = 0;
  entity.lastAttackerId = playerId;

  console.log(
    `${ENTITY_TYPES[entity.type].label} ${entity.id} 被玩家 ${playerId} 攻击，进入战斗`
  );
}

function updateImpAI(entity, island, now, deltaTime, movedEntities) {
  const definition = ENTITY_TYPES.imp;
  const home = getEntityHome(entity, island);
  let target = entity.targetPlayerId
    ? players.get(entity.targetPlayerId)
    : null;

  if (
    target &&
    (!target.alive ||
      !pointInIslandLand(island, target.x, target.z))
  ) {
    target = null;
    entity.targetPlayerId = null;
  }

  // 只有玩家进入 15 码索敌范围时才锁定；锁定后不会因短暂离开而立刻失去目标。
  if (!target) {
    let nearestPlayer = null;
    let nearestDistance = IMP_AGGRO_RANGE;

    players.forEach((player) => {
      if (!player.alive) {
        return;
      }

      const distance = Math.hypot(
        player.x - entity.x,
        player.z - entity.z
      );

      if (
        distance <= nearestDistance &&
        pointInIslandLand(island, player.x, player.z)
      ) {
        nearestDistance = distance;
        nearestPlayer = player;
      }
    });

    if (nearestPlayer) {
      target = nearestPlayer;
      entity.targetPlayerId = nearestPlayer.id;
      entity.aiState = 'hunt';
    }
  }

  const distanceFromTower = Math.hypot(
    entity.x - (island.x + island.towerX),
    entity.z - (island.z + island.towerZ)
  );

  if (
    target &&
    (!target.alive ||
      distanceFromTower > IMP_LEASH_RADIUS ||
      !pointInIslandLand(island, target.x, target.z))
  ) {
    target = null;
    entity.targetPlayerId = null;
  }

  const targetX = target ? target.x : home.x;
  const targetZ = target ? target.z : home.z;
  const stopDistance = target ? definition.biteRange : 0.8;
  const oldX = entity.x;
  const oldY = entity.y;
  const oldZ = entity.z;

  moveEntityToward(
    entity,
    island,
    targetX,
    targetZ,
    definition.speed,
    deltaTime,
    stopDistance
  );

  if (
    Math.abs(entity.x - oldX) > 0.001 ||
    Math.abs(entity.y - oldY) > 0.001 ||
    Math.abs(entity.z - oldZ) > 0.001
  ) {
    movedEntities.push({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      z: entity.z
    });
  }

  if (!target) {
    return;
  }

  const distance = Math.hypot(
    target.x - entity.x,
    target.z - entity.z
  );
  const verticalGap = Math.abs(target.y - entity.y);

  if (
    distance <= definition.biteRange &&
    verticalGap <= 4.5 &&
    now - entity.lastBiteAt >= definition.biteCooldown
  ) {
    entity.lastBiteAt = now;
    console.log(`小鬼 ${entity.id} 咬了玩家 ${target.id}`);
    damagePlayer(target, definition.damage, entity.id);
  }
}

function updateWildlifeAI(entity, island, now, deltaTime, movedEntities) {
  const definition = ENTITY_TYPES[entity.type];
  const home = getEntityHome(entity, island);
  const oldX = entity.x;
  const oldY = entity.y;
  const oldZ = entity.z;
  let target = entity.targetPlayerId
    ? players.get(entity.targetPlayerId)
    : null;

  if (entity.aiState === 'combat') {
    if (!target || !target.alive) {
      startNeutralReturn(entity);
    } else {
      const distance = Math.hypot(
        target.x - entity.x,
        target.z - entity.z
      );

      if (distance > NEUTRAL_DEAGGRO_RANGE) {
        if (!entity.outOfRangeSince) {
          entity.outOfRangeSince = now;
        }

        if (now - entity.outOfRangeSince >= NEUTRAL_DEAGGRO_MS) {
          startNeutralReturn(entity);
        }
      } else {
        entity.outOfRangeSince = 0;
      }

      if (entity.aiState === 'combat') {
        moveEntityToward(
          entity,
          island,
          target.x,
          target.z,
          definition.speed,
          deltaTime,
          definition.biteRange
        );

        const currentDistance = Math.hypot(
          target.x - entity.x,
          target.z - entity.z
        );
        const verticalGap = Math.abs(target.y - entity.y);

        if (
          currentDistance <= definition.biteRange &&
          verticalGap <= 4.5 &&
          now - entity.lastBiteAt >= definition.biteCooldown
        ) {
          entity.lastBiteAt = now;
          console.log(
            `${definition.label} ${entity.id} 反击玩家 ${target.id}`
          );
          damagePlayer(target, definition.damage, entity.id);
        }
      }
    }
  }

  if (entity.aiState === 'return') {
    moveEntityToward(
      entity,
      island,
      home.x,
      home.z,
      definition.speed * 0.55,
      deltaTime,
      1.1
    );

    if (
      Math.hypot(entity.x - home.x, entity.z - home.z) <= 1.4
    ) {
      entity.aiState = 'wander';
      entity.wanderTargetX = home.x;
      entity.wanderTargetZ = home.z;
      entity.wanderNextAt = now + 1500 + Math.random() * 2500;
    }
  } else if (entity.aiState === 'wander') {
    const wanderDistance = Math.hypot(
      entity.x - entity.wanderTargetX,
      entity.z - entity.wanderTargetZ
    );

    if (
      now >= entity.wanderNextAt ||
      wanderDistance <= 1.2
    ) {
      const point = randomPointInIsland(island, 2.2);
      entity.wanderTargetX = point.x;
      entity.wanderTargetZ = point.z;
      entity.wanderNextAt =
        now + 3500 + Math.random() * 4500;
    }

    moveEntityToward(
      entity,
      island,
      entity.wanderTargetX,
      entity.wanderTargetZ,
      definition.speed * 0.35,
      deltaTime,
      0.8
    );
  }

  if (
    Math.abs(entity.x - oldX) > 0.001 ||
    Math.abs(entity.y - oldY) > 0.001 ||
    Math.abs(entity.z - oldZ) > 0.001
  ) {
    movedEntities.push({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      z: entity.z
    });
  }
}

function updateCreatures() {
  const now = Date.now();
  const deltaTime = Math.min((now - lastImpTick) / 1000, 0.5);
  lastImpTick = now;

  if (deltaTime <= 0) {
    return;
  }

  syncNightImps(now);
  syncWildlifeSpawns(now);

  const movedEntities = [];

  entities.forEach((entity) => {
    const island = ISLANDS[entity.islandIndex];
    if (!island || entity.hp <= 0) {
      return;
    }

    if (entity.type === 'imp') {
      updateImpAI(entity, island, now, deltaTime, movedEntities);
    } else if (WILD_ANIMAL_TYPES.has(entity.type)) {
      updateWildlifeAI(entity, island, now, deltaTime, movedEntities);
    }
  });

  if (movedEntities.length > 0) {
    io.emit('entitiesMoved', movedEntities);
  }
}

function getAttackDirection(player, data) {
  let directionX = Number(data && data.direction && data.direction.x);
  let directionZ = Number(data && data.direction && data.direction.z);

  if (
    !Number.isFinite(directionX) ||
    !Number.isFinite(directionZ) ||
    Math.hypot(directionX, directionZ) < 0.001
  ) {
    const rotation = Number.isFinite(Number(data && data.rotation))
      ? Number(data.rotation)
      : Number(player.rotation) || 0;
    directionX = Math.sin(rotation);
    directionZ = Math.cos(rotation);
  }

  const length = Math.hypot(directionX, directionZ) || 1;
  return {
    x: directionX / length,
    z: directionZ / length
  };
}

function findMeleeAttackTarget(player, direction) {
  let bestEntity = null;
  let bestDistance = MELEE_ATTACK_RANGE;

  entities.forEach((entity) => {
    if (!entity || entity.hp <= 0) {
      return;
    }

    const deltaX = entity.x - player.x;
    const deltaZ = entity.z - player.z;
    const distance = Math.hypot(deltaX, deltaZ);

    if (distance <= 0.001 || distance > MELEE_ATTACK_RANGE) {
      return;
    }

    const facing =
      (deltaX * direction.x + deltaZ * direction.z) / distance;

    if (facing < MELEE_ATTACK_CONE_DOT) {
      return;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      bestEntity = entity;
    }
  });

  return bestEntity;
}

function findRangedAttackTarget(player, direction, range) {
  let bestEntity = null;
  let bestDistance = range;

  entities.forEach((entity) => {
    if (!entity || entity.hp <= 0) {
      return;
    }

    const deltaX = entity.x - player.x;
    const deltaZ = entity.z - player.z;
    const along = deltaX * direction.x + deltaZ * direction.z;

    if (along <= 0 || along > range) {
      return;
    }

    const perpendicular = Math.abs(
      deltaX * direction.z - deltaZ * direction.x
    );
    const hitRadius = RANGED_HIT_RADII[entity.type] || 0.8;

    if (perpendicular > hitRadius) {
      return;
    }

    if (along < bestDistance) {
      bestDistance = along;
      bestEntity = entity;
    }
  });

  return bestEntity;
}

function getWeaponAttack(player, entity) {
  const weapon = player.equipped.type;
  const gearLevel = clamp(
    Math.floor(toFiniteNumber(player.equipped.level, 1)),
    1,
    4
  );
  const isOre =
    entity.type === 'ore' ||
    entity.type === 'ore2' ||
    entity.type === 'ore3';

  const isCreature =
    entity.type === 'imp' ||
    entity.type === 'cow' ||
    entity.type === 'wolf' ||
    entity.type === 'tiger';

  if (weapon === 'axe' && entity.type === 'tree') {
    return { damage: gearLevel * 3, arrowLevelUsed: 0 };
  }

  if (weapon === 'pickaxe' && isOre) {
    return { damage: gearLevel * 3, arrowLevelUsed: 0 };
  }

  // 当前可攻击目标里，小鬼、牛、狼、虎属于“生物”；玩家 PvP 还没有接入。
  if (weapon === 'knife' && isCreature) {
    return { damage: gearLevel * 10, arrowLevelUsed: 0 };
  }

  if (weapon === 'bow' && isCreature) {
    const arrowLevel = getHighestArrowLevel(player);

    // 弓必须配箭，没有箭时退回空手伤害。
    if (arrowLevel <= 0) {
      return { damage: 1, arrowLevelUsed: 0 };
    }

    player.arrows[arrowLevel] -= 1;

    return {
      damage: 20 + (gearLevel - 1) * 15 + arrowLevel * 3,
      arrowLevelUsed: arrowLevel
    };
  }

  return { damage: 1, arrowLevelUsed: 0 };
}

function grantExperience(player, amount) {
  if (!player || player.level >= PLAYER_MAX_LEVEL) {
    player.xp = 0;
    return {
      leveledUp: false,
      levelsGained: 0
    };
  }

  const awarded = Math.max(0, Math.floor(amount));
  player.xp += awarded;

  let levelsGained = 0;

  while (
    player.level < PLAYER_MAX_LEVEL &&
    player.xp >= getXpToNextLevel(player.level)
  ) {
    player.xp -= getXpToNextLevel(player.level);
    player.level += 1;
    player.maxHp += PLAYER_HEALTH_PER_LEVEL;
    player.baseMoveSpeed += PLAYER_SPEED_PER_LEVEL;
    player.hp = player.maxHp;
    levelsGained += 1;
  }

  refreshPlayerMoveSpeed(player);

  if (player.level >= PLAYER_MAX_LEVEL) {
    player.xp = 0;
  }

  if (levelsGained > 0) {
    io.emit('playerHealth', {
      id: player.id,
      hp: player.hp,
      maxHp: player.maxHp,
      damage: 0,
      sourceEntityId: null,
      alive: player.alive
    });

    io.emit('playerLevelUp', {
      id: player.id,
      level: player.level,
      levelsGained,
      hp: player.hp,
      maxHp: player.maxHp,
      moveSpeed: player.moveSpeed,
      xp: player.xp,
      xpToNext: getXpToNextLevel(player.level)
    });

    console.log(
      `玩家 ${player.id} 升到了 Lv.${player.level}，` +
        `血量上限 ${player.maxHp}，移速 ${player.moveSpeed}`
    );
  }

  grantCompanionExperience(player, awarded);
  schedulePlayerSave(player);

  return {
    leveledUp: levelsGained > 0,
    levelsGained
  };
}

const playerSaveTimers = new Map();
const playerSaveQueues = new Map();
const pendingPlayerUids = new Set();

function normalizePlayerUid(rawUid) {
  const value = String(rawUid || '').trim();

  if (/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
    return value;
  }

  return crypto.randomUUID();
}

function getPlayerDataPath(uid) {
  return path.join(PLAYER_DATA_DIR, `${uid}.json`);
}

async function ensurePlayerDataDir() {
  await fsp.mkdir(PLAYER_DATA_DIR, { recursive: true });
}

function sanitizeStoredNumber(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return clamp(number, min, max);
}

function sanitizeStoredInventory(rawInventory) {
  const source =
    rawInventory && typeof rawInventory === 'object' ? rawInventory : {};
  const inventory = createEmptyInventory();

  Object.keys(ITEM_TYPES).forEach((item) => {
    inventory[item] = sanitizeStoredNumber(
      source[item],
      0,
      999999,
      0
    );
  });

  return inventory;
}

function sanitizeStoredGear(rawGear) {
  const source = rawGear && typeof rawGear === 'object' ? rawGear : {};
  const gear = createEmptyGear();

  ['axe', 'pickaxe', 'knife', 'bow', 'armor'].forEach((type) => {
    const levels = Array.isArray(source[type]) ? source[type] : [];
    gear[type] = Array.from(
      new Set(
        levels
          .map((level) => Math.floor(Number(level)))
          .filter((level) => CRAFT_LEVELS.includes(level))
      )
    ).sort((a, b) => a - b);
  });

  return gear;
}

function sanitizeStoredArrows(rawArrows) {
  const source = rawArrows && typeof rawArrows === 'object' ? rawArrows : {};
  const arrows = createEmptyArrows();

  [1, 2, 3, 4].forEach((level) => {
    arrows[level] = sanitizeStoredNumber(
      source[level],
      0,
      999999,
      0
    );
  });

  return arrows;
}

function sanitizeStoredEquipped(rawEquipped, gear) {
  const source =
    rawEquipped && typeof rawEquipped === 'object' ? rawEquipped : {};
  const type = String(source.type || 'unarmed');
  const level = Math.floor(Number(source.level) || 0);

  if (
    WEAPON_TYPES.has(type) &&
    Array.isArray(gear[type]) &&
    gear[type].includes(level)
  ) {
    return { type, level };
  }

  return { type: 'unarmed', level: 0 };
}

function sanitizeStoredPets(rawPets, ownerId) {
  const source = Array.isArray(rawPets) ? rawPets : [];
  const pets = [];
  const usedIds = new Set();

  source.slice(0, 100).forEach((rawPet) => {
    if (!rawPet || typeof rawPet !== 'object') {
      return;
    }

    const id = String(rawPet.id || '');
    const species = String(rawPet.species || '');
    if (
      !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
      usedIds.has(id) ||
      !WILD_ANIMAL_TYPES.has(species)
    ) {
      return;
    }

    const level = sanitizeStoredNumber(
      rawPet.level,
      1,
      PET_MAX_LEVEL,
      1
    );
    const potential =
      rawPet.potential && typeof rawPet.potential === 'object'
        ? rawPet.potential
        : {};
    const attack = clamp(Number(potential.attack) || 0, 0, 20);
    const hp = sanitizeStoredNumber(potential.hp, 0, 100, 0);
    const speed = sanitizeStoredNumber(potential.speed, 0, 100, 0);

    usedIds.add(id);
    pets.push({
      id,
      ownerId,
      species,
      level,
      xp: sanitizeStoredNumber(rawPet.xp, 0, 999999, 0),
      xpToNext: getPetXpToNext(level),
      potential: {
        attack: Math.round(attack * 100) / 100,
        hp,
        speed
      },
      createdAt:
        typeof rawPet.createdAt === 'string'
          ? rawPet.createdAt
          : new Date().toISOString()
    });
  });

  return pets;
}

function applyStoredPlayerData(player, storedRecord) {
  const saved =
    storedRecord && storedRecord.player && typeof storedRecord.player === 'object'
      ? storedRecord.player
      : null;

  if (!saved) {
    player.maxHp = PLAYER_MAX_HEALTH;
    player.hp = PLAYER_MAX_HEALTH;
    player.baseMoveSpeed = PLAYER_BASE_MOVE_SPEED;
    player.moveSpeed = PLAYER_BASE_MOVE_SPEED;
    return;
  }

  const level = sanitizeStoredNumber(
    saved.level,
    1,
    PLAYER_MAX_LEVEL,
    1
  );
  player.level = level;
  player.xp = sanitizeStoredNumber(
    saved.xp,
    0,
    Math.max(0, getXpToNextLevel(level) - 1),
    0
  );
  player.gear = sanitizeStoredGear(saved.gear);
  player.arrows = sanitizeStoredArrows(saved.arrows);
  player.inventory = sanitizeStoredInventory(saved.inventory);
  player.equipped = sanitizeStoredEquipped(saved.equipped, player.gear);
  player.pets = sanitizeStoredPets(saved.pets, player.id);

  const armorBonus = (player.gear.armor || []).reduce(
    (total, armorLevel) => total + (ARMOR_HP_BONUS[armorLevel] || 0),
    0
  );
  player.maxHp =
    PLAYER_MAX_HEALTH +
    (level - 1) * PLAYER_HEALTH_PER_LEVEL +
    armorBonus;
  player.hp = sanitizeStoredNumber(
    saved.hp,
    0,
    player.maxHp,
    player.maxHp
  );
  if (player.hp <= 0) {
    player.hp = player.maxHp;
  }

  player.baseMoveSpeed =
    PLAYER_BASE_MOVE_SPEED + (level - 1) * PLAYER_SPEED_PER_LEVEL;

  const wantedPetId = String(saved.summonedPetId || '');
  const wantedMountId = String(saved.summonedMountId || '');
  const petIds = new Set(player.pets.map((pet) => pet.id));
  player.summonedPetId = petIds.has(wantedPetId) ? wantedPetId : null;
  player.summonedMountId =
    petIds.has(wantedMountId) && wantedMountId !== player.summonedPetId
      ? wantedMountId
      : null;

  player.isSailing =
    Boolean(saved.isSailing) && (player.inventory.boat || 0) > 0;

  if (
    typeof saved.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(saved.color)
  ) {
    player.color = saved.color;
  } else {
    const savedColor = Number(saved.color);
    if (
      Number.isInteger(savedColor) &&
      savedColor >= 0 &&
      savedColor <= 0xffffff
    ) {
      player.color = savedColor;
    }
  }

  const x = Number(saved.x);
  const y = Number(saved.y);
  const z = Number(saved.z);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    player.x = clamp(x, -WORLD_LIMIT, WORLD_LIMIT);
    player.y = clamp(y, 0, 30);
    player.z = clamp(z, -WORLD_LIMIT, WORLD_LIMIT);
  }

  const rotation = Number(saved.rotation);
  if (Number.isFinite(rotation)) {
    player.rotation = rotation;
  }

  // 旧版小地图存档直接迁回新地图的家园岛，避免落在远海。
  const savedMapVersion = Number(storedRecord.mapVersion) || 0;
  if (savedMapVersion < MAP_VERSION) {
    const spawn = getRandomPlayerSpawn();
    player.x = spawn.x;
    player.z = spawn.z;
    player.y = spawn.y;
  }

  const savedGroundY =
    savedMapVersion < MAP_VERSION
      ? PLAYER_LAND_Y
      : Number(saved.groundY);
  player.groundY = Number.isFinite(savedGroundY)
    ? clamp(savedGroundY, 0, 30)
    : player.y;
  player.y = player.groundY;
  player.isGrounded = true;
  player.isSwimming =
    !player.isSailing && !isOnIslandGround(player.x, player.z);
  player.verticalVelocity = 0;
  player.jumpOffset = 0;
  player.jumpCooldownUntil = 0;

  player.alive = true;
  player.trading = null;
  player.respawnAt = 0;
  refreshPlayerMoveSpeed(player);
}

function serializePlayerForStorage(player) {
  return {
    version: PLAYER_DATA_VERSION,
    mapVersion: MAP_VERSION,
    uid: player.uid,
    savedAt: new Date().toISOString(),
    player: {
      color: player.color,
      x: Math.round(player.x * 100) / 100,
      y: Math.round(player.y * 100) / 100,
      groundY: Math.round(player.groundY * 100) / 100,
      z: Math.round(player.z * 100) / 100,
      rotation: Math.round(player.rotation * 1000) / 1000,
      level: player.level,
      xp: player.xp,
      hp: player.hp,
      maxHp: player.maxHp,
      baseMoveSpeed: player.baseMoveSpeed,
      isSailing: Boolean(player.isSailing),
      inventory: { ...player.inventory },
      gear: cloneGear(player.gear),
      arrows: { ...player.arrows },
      equipped: { ...player.equipped },
      pets: player.pets.map(clonePet),
      summonedPetId: player.summonedPetId,
      summonedMountId: player.summonedMountId
    }
  };
}

async function readStoredPlayer(uid) {
  await ensurePlayerDataDir();

  try {
    const raw = await fsp.readFile(getPlayerDataPath(uid), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    console.error(`读取玩家存档失败 ${uid}:`, error.message);
    return null;
  }
}

async function writePlayerSnapshot(uid, json) {
  await ensurePlayerDataDir();
  const target = getPlayerDataPath(uid);
  const temporary = path.join(
    PLAYER_DATA_DIR,
    `.${uid}.${process.pid}.${Date.now()}.tmp`
  );

  await fsp.writeFile(temporary, json, 'utf8');

  try {
    await fsp.rename(temporary, target);
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EEXIST')) {
      await fsp.rm(target, { force: true });
      await fsp.rename(temporary, target);
    } else {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}

function queuePlayerSave(player) {
  if (!player || !player.uid) {
    return Promise.resolve();
  }

  const uid = player.uid;
  const json = JSON.stringify(serializePlayerForStorage(player), null, 2);
  const previous = playerSaveQueues.get(uid) || Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(() => writePlayerSnapshot(uid, json))
    .catch((error) => {
      console.error(`保存玩家存档失败 ${uid}:`, error.message);
    });

  playerSaveQueues.set(uid, task);
  task.then(() => {
    if (playerSaveQueues.get(uid) === task) {
      playerSaveQueues.delete(uid);
    }
  });

  return task;
}

function schedulePlayerSave(player, immediate = false) {
  if (!player || !player.uid) {
    return Promise.resolve();
  }

  const uid = player.uid;
  const existing = playerSaveTimers.get(uid);

  if (existing) {
    clearTimeout(existing);
    playerSaveTimers.delete(uid);
  }

  if (immediate) {
    return queuePlayerSave(player);
  }

  const timer = setTimeout(() => {
    playerSaveTimers.delete(uid);
    queuePlayerSave(player);
  }, PLAYER_SAVE_DEBOUNCE_MS);
  playerSaveTimers.set(uid, timer);

  return Promise.resolve();
}

async function savePlayerNow(player) {
  if (!player || !player.uid) {
    return;
  }

  const timer = playerSaveTimers.get(player.uid);
  if (timer) {
    clearTimeout(timer);
    playerSaveTimers.delete(player.uid);
  }

  await queuePlayerSave(player);
}

function restoreCompanionsForPlayer(player) {
  ['pet', 'mount'].forEach((role) => {
    const pet = getActivePet(player, role);
    if (!pet) {
      return;
    }

    const companion = createCompanionRuntime(player, role, pet);
    companions.set(companion.id, companion);
  });
}

// 世界 y 不是 0 基准：海面约 1.16、岛面约 4.86。
// 因此重力作用于 jumpOffset（0 表示脚下地面），落地时把 y 恢复到 groundY。
function updateJumpPhysics(deltaSeconds) {
  const delta = clamp(deltaSeconds, 0, 0.05);

  players.forEach((player) => {
    if (player.isGrounded) {
      return;
    }

    if (!player.alive) {
      resetPlayerVertical(player, player.groundY);
      return;
    }

    player.verticalVelocity -= JUMP_GRAVITY * delta;
    player.jumpOffset += player.verticalVelocity * delta;

    let landed = false;

    if (player.jumpOffset <= 0) {
      player.jumpOffset = 0;
      player.verticalVelocity = 0;
      player.y = player.groundY;
      player.isGrounded = true;
      player.isSwimming =
        !player.isSailing && !isOnIslandGround(player.x, player.z);
      player.jumpCooldownUntil = Math.max(
        player.jumpCooldownUntil,
        Date.now() + 120
      );
      landed = true;
    } else {
      player.y = clamp(player.groundY + player.jumpOffset, 0, 30);
    }

    io.emit('playerJumped', {
      id: player.id,
      color: player.color,
      x: player.x,
      y: player.y,
      z: player.z,
      rotation: player.rotation,
      isGrounded: player.isGrounded,
      isSwimming: player.isSwimming,
      jumpOffset: player.jumpOffset,
      verticalVelocity: player.verticalVelocity
    });

    if (landed) {
      schedulePlayerSave(player);
    }
  });
}

io.on('connection', async (socket) => {
  const playerNumber = nextPlayerNumber;
  nextPlayerNumber += 1;

  const playerId = `player_${playerNumber}`;
  const fallbackColor =
    PLAYER_COLORS[(playerNumber - 1) % PLAYER_COLORS.length];

  const auth = socket.handshake.auth || {};
  const playerUid = normalizePlayerUid(auth.playerUid);
  const existingPlayer = Array.from(players.values()).find(
    (player) => player.uid === playerUid
  );

  if (existingPlayer || pendingPlayerUids.has(playerUid)) {
    socket.emit('authError', {
      reason: '这个玩家存档已经在另一个窗口连接'
    });
    socket.disconnect(true);
    return;
  }

  pendingPlayerUids.add(playerUid);

  let storedRecord = null;
  try {
    storedRecord = await readStoredPlayer(playerUid);
  } catch (error) {
    console.error(`载入玩家存档失败 ${playerUid}:`, error.message);
  }

  if (!socket.connected) {
    pendingPlayerUids.delete(playerUid);
    return;
  }

  const fallbackSpawn = getRandomPlayerSpawn();
  const spawnX = clamp(
    toFiniteNumber(auth.x, fallbackSpawn.x),
    -WORLD_LIMIT,
    WORLD_LIMIT
  );
  const spawnY = clamp(
    toFiniteNumber(auth.y, fallbackSpawn.y),
    0,
    30
  );
  const spawnZ = clamp(
    toFiniteNumber(auth.z, fallbackSpawn.z),
    -WORLD_LIMIT,
    WORLD_LIMIT
  );

  const player = {
    id: playerId,
    uid: playerUid,
    socketId: socket.id,
    color: fallbackColor,
    x: spawnX,
    y: spawnY,
    groundY: spawnY,
    isGrounded: true,
    verticalVelocity: 0,
    jumpOffset: 0,
    jumpCooldownUntil: 0,
    z: spawnZ,
    hp: PLAYER_MAX_HEALTH,
    maxHp: PLAYER_MAX_HEALTH,
    xp: 0,
    level: 1,
    baseMoveSpeed: PLAYER_BASE_MOVE_SPEED,
    moveSpeed: PLAYER_BASE_MOVE_SPEED,
    rotation: 0,
    isSailing: false,
    isSwimming: false,
    gear: createEmptyGear(),
    arrows: createEmptyArrows(),
    equipped: {
      type: 'unarmed',
      level: 0
    },
    pets: [],
    summonedPetId: null,
    summonedMountId: null,
    trading: null,
    alive: true,
    inventory: createEmptyInventory(),
    respawnAt: 0,
    connectedAt: new Date().toISOString()
  };

  try {
    applyStoredPlayerData(player, storedRecord);
  } catch (error) {
    console.error(`应用玩家存档失败 ${playerUid}:`, error.message);
  }

  players.set(playerId, player);
  pendingPlayerUids.delete(playerUid);
  socket.data.playerId = playerId;
  restoreCompanionsForPlayer(player);
  schedulePlayerSave(player, !storedRecord);

  console.log('有一个玩家上线了');
  console.log(
    `分配玩家 ID：${playerId}（存档 ${player.uid}${
      storedRecord ? '，已恢复' : '，新存档'
    }）`
  );

  socket.emit('init', {
    id: playerId,
    playerUid: player.uid,
    color: player.color,
    count: players.size,
    worldTime: getWorldTimeState(),
    self: getPublicPlayer(player),
    players: Array.from(players.values())
      .filter((item) => item.id !== playerId)
      .map(getPublicPlayer),
    entities: Array.from(entities.values()).map(getPublicEntity),
    drops: Array.from(drops.values()).map(getPublicDrop),
    inventory: { ...player.inventory },
    gear: cloneGear(player.gear),
    arrows: { ...player.arrows },
    equipped: { ...player.equipped },
    pets: player.pets.map(clonePet),
    activePetId: player.summonedPetId,
    activeMountId: player.summonedMountId,
    mountSpeedBonus: getMountSpeedBonus(getActivePet(player, 'mount')),
    companions: getPublicCompanions()
  });

  socket.broadcast.emit('playerJoined', getPublicPlayer(player));

  Array.from(companions.values())
    .filter((companion) => companion.playerId === player.id)
    .forEach((companion) => {
      const publicCompanion = getPublicCompanion(companion);
      if (publicCompanion) {
        socket.broadcast.emit('companionSummoned', publicCompanion);
      }
    });

  io.emit('onlineCount', players.size);

  socket.on('move', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const position = data && typeof data === 'object' ? data : {};
    const x = clamp(
      toFiniteNumber(position.x, currentPlayer.x),
      -WORLD_LIMIT,
      WORLD_LIMIT
    );
    const requestedY = clamp(
      toFiniteNumber(position.y, currentPlayer.groundY),
      0,
      30
    );
    const z = clamp(
      toFiniteNumber(position.z, currentPlayer.z),
      -WORLD_LIMIT,
      WORLD_LIMIT
    );
    const rotation = toFiniteNumber(
      position.rotation,
      currentPlayer.rotation
    );

    let y = currentPlayer.y;
    const onLand = isOnIslandGround(x, z);
    const landSurface = onLand ? getIslandGroundHeightAt(x, z) : null;

    if (currentPlayer.isGrounded) {
      // 服务端强制贴到真实岛面/水面，避免客户端把 Y 写进地形内部。
      if (!currentPlayer.isSailing && onLand) {
        currentPlayer.groundY = Number.isFinite(landSurface)
          ? landSurface + 0.76
          : PLAYER_LAND_Y;
      } else {
        currentPlayer.groundY = SWIM_SURFACE_Y;
      }
      y = currentPlayer.groundY;
    } else {
      y = currentPlayer.groundY + currentPlayer.jumpOffset;
    }

    currentPlayer.x = x;
    currentPlayer.y = y;
    currentPlayer.z = z;
    currentPlayer.rotation = rotation;
    currentPlayer.isSwimming =
      !currentPlayer.isSailing &&
      currentPlayer.isGrounded &&
      !onLand;

    socket.broadcast.emit('playerMoved', {
      id: playerId,
      color: currentPlayer.color,
      x,
      y,
      z,
      rotation,
      isGrounded: currentPlayer.isGrounded,
      isSwimming: currentPlayer.isSwimming
    });
  });

  socket.on('jump', () => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer) {
      return;
    }

    if (!currentPlayer.alive || currentPlayer.trading || currentPlayer.isSailing) {
      socket.emit('jumpDenied', {
        code: 'blocked',
        reason: '当前状态无法跳跃'
      });
      return;
    }

    if (currentPlayer.isSwimming) {
      socket.emit('jumpDenied', {
        code: 'swimming',
        reason: '游泳时无法跳跃'
      });
      return;
    }

    if (!currentPlayer.isGrounded) {
      socket.emit('jumpDenied', {
        code: 'airborne',
        reason: '只能在落地后再次跳跃'
      });
      return;
    }

    const now = Date.now();
    if (now < currentPlayer.jumpCooldownUntil) {
      socket.emit('jumpDenied', {
        code: 'cooldown',
        reason: '跳跃冷却中'
      });
      return;
    }

    currentPlayer.groundY = currentPlayer.y;
    currentPlayer.jumpOffset = 0;
    currentPlayer.verticalVelocity = JUMP_INITIAL_SPEED;
    currentPlayer.isGrounded = false;
    currentPlayer.jumpCooldownUntil = now + JUMP_COOLDOWN_MS;

    const payload = {
      id: currentPlayer.id,
      color: currentPlayer.color,
      x: currentPlayer.x,
      y: currentPlayer.y,
      z: currentPlayer.z,
      rotation: currentPlayer.rotation,
      isGrounded: false,
      isSwimming: false,
      jumpOffset: 0,
      verticalVelocity: currentPlayer.verticalVelocity
    };

    socket.emit('jumpStarted', payload);
    io.emit('playerJumped', payload);
  });

  socket.on('equip', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const payload =
      data && typeof data === 'object' ? data : { type: data };
    const type = String(payload.type || payload.weapon || '');

    if (type === 'unarmed') {
      currentPlayer.equipped = {
        type: 'unarmed',
        level: 0
      };
    } else {
      const level = clamp(
        Math.floor(toFiniteNumber(payload.level, 1)),
        1,
        4
      );

      if (
        !WEAPON_TYPES.has(type) ||
        !Array.isArray(currentPlayer.gear[type]) ||
        !currentPlayer.gear[type].includes(level)
      ) {
        socket.emit('equipFailed', {
          type,
          level,
          reason: '尚未合成该装备'
        });
        return;
      }

      currentPlayer.equipped = {
        type,
        level
      };
    }

    schedulePlayerSave(currentPlayer);
    socket.emit('equipmentUpdated', getEquipmentState(currentPlayer));

    console.log(
      `玩家 ${playerId} 穿戴 ${currentPlayer.equipped.type} ` +
        `Lv.${currentPlayer.equipped.level}`
    );
  });

  socket.on('board_boat', () => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    if (currentPlayer.isSailing) {
      socket.emit('boatActionResult', {
        success: true,
        action: 'board',
        isSailing: true,
        moveSpeed: currentPlayer.moveSpeed
      });
      return;
    }

    if ((currentPlayer.inventory.boat || 0) <= 0) {
      socket.emit('boatActionResult', {
        success: false,
        action: 'board',
        reason: '背包里没有小船'
      });
      return;
    }

    if (!isOutsideIslandRanges(currentPlayer.x, currentPlayer.z)) {
      socket.emit('boatActionResult', {
        success: false,
        action: 'board',
        reason: '请先离开岛屿范围，到水边再上船'
      });
      return;
    }

    currentPlayer.isSailing = true;
    currentPlayer.isSwimming = false;
    resetPlayerVertical(currentPlayer, currentPlayer.y);
    refreshPlayerMoveSpeed(currentPlayer);
    schedulePlayerSave(currentPlayer);
    broadcastPlayerSailing(currentPlayer);

    socket.emit('boatActionResult', {
      success: true,
      action: 'board',
      isSailing: true,
      moveSpeed: currentPlayer.moveSpeed
    });

    console.log(
      `玩家 ${playerId} 上船，移速 ${currentPlayer.moveSpeed}`
    );
  });

  socket.on('disembark_boat', () => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    if (!currentPlayer.isSailing) {
      socket.emit('boatActionResult', {
        success: false,
        action: 'disembark',
        reason: '当前不在航行状态'
      });
      return;
    }

    const nearest = getNearestIslandInfo(
      currentPlayer.x,
      currentPlayer.z
    );

    if (!nearest || nearest.distance > DOCK_RANGE) {
      socket.emit('boatActionResult', {
        success: false,
        action: 'disembark',
        reason: '需要靠近岛屿边缘才能下船'
      });
      return;
    }

    currentPlayer.isSailing = false;
    currentPlayer.isSwimming = !isOnIslandGround(
      currentPlayer.x,
      currentPlayer.z
    );
    resetPlayerVertical(currentPlayer, currentPlayer.y);
    refreshPlayerMoveSpeed(currentPlayer);
    schedulePlayerSave(currentPlayer);
    broadcastPlayerSailing(currentPlayer);

    socket.emit('boatActionResult', {
      success: true,
      action: 'disembark',
      isSailing: false,
      moveSpeed: currentPlayer.moveSpeed
    });

    console.log(
      `玩家 ${playerId} 下船，移速 ${currentPlayer.moveSpeed}`
    );
  });

  socket.on('teleport', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    if (currentPlayer.isSailing) {
      socket.emit('teleportResult', {
        success: false,
        reason: '航行中无法使用传送塔'
      });
      return;
    }

    const nearest = getNearestTowerInfo(
      currentPlayer.x,
      currentPlayer.z
    );

    if (!nearest || nearest.distance >= TELEPORT_RANGE) {
      socket.emit('teleportResult', {
        success: false,
        reason: '需要靠近岛中心的传送塔'
      });
      return;
    }

    const destination = Math.floor(
      toFiniteNumber(
        data && typeof data === 'object' ? data.destination : data,
        -1
      )
    );

    if (
      destination < 0 ||
      destination >= ISLANDS.length ||
      destination === nearest.index
    ) {
      socket.emit('teleportResult', {
        success: false,
        reason: '请选择另外一座岛'
      });
      return;
    }

    const targetIsland = ISLANDS[destination];
    const targetTowerX = targetIsland.x + targetIsland.towerX;
    const targetTowerZ = targetIsland.z + targetIsland.towerZ;
    const angle = destination * 1.37 + 0.55;
    const x =
      targetTowerX + Math.cos(angle) * TELEPORT_ARRIVAL_RADIUS;
    const z =
      targetTowerZ + Math.sin(angle) * TELEPORT_ARRIVAL_RADIUS;

    currentPlayer.isSailing = false;
    currentPlayer.isSwimming = false;
    currentPlayer.x = x;
    currentPlayer.y = PLAYER_LAND_Y;
    currentPlayer.z = z;
    resetPlayerVertical(currentPlayer, PLAYER_LAND_Y);
    refreshPlayerMoveSpeed(currentPlayer);
    snapCompanionsToPlayer(currentPlayer);
    schedulePlayerSave(currentPlayer);

    io.emit('playerTeleported', {
      id: currentPlayer.id,
      x,
      y: currentPlayer.y,
      z,
      islandIndex: destination,
      isSailing: false,
      isGrounded: true,
      isSwimming: false
    });

    socket.emit('teleportResult', {
      success: true,
      x,
      y: currentPlayer.y,
      z,
      islandIndex: destination,
      destination,
      moveSpeed: currentPlayer.moveSpeed
    });

    if (companions.size > 0) {
      io.emit('companionsMoved', getPublicCompanions());
    }

    console.log(
      `玩家 ${playerId} 从 ${nearest.index + 1} 号岛传送到 ` +
        `${destination + 1} 号岛`
    );
  });

  socket.on('summon_pet', (data = {}) => {
    const currentPlayer = players.get(playerId);
    if (!currentPlayer) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const petId =
      data && typeof data === 'object'
        ? String(data.petId || '')
        : String(data || '');
    const result = summonCompanion(currentPlayer, 'pet', petId);

    if (!result.ok) {
      socket.emit('petActionFailed', {
        action: 'summon_pet',
        reason: result.reason
      });
    }
  });

  socket.on('summon_mount', (data = {}) => {
    const currentPlayer = players.get(playerId);
    if (!currentPlayer) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const petId =
      data && typeof data === 'object'
        ? String(data.petId || '')
        : String(data || '');
    const result = summonCompanion(currentPlayer, 'mount', petId);

    if (!result.ok) {
      socket.emit('petActionFailed', {
        action: 'summon_mount',
        reason: result.reason
      });
    }
  });

  socket.on('recall_pet', () => {
    const currentPlayer = players.get(playerId);
    if (!currentPlayer || currentPlayer.trading) {
      return;
    }
    recallCompanion(currentPlayer, 'pet');
  });

  socket.on('recall_mount', () => {
    const currentPlayer = players.get(playerId);
    if (!currentPlayer || currentPlayer.trading) {
      return;
    }
    recallCompanion(currentPlayer, 'mount');
  });

  socket.on('craft', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const type = String(data.type || '');
    const level = clamp(
      Math.floor(toFiniteNumber(data.level, 1)),
      1,
      4
    );
    const isFeed = FEED_TYPES.has(type);
    const isBoat = type === BOAT_TYPE;
    const recipe = isFeed
      ? FEED_RECIPES[type]
      : isBoat
        ? BOAT_RECIPE
        : CRAFT_RECIPES[level];

    if (
      (!GEAR_TYPES.includes(type) && !isFeed && !isBoat) ||
      (!isFeed && !isBoat && !CRAFT_LEVELS.includes(level)) ||
      !recipe
    ) {
      socket.emit('craftFailed', {
        type,
        level,
        reason: '无效的装备、饲料或船只类型'
      });
      return;
    }

    if (
      !isFeed &&
      !isBoat &&
      type !== 'arrow' &&
      Array.isArray(currentPlayer.gear[type]) &&
      currentPlayer.gear[type].includes(level)
    ) {
      socket.emit('craftFailed', {
        type,
        level,
        reason: '该等级装备已经合成过了'
      });
      return;
    }

    const missing = [];

    Object.entries(recipe).forEach(([material, required]) => {
      const owned = currentPlayer.inventory[material] || 0;
      if (owned < required) {
        missing.push(`${ITEM_TYPES[material]} ${owned}/${required}`);
      }
    });

    if (missing.length > 0) {
      socket.emit('craftFailed', {
        type,
        level,
        reason: `材料不足：${missing.join('、')}`
      });
      return;
    }

    Object.entries(recipe).forEach(([material, required]) => {
      currentPlayer.inventory[material] -= required;
    });

    let amount = 1;
    let armorBonus = 0;

    if (isFeed || isBoat) {
      currentPlayer.inventory[type] =
        (currentPlayer.inventory[type] || 0) + 1;
    } else if (type === 'arrow') {
      amount = ARROWS_PER_CRAFT;
      currentPlayer.arrows[level] =
        (currentPlayer.arrows[level] || 0) + amount;
    } else {
      currentPlayer.gear[type].push(level);

      if (type === 'armor') {
        armorBonus = ARMOR_HP_BONUS[level] || 0;
        currentPlayer.maxHp += armorBonus;
        currentPlayer.hp = Math.min(
          currentPlayer.maxHp,
          currentPlayer.hp + armorBonus
        );

        io.emit('playerHealth', {
          id: currentPlayer.id,
          hp: currentPlayer.hp,
          maxHp: currentPlayer.maxHp,
          damage: 0,
          sourceEntityId: null,
          alive: currentPlayer.alive
        });
      }
    }

    schedulePlayerSave(currentPlayer);

    socket.emit('inventoryUpdated', {
      inventory: { ...currentPlayer.inventory }
    });

    socket.emit('craftSuccess', {
      type,
      level,
      amount,
      armorBonus,
      inventory: { ...currentPlayer.inventory },
      ...getEquipmentState(currentPlayer),
      hp: currentPlayer.hp,
      maxHp: currentPlayer.maxHp
    });

    console.log(
      `玩家 ${playerId} 合成了 ${
        isFeed || isBoat ? ITEM_TYPES[type] : GEAR_LABELS[type]
      }` +
        (isFeed || isBoat ? ` ×${amount}` : ` Lv.${level}`) +
        (type === 'arrow' ? ` ×${amount}` : '') +
        (armorBonus ? `，生命上限 +${armorBonus}` : '')
    );
  });

  socket.on('attack', (data = {}) => {
    console.log(
      '服务端收到攻击请求，目标:',
      data && data.targetId,
      '玩家:',
      socket.id
    );
    console.log('攻击请求数据:', data);

    const attacker = players.get(playerId);

    if (!attacker || !attacker.alive) {
      console.log('攻击失败：玩家不存在或已经倒下');
      return;
    }

    if (attacker.trading) {
      console.log('攻击失败：玩家正在交易');
      return;
    }

    const now = Date.now();
    if (now - (attacker.lastAttackAt || 0) < ATTACK_COOLDOWN_MS) {
      console.log('攻击失败：攻击冷却中');
      return;
    }

    const attackType =
      data && data.type === 'ranged' ? 'ranged' : 'melee';
    const direction = getAttackDirection(attacker, data);
    const charge = clamp(
      Number(data && data.charge) || 0,
      0,
      1
    );

    let entity = null;
    let damage = 0;
    let attackRange = MELEE_ATTACK_RANGE;
    let damageMultiplier = 1;
    const requestedTargetId =
      data && data.targetId ? String(data.targetId) : null;

    if (attackType === 'ranged') {
      if (attacker.equipped.type !== 'bow') {
        console.log('攻击失败：当前武器不是弓');
        return;
      }

      attackRange =
        BOW_MIN_RANGE +
        charge * (BOW_MAX_RANGE - BOW_MIN_RANGE);
      entity = findRangedAttackTarget(
        attacker,
        direction,
        attackRange
      );

      if (requestedTargetId) {
        console.log(
          `前端射线目标提示: ${requestedTargetId}，服务端按射线方向重新选择第一个目标`
        );
      }
    } else {
      if (attacker.equipped.type === 'bow') {
        console.log('攻击失败：弓不能进行近战攻击');
        return;
      }

      // 近战优先使用前端射线提示的目标，但仍由服务端校验 3 码距离和朝向。
      if (requestedTargetId) {
        const requestedEntity = entities.get(requestedTargetId);
        if (requestedEntity && requestedEntity.hp > 0) {
          const deltaX = requestedEntity.x - attacker.x;
          const deltaZ = requestedEntity.z - attacker.z;
          const distance = Math.hypot(deltaX, deltaZ);
          const facing =
            distance > 0.001
              ? (deltaX * direction.x + deltaZ * direction.z) / distance
              : 0;

          console.log(
            '近战目标提示距离:',
            distance,
            '朝向点积:',
            facing
          );

          if (distance > MELEE_ATTACK_RANGE) {
            console.log(
              '攻击失败：前端射线目标距离太远',
              distance,
              '>',
              MELEE_ATTACK_RANGE
            );
            io.to(socket.id).emit(
              'msg',
              '距离太远，攻击无效！'
            );
            return;
          }

          if (facing >= MELEE_ATTACK_CONE_DOT) {
            entity = requestedEntity;
            console.log('采用前端射线目标:', requestedEntity.id);
          } else {
            console.log(
              '前端射线目标不满足近战朝向，回退到服务端范围搜索'
            );
          }
        } else {
          console.log('前端射线目标已不存在或已死亡，回退到范围搜索');
        }
      }

      if (!entity) {
        entity = findMeleeAttackTarget(attacker, direction);
      }
    }

    attacker.lastAttackAt = now;

    if (!entity) {
      if (requestedTargetId) {
        const requestedEntity = entities.get(requestedTargetId);
        if (requestedEntity) {
          const requestedDistance = Math.hypot(
            requestedEntity.x - attacker.x,
            requestedEntity.z - attacker.z
          );
          const requestedMaxRange =
            attackType === 'ranged'
              ? BOW_MAX_RANGE
              : MELEE_ATTACK_RANGE;

          console.log(
            '玩家距离目标:',
            requestedDistance,
            '允许距离:',
            requestedMaxRange
          );

          if (requestedDistance > requestedMaxRange) {
            console.log('攻击失败：距离太远');
            io.to(socket.id).emit(
              'msg',
              '距离太远，攻击无效！'
            );
            return;
          }
        }
      }

      console.log(
        `攻击失败：${attackType === 'ranged' ? '箭矢射程内没有目标' : '3.5 码扇形范围内没有目标'}`
      );
      socket.emit('attackMiss', {
        type: attackType,
        charge,
        range: attackRange
      });
      return;
    }

    const targetDistance = Math.hypot(
      entity.x - attacker.x,
      entity.z - attacker.z
    );
    const maxRange =
      attackType === 'ranged'
        ? BOW_MAX_RANGE
        : MELEE_ATTACK_RANGE;

    console.log(
      '玩家距离目标:',
      targetDistance,
      '允许距离:',
      maxRange
    );

    if (targetDistance > maxRange) {
      console.log('攻击失败：距离太远');
      io.to(socket.id).emit(
        'msg',
        '距离太远，攻击无效！'
      );
      return;
    }

    console.log(
      `服务端锁定目标：${entity.id}（${ENTITY_TYPES[entity.type].label}）`
    );

    // 采矿等级校验完全在服务端执行，客户端无法通过改前端绕过。
    const requiredOreLevel = ORE_LEVEL_BY_TYPE[entity.type] || 0;
    const pickaxeLevel =
      attacker.equipped.type === 'pickaxe'
        ? clamp(
            Math.floor(Number(attacker.equipped.level) || 0),
            0,
            4
          )
        : 0;

    if (requiredOreLevel > 0 && pickaxeLevel < requiredOreLevel) {
      socket.emit('error_msg', {
        message: '镐子等级不足，无法开采！',
        entityId: entity.id,
        oreLevel: requiredOreLevel,
        pickaxeLevel
      });

      console.log(
        `攻击失败：镐子等级不足。需要 ${requiredOreLevel} 级镐，` +
          `当前镐等级 ${pickaxeLevel}`
      );
      return;
    }

    // 客户端传来的 damage 会被忽略，最终伤害完全由服务端根据装备和蓄力计算。
    const attackResult = getWeaponAttack(attacker, entity);
    damage =
      attackType === 'ranged'
        ? Math.max(
            1,
            Math.round(
              attackResult.damage *
                (BOW_MIN_DAMAGE_MULTIPLIER +
                  charge *
                    (BOW_MAX_DAMAGE_MULTIPLIER -
                      BOW_MIN_DAMAGE_MULTIPLIER))
            )
          )
        : attackResult.damage;

    entity.hp = clamp(entity.hp - damage, 0, entity.maxHp);
    entity.lastAttackerId = playerId;

    console.log('目标扣血成功，剩余血量:', entity.hp);

    if (entity.hp > 0) {
      enrageNeutral(entity, playerId);
    }

    console.log(
      `玩家 ${playerId}（${GEAR_LABELS[attacker.equipped.type] || '空手'}` +
        `${attacker.equipped.level ? ` Lv.${attacker.equipped.level}` : ''}）` +
        `${attackType === 'ranged' ? `远程蓄力 ${(charge * 100).toFixed(0)}%，射程 ${attackRange.toFixed(1)}` : '近战'} ` +
        `命中 ${entity.id}（${ENTITY_TYPES[entity.type].label}），` +
        `造成 ${damage} 点伤害，剩余 ${entity.hp}/${entity.maxHp}`
    );

    io.emit('entityUpdated', {
      id: entity.id,
      type: entity.type,
      hp: entity.hp,
      maxHp: entity.maxHp,
      damage,
      attackerId: playerId,
      attackType,
      charge,
      ...getCaptureState(entity)
    });

    console.log(
      '广播血量更新 entityUpdated:',
      entity.id,
      entity.hp,
      '/',
      entity.maxHp
    );

    if (attacker.equipped.type === 'bow') {
      schedulePlayerSave(attacker);
      socket.emit('equipmentUpdated', getEquipmentState(attacker));
    }

    if (entity.hp <= 0) {
      handleEntityDeath(entity);
      return;
    }

    // 玩家锁定怪物后，当前宠物会持续协助攻击该目标。
    if (PET_ATTACK_TARGET_TYPES.has(entity.type)) {
      const activePet = getActivePet(attacker, 'pet');
      const companion = activePet
        ? companions.get(getCompanionId(attacker.id, 'pet'))
        : null;

      if (companion) {
        companion.targetId = entity.id;
        tryPetAutoAttack(companion, attacker);
      }
    }
  });

  socket.on('pickup', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    let dropId = null;

    if (typeof data === 'string') {
      dropId = data;
    } else if (data && data.dropId) {
      dropId = String(data.dropId);
    }

    if (!dropId) {
      return;
    }

    const drop = drops.get(dropId);

    if (!drop) {
      return;
    }

    const distance = Math.hypot(
      currentPlayer.x - drop.x,
      currentPlayer.y - drop.y,
      currentPlayer.z - drop.z
    );

    if (distance > PICKUP_RANGE) {
      socket.emit('pickupFailed', {
        dropId: drop.id,
        reason: 'too_far'
      });
      return;
    }

    currentPlayer.inventory[drop.type] =
      (currentPlayer.inventory[drop.type] || 0) + 1;
    schedulePlayerSave(currentPlayer);

    drops.delete(drop.id);

    // 全服广播：所有客户端都把地面上的掉落物删掉。
    io.emit('dropRemoved', {
      id: drop.id,
      type: drop.type,
      pickedBy: playerId
    });

    // 背包只同步给拾取者。
    socket.emit('inventoryUpdated', {
      inventory: { ...currentPlayer.inventory }
    });

    console.log(
      `玩家 ${playerId} 拾取了 ${ITEM_TYPES[drop.type]}，` +
        `当前数量 ${currentPlayer.inventory[drop.type]}`
    );
  });

  socket.on('feedPet', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const targetId = data && data.targetId ? String(data.targetId) : null;
    const entity = targetId ? entities.get(targetId) : null;

    if (!entity || !WILD_ANIMAL_TYPES.has(entity.type)) {
      socket.emit('feedResult', {
        success: false,
        reason: '目标不是可喂食的野生生物'
      });
      return;
    }

    if (!isWeakWildAnimal(entity)) {
      socket.emit('feedResult', {
        success: false,
        targetId: entity.id,
        reason: '生物还没有进入虚弱状态'
      });
      return;
    }

    if (entity.capturable || (entity.feedCount || 0) >= FEED_REQUIRED) {
      socket.emit('feedResult', {
        success: false,
        targetId: entity.id,
        reason: '它已经可以抓捕了'
      });
      return;
    }

    const feedType = FEED_BY_SPECIES[entity.type];
    const feedOwned = currentPlayer.inventory[feedType] || 0;

    if (feedOwned <= 0) {
      socket.emit('feedResult', {
        success: false,
        targetId: entity.id,
        reason: `没有${ITEM_TYPES[feedType]}`
      });
      return;
    }

    const distance = Math.hypot(
      currentPlayer.x - entity.x,
      currentPlayer.y - entity.y,
      currentPlayer.z - entity.z
    );

    if (distance > CAPTURE_RANGE) {
      socket.emit('feedResult', {
        success: false,
        targetId: entity.id,
        reason: '距离太远'
      });
      return;
    }

    currentPlayer.inventory[feedType] = feedOwned - 1;
    entity.feedCount = (entity.feedCount || 0) + 1;
    entity.capturable = entity.feedCount >= FEED_REQUIRED;
    schedulePlayerSave(currentPlayer);

    socket.emit('inventoryUpdated', {
      inventory: { ...currentPlayer.inventory }
    });

    socket.emit('feedResult', {
      success: true,
      targetId: entity.id,
      feedType,
      feedCount: entity.feedCount,
      feedRequired: FEED_REQUIRED,
      capturable: entity.capturable,
      reason: null
    });

    io.emit('entityCaptureUpdated', getCaptureState(entity));

    console.log(
      `玩家 ${playerId} 喂食 ${entity.id}（${ENTITY_TYPES[entity.type].label}）` +
        ` ${entity.feedCount}/${FEED_REQUIRED}` +
        (entity.capturable ? '，已可抓捕' : '')
    );
  });

  socket.on('capturePet', (data = {}) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      return;
    }

    const targetId = data && data.targetId ? String(data.targetId) : null;
    const entity = targetId ? entities.get(targetId) : null;

    if (!entity || !WILD_ANIMAL_TYPES.has(entity.type)) {
      socket.emit('captureResult', {
        success: false,
        reason: '目标不是可抓捕的野生生物'
      });
      return;
    }

    if (!isWeakWildAnimal(entity) || !entity.capturable) {
      socket.emit('captureResult', {
        success: false,
        targetId: entity.id,
        reason: '它还没有进入可抓捕状态'
      });
      return;
    }

    const distance = Math.hypot(
      currentPlayer.x - entity.x,
      currentPlayer.y - entity.y,
      currentPlayer.z - entity.z
    );

    if (distance > CAPTURE_RANGE) {
      socket.emit('captureResult', {
        success: false,
        targetId: entity.id,
        reason: '距离太远'
      });
      return;
    }

    if (Math.random() >= CAPTURE_CHANCE) {
      socket.emit('captureResult', {
        success: false,
        targetId: entity.id,
        reason: '抓捕失败，它挣脱了。可以再试一次。'
      });
      return;
    }

    const pet = createPet(entity.type, currentPlayer.id);
    currentPlayer.pets.push(pet);
    schedulePlayerSave(currentPlayer);

    entities.delete(entity.id);

    socket.emit('captureResult', {
      success: true,
      targetId: entity.id,
      species: entity.type,
      pet,
      pets: currentPlayer.pets.map((item) => ({
        ...item,
        potential: { ...item.potential }
      }))
    });

    io.emit('entityCaptured', {
      id: entity.id,
      species: entity.type,
      capturedBy: currentPlayer.id
    });

    console.log(
      `玩家 ${playerId} 成功抓捕 ${entity.id}（${ENTITY_TYPES[entity.type].label}），` +
        `潜能：攻 ${pet.potential.attack} / 血 ${pet.potential.hp} / 速 ${pet.potential.speed}`
    );
  });

  socket.on('trade_request', (data = {}) => {
    const currentPlayer = players.get(playerId);
    const targetId =
      data && typeof data === 'object'
        ? String(data.targetId || '')
        : String(data || '');

    if (!currentPlayer || !currentPlayer.alive) {
      return;
    }

    if (currentPlayer.trading) {
      socket.emit('tradeError', { reason: '你正在交易中' });
      return;
    }

    const target = players.get(targetId);

    if (!target || target.id === currentPlayer.id) {
      socket.emit('tradeError', { reason: '目标玩家不存在' });
      return;
    }

    if (!target.alive) {
      socket.emit('tradeError', { reason: '目标玩家当前无法交易' });
      return;
    }

    if (target.trading) {
      socket.emit('tradeError', { reason: '对方正在交易中' });
      return;
    }

    if (
      Math.hypot(
        currentPlayer.x - target.x,
        currentPlayer.y - target.y,
        currentPlayer.z - target.z
      ) > TRADE_RANGE
    ) {
      socket.emit('tradeError', { reason: '需要靠近对方才能发起交易' });
      return;
    }

    const hasPending = Array.from(pendingTradeRequests.entries()).some(
      ([requestTargetId, pending]) =>
        requestTargetId === currentPlayer.id ||
        requestTargetId === target.id ||
        pending.fromId === currentPlayer.id ||
        pending.fromId === target.id
    );

    if (hasPending) {
      socket.emit('tradeError', { reason: '已有待处理的交易请求' });
      return;
    }

    const request = {
      fromId: currentPlayer.id,
      targetId: target.id,
      createdAt: Date.now()
    };

    request.timeout = setTimeout(() => {
      const pending = pendingTradeRequests.get(target.id);
      if (!pending || pending !== request) {
        return;
      }

      pendingTradeRequests.delete(target.id);
      io.to(currentPlayer.socketId).emit('tradeRequestExpired', {
        targetId: target.id,
        reason: '交易请求已超时'
      });
      io.to(target.socketId).emit('tradeRequestExpired', {
        fromId: currentPlayer.id,
        reason: '交易请求已超时'
      });
    }, TRADE_REQUEST_TIMEOUT);

    pendingTradeRequests.set(target.id, request);

    io.to(target.socketId).emit('tradeRequest', {
      fromId: currentPlayer.id,
      targetId: target.id,
      expiresAt: request.createdAt + TRADE_REQUEST_TIMEOUT
    });

    socket.emit('tradeRequestSent', {
      targetId: target.id
    });

    console.log(
      `玩家 ${currentPlayer.id} 向 ${target.id} 发起交易请求`
    );
  });

  socket.on('trade_accept', () => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer) {
      return;
    }

    const pending = pendingTradeRequests.get(currentPlayer.id);

    if (!pending) {
      socket.emit('tradeError', { reason: '没有可接受的交易请求' });
      return;
    }

    clearTimeout(pending.timeout);
    pendingTradeRequests.delete(currentPlayer.id);

    const requester = players.get(pending.fromId);

    if (
      !requester ||
      requester.trading ||
      currentPlayer.trading ||
      !requester.alive
    ) {
      if (requester) {
        io.to(requester.socketId).emit('tradeRequestExpired', {
          targetId: currentPlayer.id,
          reason: '交易请求已失效'
        });
      }
      socket.emit('tradeError', { reason: '交易请求已失效' });
      return;
    }

    if (
      Math.hypot(
        requester.x - currentPlayer.x,
        requester.y - currentPlayer.y,
        requester.z - currentPlayer.z
      ) > TRADE_RANGE
    ) {
      io.to(requester.socketId).emit('tradeRequestExpired', {
        targetId: currentPlayer.id,
        reason: '距离过远，交易请求已取消'
      });
      socket.emit('tradeError', { reason: '距离过远，无法接受交易' });
      return;
    }

    clearPendingRequestsInvolving(requester.id);
    clearPendingRequestsInvolving(currentPlayer.id);

    const trade = {
      id: `trade_${nextTradeNumber}`,
      aId: requester.id,
      bId: currentPlayer.id,
      offers: {
        [requester.id]: {},
        [currentPlayer.id]: {}
      },
      locked: {
        [requester.id]: false,
        [currentPlayer.id]: false
      },
      confirmed: {
        [requester.id]: false,
        [currentPlayer.id]: false
      },
      verified: false,
      status: 'active',
      createdAt: Date.now()
    };

    nextTradeNumber += 1;
    requester.trading = trade.id;
    currentPlayer.trading = trade.id;
    trades.set(trade.id, trade);

    const payload = getTradePayload(trade);
    io.to(requester.socketId).emit('tradeStarted', payload);
    io.to(currentPlayer.socketId).emit('tradeStarted', payload);

    console.log(
      `交易 ${trade.id} 开始：${requester.id} 与 ${currentPlayer.id}`
    );
  });

  socket.on('trade_decline', () => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer) {
      return;
    }

    const pending = pendingTradeRequests.get(currentPlayer.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    pendingTradeRequests.delete(currentPlayer.id);

    const requester = players.get(pending.fromId);

    if (requester && requester.socketId) {
      io.to(requester.socketId).emit('tradeRequestDeclined', {
        targetId: currentPlayer.id
      });
    }

    socket.emit('tradeRequestClosed');
  });

  socket.on('trade_set_offer', (data = {}) => {
    const currentPlayer = players.get(playerId);
    const trade = getPlayerTrade(currentPlayer);

    if (!trade || trade.status !== 'active') {
      socket.emit('tradeError', { reason: '当前没有进行中的交易' });
      return;
    }

    if (trade.locked[currentPlayer.id]) {
      socket.emit('tradeError', { reason: '你已锁定报价，不能修改' });
      return;
    }

    const items = data && typeof data === 'object' ? data.items : null;

    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      socket.emit('tradeError', { reason: '交易物品格式无效' });
      return;
    }

    const entries = Object.entries(items);

    if (entries.length > TRADE_MAX_ITEM_KINDS) {
      socket.emit('tradeError', { reason: '交易物品种类过多' });
      return;
    }

    const cleanOffer = {};

    for (const [item, rawAmount] of entries) {
      const amount = Math.floor(Number(rawAmount));

      if (!isTradeableItemType(item)) {
        socket.emit('tradeError', { reason: '包含未知物品' });
        return;
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        socket.emit('tradeError', { reason: '物品数量无效' });
        return;
      }

      if ((currentPlayer.inventory[item] || 0) < amount) {
        socket.emit('tradeError', {
          reason: `${ITEM_TYPES[item]} 数量不足`
        });
        return;
      }

      cleanOffer[item] = amount;
    }

    trade.offers[currentPlayer.id] = cleanOffer;
    trade.confirmed[trade.aId] = false;
    trade.confirmed[trade.bId] = false;
    trade.verified = false;

    emitTradeUpdated(trade);
  });

  socket.on('trade_lock', () => {
    const currentPlayer = players.get(playerId);
    const trade = getPlayerTrade(currentPlayer);

    if (!trade || trade.status !== 'active') {
      socket.emit('tradeError', { reason: '当前没有进行中的交易' });
      return;
    }

    if (trade.locked[currentPlayer.id]) {
      return;
    }

    trade.locked[currentPlayer.id] = true;

    if (trade.locked[trade.aId] && trade.locked[trade.bId]) {
      const validation = validateTradeOffers(trade);

      if (!validation.ok) {
        cancelTrade(trade, validation.reason, null);
        return;
      }

      trade.verified = true;
      trade.confirmed[trade.aId] = false;
      trade.confirmed[trade.bId] = false;
    }

    emitTradeUpdated(trade);
  });

  socket.on('trade_confirm', () => {
    const currentPlayer = players.get(playerId);
    const trade = getPlayerTrade(currentPlayer);

    if (!trade || trade.status !== 'active') {
      socket.emit('tradeError', { reason: '当前没有进行中的交易' });
      return;
    }

    if (!trade.locked[trade.aId] || !trade.locked[trade.bId]) {
      socket.emit('tradeError', { reason: '双方都锁定后才能确认' });
      return;
    }

    if (!trade.verified) {
      socket.emit('tradeError', { reason: '交易报价尚未通过校验' });
      return;
    }

    if (trade.confirmed[currentPlayer.id]) {
      return;
    }

    trade.confirmed[currentPlayer.id] = true;

    if (trade.confirmed[trade.aId] && trade.confirmed[trade.bId]) {
      completeTrade(trade);
      return;
    }

    emitTradeUpdated(trade);
  });

  socket.on('trade_cancel', () => {
    const currentPlayer = players.get(playerId);
    const trade = getPlayerTrade(currentPlayer);

    if (!trade) {
      return;
    }

    cancelTrade(
      trade,
      `${currentPlayer.id} 取消了交易`,
      currentPlayer.id
    );
  });

  socket.on('chat', (payload) => {
    const currentPlayer = players.get(playerId);

    if (!currentPlayer) {
      return;
    }

    let rawMessage = '';

    if (typeof payload === 'string') {
      rawMessage = payload;
    } else if (payload && typeof payload === 'object') {
      rawMessage =
        payload.message ?? payload.text ?? JSON.stringify(payload);
    } else {
      rawMessage = String(payload ?? '');
    }

    const message = rawMessage.trim().slice(0, 200);

    if (!message) {
      return;
    }

    console.log(`玩家 ${playerId} 的聊天内容：${message}`);

    io.emit('chatMessage', {
      id: playerId,
      color: currentPlayer.color,
      message,
      sentAt: Date.now()
    });
  });

  socket.on('disconnect', async (reason) => {
    const currentPlayer = players.get(playerId);

    if (currentPlayer) {
      clearPendingRequestsInvolving(playerId);
      const trade = getPlayerTrade(currentPlayer);
      if (trade) {
        cancelTrade(trade, `${playerId} 已断开，交易取消`, playerId);
      }
      await savePlayerNow(currentPlayer);
    }

    removeCompanion(playerId, 'pet');
    removeCompanion(playerId, 'mount');
    players.delete(playerId);

    socket.broadcast.emit('playerLeft', {
      id: playerId
    });

    io.emit('onlineCount', players.size);

    console.log('玩家下线');
    console.log(`玩家 ${playerId} 已断开（原因：${reason}）`);
  });
});

generateEntities();
spawnPlants();
setInterval(updateCreatures, 200);
setInterval(spawnPlants, PLANT_SPAWN_INTERVAL);
setInterval(
  () => updateCompanions(COMPANION_TICK_MS / 1000),
  COMPANION_TICK_MS
);
setInterval(() => {
  players.forEach((player) => {
    schedulePlayerSave(player);
  });
}, PLAYER_AUTOSAVE_MS);

let lastJumpTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const deltaSeconds = Math.max(0, (now - lastJumpTick) / 1000);
  lastJumpTick = now;
  updateJumpPhysics(deltaSeconds);
}, JUMP_TICK_MS);

setInterval(() => {
  io.emit('worldTime', getWorldTimeState());
}, 2000);

let isShuttingDown = false;

async function shutdownServer(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`收到 ${signal}，正在保存玩家存档…`);

  await Promise.allSettled(
    Array.from(players.values()).map((player) => savePlayerNow(player))
  );

  server.close(() => {
    console.log('服务器已关闭，存档已保存。');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdownServer('SIGINT'));
process.on('SIGTERM', () => shutdownServer('SIGTERM'));

server.listen(PORT, () => {
  console.log(`服务器已启动：http://localhost:${PORT}`);
  console.log(`玩家存档目录：${PLAYER_DATA_DIR}`);
});

