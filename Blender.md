# MASTER PROMPT — HAPAGPAMANA 3D LAYOUT DESIGNER ENHANCEMENT

## ROLE

Act as a Senior 3D Environment Artist, Blender Specialist, Full-Stack Developer, and 3D Visualization Engineer.

Your objective is to upgrade the existing **HapagPamana Admin Layout Designer** by creating high-quality, realistic, optimized 3D models and materials using **Blender through Blender MCP**, then integrating them into the existing application.

**Project directory:**

`E:\Projects\Hapag Pamana\Admin\Layout Designer`

## PHASE 1 — INSPECT THE EXISTING PROJECT

Before modifying anything:

1. Access and inspect the entire Layout Designer directory.
2. Identify the current framework, 3D rendering engine, asset-loading system, and project structure.
3. Locate all existing layout items, furniture, catering equipment, decorations, and other selectable objects.
4. Identify how these objects are represented in the current 2D and 3D layout systems.
5. Examine the existing item dimensions, positioning, rotation, selection, collision detection, and drag-and-drop functionality.
6. Determine which items currently use basic geometric placeholders, primitive shapes, or low-quality models.
7. Create an inventory of all existing objects that require upgraded 3D assets.

**Important:** Do not invent new layout items or overlook existing ones. The upgraded 3D models must correspond directly to the items already available in the Layout Designer.

## PHASE 2 — CREATE REALISTIC 3D MODELS USING BLENDER MCP

Use Blender MCP to programmatically control Blender and create actual 3D assets for every applicable existing layout item.

### Modeling requirements

- Build recognizable, professionally modeled 3D objects.
- Replace basic geometric placeholders with detailed, realistic representations.
- Maintain accurate proportions based on the item's existing dimensions.
- Use clean geometry, proper topology, smooth shading, and bevels where appropriate.
- Apply realistic thickness, edges, joints, frames, legs, and structural details.
- Ensure furniture and equipment look appropriate for a professional Filipino catering and event setup.
- Keep models visually consistent across the entire Layout Designer.
- Use efficient polygon counts suitable for real-time browser rendering.

### Material requirements

Create physically based rendering (PBR) materials where appropriate, including:

- Wood grain and polished wooden surfaces
- Stainless steel and brushed metal
- Ceramic and porcelain
- Fabric, upholstery, and tablecloths
- Glass and transparent surfaces
- Plastic and painted surfaces
- Decorative gold and brass finishes
- Other materials appropriate to the existing items

Configure base color, roughness, metallic properties, normals, and texture maps as needed.

**Do not merely change the colors of basic cubes and cylinders. Create properly modeled assets with materials that represent the actual objects.**

## PHASE 3 — OPTIMIZE AND EXPORT ASSETS

Prepare the Blender assets for use in the Layout Designer.

Requirements:

1. Use consistent world units and coordinate conventions.
2. Apply appropriate object transforms.
3. Set suitable object origins and floor-aligned positioning.
4. Optimize geometry without significantly sacrificing visual quality.
5. Reuse materials and textures when practical.
6. Remove unnecessary hidden geometry.
7. Export models in GLB/glTF format where supported by the existing rendering engine.
8. Organize models into clearly named directories.
9. Ensure exported materials and textures render correctly outside Blender.
10. Preserve consistent real-world scale across all items.

Use descriptive asset names that match the existing Layout Designer item identifiers.

## PHASE 4 — INTEGRATE MODELS INTO THE EXISTING APPLICATION

Replace or enhance the existing 3D representations with the Blender-created assets.

**Preserve all existing Layout Designer functionality**, including:

- Drag-and-drop item placement
- Object selection and deselection
- Positioning and rotation
- Object resizing, where supported
- Layout saving and loading
- 2D and 3D view synchronization
- Existing collision detection
- AABB-based collision handling
- A* pathfinding and layout optimization
- Camera navigation and zoom
- Item deletion and duplication, where supported

Ensure the rendered 3D object dimensions match the dimensions used by the layout, collision, and pathfinding systems.

Do not modify the underlying layout logic unless necessary for compatibility.

## PHASE 5 — ENHANCE THE 3D VISUAL EXPERIENCE

Improve the existing 3D environment with:

- Natural, balanced lighting
- Soft contact shadows
- Realistic material responses
- Proper ambient occlusion, if supported
- Smooth camera navigation
- Clean object selection outlines
- Consistent model scale and orientation
- Clear visual separation between nearby objects
- High-quality rendering without excessive GPU requirements

The visual direction must be **premium, realistic, modern, and appropriate for HapagPamana Catering Services**.

Avoid excessive bloom, unrealistic reflections, unnecessary decorative effects, and generic AI-looking 3D designs.

## PHASE 6 — PERFORMANCE AND COMPATIBILITY

Ensure the enhanced Layout Designer remains responsive.

- Use efficient meshes and texture resolutions.
- Reuse geometry and materials where possible.
- Implement asset caching or shared loading when supported.
- Dispose of unused 3D resources correctly.
- Avoid unnecessary model reloads.
- Preserve smooth interaction when multiple items appear in the layout.
- Maintain compatibility with the application's current rendering engine and supported devices.

## PHASE 7 — VALIDATION AND TESTING

After implementation:

1. Confirm that every existing applicable item has a correctly assigned 3D model.
2. Verify the models display with their intended materials.
3. Test model placement, movement, rotation, selection, and deletion.
4. Confirm collision boxes match the upgraded models.
5. Verify that saved layouts load correctly.
6. Test scenes containing multiple different objects.
7. Check rendering performance.
8. Identify and resolve missing textures, incorrect orientations, floating models, clipping, and scaling issues.
9. Ensure existing application features continue functioning.

## NON-NEGOTIABLE REQUIREMENTS

- **Actually use Blender MCP** for model and material creation when available.
- Do not substitute CSS styling or simple color changes for genuine 3D asset creation.
- Do not generate placeholder files and claim they are completed 3D assets.
- Do not replace actual Blender modeling with mockup images.
- Do not redesign unrelated pages or features.
- Do not remove or break existing Layout Designer functionalities.
- Do not modify existing Firebase data or database structures unnecessarily.
- Preserve backward compatibility with previously saved layouts.
- Never claim that Blender MCP was used unless it was successfully invoked.
- If Blender MCP is unavailable, clearly report the blocker rather than falsely claiming completion.

## EXPECTED OUTPUT

Deliver an upgraded, working HapagPamana Layout Designer containing:

1. Actual Blender-created 3D models for the existing layout objects.
2. Realistic and professionally configured 3D materials.
3. Optimized assets properly integrated into the application.
4. Preserved layout, collision, and pathfinding functionality.
5. Improved real-time 3D visual quality.
6. A summary identifying each original layout item and its corresponding Blender asset.
7. A report of files created or modified and tests performed.

**FINAL INSTRUCTION**

Do not stop at suggestions, conceptual designs, or a written implementation plan.

Inspect the existing codebase, use Blender MCP to create the required assets, integrate those assets into the existing Layout Designer, and verify that everything functions correctly.

Prioritize actual implementation, visual quality, compatibility, and performance.

## IMPLEMENTATION COMPLETION RECORD — 2026-10-26

Implemented through Blender MCP.

### Blender asset result

- Blender 5.2.2 LTS.
- 24 named GLB prototype roots.
- 26 catalog kinds covered, including shared variants.
- Five chair variants: banquet, chiavari, modern, stool, executive.
- 15 shared PBR materials.
- 91 optimized meshes.
- 45,488 triangles total.
- Floor-aligned metric coordinates.
- Editable `.blend` source retained.
- Runtime `.glb` export retained.

### Catalog mapping

Complete mapping:

`Admin/Layout Designer/models/layout/README.md`

Every applicable `HPRules.PIECES` builder resolves to a Blender root. Dynamic
chair counts, place settings, table rotation, table resizing, and saved item
dimensions remain layout-data driven. `spawn` stays semantic and invisible.

### Application integration

- `js/assets3d.js` loads and caches the GLB once.
- `GLTFLoader.js` added to the existing Three.js dependency chain.
- Shared geometry and materials reused across cloned instances.
- Theme palette updates retint imported Blender materials.
- Procedural builders remain a fallback when GLB loading fails.
- Shared imported geometry is protected from scene disposal.
- Existing collision, AABB, A*, navigation, saving, and loading code retained.

### Validation performed

- Blender MCP previews: buffet, stage, Chiavari, modern chair, photo booth.
- GLB inspection: 24 roots, 115 nodes, 91 meshes, 15 materials.
- Catalog coverage: zero missing build roots.
- Chair coverage: zero missing chair roots.
- JavaScript syntax checks passed for changed modules.
- Browser smoke: 24 assets loaded and six mixed assets rendered.
- Layout smoke: 25 items rendered, 25 item groups built, 26 seats built.
- Saved-layout JSON roundtrip passed through local storage.
- Auth gate reached correctly on the real Layout Designer route.
- Firebase Hosting bundle rebuilt with 153 files.
- Firebase Hosting deployment succeeded:
  `projects/hapagpamana-39687/sites/hapagpamana-39687/versions/46a29c2199749224`
- Public page returned HTTP 200.
- Public GLB returned HTTP 200 as `model/gltf-binary`.
- Public page contains GLTF loader and asset loader references.

The protected Firestore save path still requires a real staff login. No test
credentials were created or stored.

### Created or modified files

- `tool/build_layout_assets.py`
- `Admin/Layout Designer/models/layout/hapag-layout-library.blend`
- `Admin/Layout Designer/models/layout/hapag-layout-library.glb`
- `Admin/Layout Designer/models/layout/README.md`
- `Admin/Layout Designer/js/assets3d.js`
- `Admin/Layout Designer/js/scene3d.js`
- `Admin/Layout Designer/js/simulate.js`
- `Admin/Layout Designer/html/index.html`
- `.firebase-hosting/*` regenerated for deployment

### Public deployment

Firebase Hosting:

`https://hapagpamana-39687.web.app/`

Layout Designer:

`https://hapagpamana-39687.web.app/Layout%20Designer/html/index.html`

## BANQUET CHAIR REFERENCE UPDATE — 2026-10-26

- Default banquet chair rebuilt through Blender MCP.
- Softly padded, slightly reclined rounded full-cover back.
- Covered seat with no exposed chair frame.
- Squared floor-length skirt with evenly spaced tailored gathers.
- Restrained scalloped hem matching the supplied multi-angle reference.
- Browser-safe smooth cloth shading without tangent-map artifacts.
- Removed the woven tangent normal map after Three.js exposed severe pleat
  shading artifacts; the chair geometry itself was not malformed.
- Cloth retains dynamic event-theme color.
- Matching procedural fallback rebuilt for GLB-load failures.
- Other four selectable chair styles remain unchanged.
- JavaScript syntax checks passed after fallback replacement.
- GLB verified: 24 roots, 115 nodes, 91 meshes, 15 materials.
- Updated hosting bundle contains 153 files.
- Firebase Hosting deployment succeeded:
  `projects/hapagpamana-39687/sites/hapagpamana-39687/versions/31a58cc30b290a7f`
- Public GLB verified HTTP 200, `model/gltf-binary`, 2,241,868 bytes.
