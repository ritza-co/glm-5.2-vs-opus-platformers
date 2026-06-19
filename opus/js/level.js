// Level definition. Platforms are placed as glTF assets AND as axis-aligned
// bounding boxes (AABBs) used for collision. The same numbers drive both, so
// what you see is what you collide with.
//
// Coordinate system: X right, Y up, Z toward camera. Player starts near origin.
//
// Block top heights (from asset bounds, top of grass):
//   block-grass / block-grass-large : top at y = 1.0 * scaleY
//   platform.glb                    : top at y = 0.195 * scaleY (thin)
// We place blocks so their top surface sits at a chosen `topY`.

// Each platform: an asset to render plus the world AABB it occupies.
// We author them by top surface (topY), horizontal center (cx,cz) and
// half-extents (hx,hz). Height (the solid box below the top) is `depth`.

export const ASSET_TOP = {
  // top Y of the asset's local geometry at scale 1 (used to align rendering).
  'block-grass': 1.0,
  'block-grass-large': 1.0,
  'block-grass-large-tall': 2.0,
  'block-grass-low': 0.5,
  'platform': 0.195,
};

// Build the level. Returns { platforms, coins, hazards, flag, spawn }.
export function buildLevel() {
  const platforms = [];
  const coins = [];
  const hazards = [];

  // Helper: place a grass block whose TOP sits at topY, centered at (cx,cz).
  // The grass-large asset spans ~2.08 units in X/Z (half = 1.0410625).
  // We treat the collision footprint as a clean 2x2 for predictable jumps.
  const HALF_LARGE = 1.0410624742507935;
  const HALF_SMALL = 0.5410624742507935;

  function grassLarge(cx, topY, cz, opts = {}) {
    // scaleY chosen so the rendered top aligns with topY (block sits on ground
    // visually by spanning from topY-1 up to topY). We render full-height blocks
    // (1 unit tall) and let them visually stack; collision only needs the top.
    const hx = HALF_LARGE, hz = HALF_LARGE;
    const top = topY;
    const bottom = topY - 1.0; // visual/collision box is 1 unit tall
    platforms.push({
      asset: 'block-grass-large',
      cx, cz,
      topY: top,
      aabb: { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, topY: top, bottomY: bottom },
      renderY: top - ASSET_TOP['block-grass-large'], // place asset so its top = topY
      scaleY: 1,
    });
    return platforms[platforms.length - 1];
  }

  function grassSmall(cx, topY, cz) {
    const hx = HALF_SMALL, hz = HALF_SMALL;
    const top = topY, bottom = topY - 1.0;
    platforms.push({
      asset: 'block-grass',
      cx, cz, topY: top,
      aabb: { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, topY: top, bottomY: bottom },
      renderY: top - ASSET_TOP['block-grass'],
      scaleY: 1,
    });
    return platforms[platforms.length - 1];
  }

  // --- Layout ---------------------------------------------------------------
  // A path heading in -Z (into the screen), with gaps and rising steps.

  // Starting plaza: 3x3 of large blocks at ground level (topY = 0).
  for (let xi = -1; xi <= 1; xi++) {
    for (let zi = 0; zi <= 2; zi++) {
      grassLarge(xi * 2.0822, 0, zi * 2.0822);
    }
  }
  const startBlock = platforms[0];

  // Coins on the starting plaza.
  coins.push(makeCoin(0, 0.0, 2.0822 * 1, 'coin-gold'));

  // Gap, then a single stepping block (jump across).
  grassLarge(0, 0.0, -2.6);
  coins.push(makeCoin(0, 0.0, -2.6, 'coin-gold'));

  // Rising staircase of small blocks going up and forward.
  grassSmall(0, 0.6, -5.0);
  grassSmall(0, 1.2, -6.4);
  grassSmall(0, 1.8, -7.8);
  coins.push(makeCoin(0, 1.8, -7.8, 'coin-silver'));

  // A higher plateau (large block) after the stairs.
  grassLarge(0, 2.2, -10.2);
  coins.push(makeCoin(0, 2.2, -10.2, 'coin-gold'));

  // Branch with a hazard (spikes) on a block you must jump over / around.
  grassLarge(2.6, 2.2, -10.2);
  hazards.push(makeHazard(2.6, 2.2, -10.2, 'spike-block'));

  // Jump across a gap to a floating island (gap edge-to-edge ~1 unit).
  grassLarge(0, 2.6, -13.3);
  grassLarge(0, 2.6, -15.4);
  coins.push(makeCoin(0, 2.6, -14.35, 'jewel'));

  // Final gentle climb to the flag (small step up, then the goal block).
  grassSmall(0, 3.0, -17.6);
  grassLarge(0, 3.0, -19.8);

  // The goal flag sits on the final large block.
  const flag = { x: 0, y: 3.0, z: -19.8, radius: 1.4, asset: 'flag' };

  // Spawn the player on top of the center of the starting plaza.
  const spawn = { x: 0, y: startBlock.topY + 0.05, z: 2.0822 };

  return { platforms, coins, hazards, flag, spawn };
}

function makeCoin(x, surfaceY, z, asset) {
  return {
    x, y: surfaceY + 0.45, z, asset,
    collected: false,
    spin: 0,
    radius: 0.7,
    value: asset === 'jewel' ? 5 : asset === 'coin-gold' ? 1 : 1,
  };
}

function makeHazard(x, surfaceY, z, asset) {
  // spike-block top is dangerous; we use a small AABB just above the surface.
  return {
    x, y: surfaceY, z, asset,
    aabb: { minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5,
            minY: surfaceY, maxY: surfaceY + 0.7 },
  };
}
