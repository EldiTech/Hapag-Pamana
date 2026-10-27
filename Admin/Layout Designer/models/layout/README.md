# HapagPamana Blender Layout Assets

`hapag-layout-library.glb` is the real-time asset library loaded once by
`js/assets3d.js`. `hapag-layout-library.blend` is its editable Blender source.
Both were generated in Blender 5.2.2 through Blender MCP from
`tool/build_layout_assets.py`.

All measurements use metres. Every prototype root is at the local floor
origin. Three.js scales X/Z to the saved layout footprint while retaining the
model's physical height. Materials are shared PBR finishes and can be retinted
by the selected event theme.

## Layout inventory

| Layout kind | Blender root | Notes |
|---|---|---|
| `round` | `ASSET_round` | Dynamic place settings and chairs remain data-driven. |
| `rect` | `ASSET_rect` | Shared by long tables. |
| `square` | `ASSET_rect` | Scaled to the square footprint. |
| `cocktail` | `ASSET_cocktail` | Optional stools remain data-driven. |
| `head` | `ASSET_rect` | One-sided chairs remain data-driven. |
| `registration` | `ASSET_service` | Scaled service-table variant. |
| `gift` | `ASSET_service` | Scaled service-table variant. |
| `buffet` | `ASSET_buffet` | Four detailed chafers and plate stack. |
| `dessert` | `ASSET_dessert` | Three-tier display and plated cakes. |
| `bar` | `ASSET_bar` | Panelled bar, timber top, bottles. |
| `beverage` | `ASSET_beverage` | Glass dispensers, taps, cups. |
| `coffee` | `ASSET_beverage` | Scaled beverage-station variant. |
| `service` | `ASSET_service` | Tray and plate stack. |
| `trash` | `ASSET_trash` | Waste and recycling pair. |
| `stage` | `ASSET_stage` | Deck, steps, curtain folds, pelmet. |
| `dance` | `ASSET_dance` | Alternating parquet and brass perimeter. |
| `dj` | `ASSET_dj` | Controller, jog wheels, faders, monitors. |
| `speaker` | `ASSET_speaker` | Cabinet, drivers, pole, tripod. |
| `screen` | `ASSET_screen` | LED panel, seams, truss feet. |
| `photo` | `ASSET_photo` | Backdrop, floral arch, camera, tripod. |
| `decor` | `ASSET_decor` | Brass planter, foliage, flowers. |
| `door` | `ASSET_door` | Open frame; opening stays walkable. |
| `exit` | `ASSET_exit` | Open frame and emissive exit sign. |
| `kitchen` | `ASSET_door` | Service-entrance frame variant. |
| `spawn` | none | Semantic player start; intentionally invisible. |
| `other` | `ASSET_other` | Neutral flight/equipment case. |

Chair assets: `ASSET_chair_banquet`, `ASSET_chair_chiavari`,
`ASSET_chair_modern`, `ASSET_chair_stool`, and `ASSET_chair_executive`.
The default banquet chair follows the supplied chair-cover reference: a softly
padded, slightly reclined rounded back, upholstered seat, and squared
floor-length skirt with evenly spaced vertical gathers and a restrained
scalloped hem. Its shared cloth color follows the selected event theme.

## Runtime behavior

- One GLB request and one shared loading promise.
- Shared geometry and materials across cloned instances.
- 24 roots, 91 meshes, 15 materials, 45,488 triangles total.
- Same-material parts merged per prototype to reduce draw calls.
- Procedural builders remain the failure fallback when GLTFLoader or GLB fails.
- Placement, rotation, resizing, collision, AABB, A*, saving, and loading still
  use the original layout item data.

## Regeneration

Run `tool/build_layout_assets.py` inside Blender. The script overwrites the
`.blend` and `.glb` files in this directory.
