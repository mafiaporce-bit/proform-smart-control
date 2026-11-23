# Virtual Running: Park Discovery 3K

## How it fits together

- `src/pages/VirtualRun.tsx` is the page. It owns every control and all numbers (time, distance, calories, pace) through the app's normal workout engine.
- `public/virtual-park/` is the 3D scene, shown in an iframe. It only draws. The page tells it the pace, whether to move, where on the 3 km lap the person is, the camera and the quality (`VR_CMD` messages). The scene reports back that it is drawing and which person and clip it is using (`VR_STATE`).
- The scene has no Bluetooth code. Treadmill speed can only reach it through `src/ble/telemetry.ts`, which returns nothing until a decoder is validated. Until then the badge reads SIMULATION MODE.
- If the 3D scene cannot start or stops drawing, the page falls back to the photo Park Walk so a session still works.

## The person

- File: `public/virtual-park/assets/maya-locomotion.glb`, from "Locomotion collection - Maya 3D Person, Animated" by Innerscene. The file's own metadata dedicates it to the public domain (CC0 1.0).
- 102,036 triangles, 56 joints, clips: Idle_Standing, Walk_Relaxed, Walk_Brisk, Jog, Run, Walk_Carry, Sit_Stand.
- The bundled copy has smaller textures (4096 and 2048 px reduced to 1024 px, eyes and teeth to 256 px): 21.3 MB became 7.1 MB. Geometry, skeleton and animations are byte-identical to the original (`tools` check: 1,582 data blocks compared, 0 differences).
- The model holds a phone; that mesh is hidden.
- Life size as supplied: 1.67 m. It is not rescaled.

### Stride speeds (measured, used to stop foot sliding)

Each clip was played on the CPU and the planted foot's backward speed measured. That is the ground speed at which the foot does not slide:

| Clip | Ground speed | Steps per minute | Used for paces |
|---|---|---|---|
| Walk_Relaxed | 4.68 km/h | 120 | up to about 5.5 km/h |
| Walk_Brisk | 6.12 km/h | 138 | about 5.1 to 7.5 km/h |
| Jog | 10.08 km/h | 164 | about 7.1 to 12.2 km/h |
| Run | 16.20 km/h | 180 | above about 11.8 km/h |

The clip's play speed is set to pace ÷ ground speed, so the foot keeps pace with the path. The bands overlap so the clip does not flicker at a boundary. Clips cross-fade over 0.4 s, starting at the same point in the stride. None of the clips move the body forward by themselves (no root motion).

## The route

One closed 3 km spline with turns and height changes: lakeside start, wooden bridge over a stream at 0.6 km, waterfall at 1.32 km, hill at about 1.86 km, second bridge at 2.1 km, pine forest around 2.5 km, back to the lake.

Changes made to the uploaded simulator:

- Fixed: ground and path textures were never applied (the texture was built from the wrong object).
- Fixed: bridge handrails were built across the path instead of along it.
- Added: grass banks so the raised path no longer floats over flat ground; lakes; lampposts; a denser forest stretch; a camera that sits closer on an upright phone and turns towards the waterfall.
- Photo-texture upgrade, version 0.6 (`photo.js`, `props.js`, `assets/tex/`): real scanned textures from Poly Haven (CC0) for the sky, lawn, leaves, fir boughs, bark, path, kerb stones, flower-bed mulch and rocks; lighting from the sky picture; a low sun that throws tree shade across the path. The first 210 m ("Lakeside showcase") was rebuilt to a kept-park look: the lake runs beside the path with a sloping bank, boulders and reeds; big shade trees; stone kerbs; flower beds; iron lamp posts; benches; a white gazebo. Each texture is optional: the Virtual Running page shows how many loaded ("photo textures 16/16") and the painted version is used for any that did not. `tools/mktex.py` rebuilds the web-sized textures from the downloaded originals. The two grass files did not download, so the lawn is cut from the lawn in the sky panorama. Flower heads and water ripples are generated, not photos.
- Scenery upgrade (`scenery.js`): trees with leafy crowns and pines with boughs, both built from textured cards the way games draw foliage, casting leaf-shaped shade on the path; bushes; flower clumps; grass tufts that fill in around the walker; painted grass and gravel textures; flowing water on the streams and lakes; streaked falling water and mist at the waterfall; distant hills; a sky dome with clouds. All of it is drawn by code. No art was downloaded.
- Added: quality levels (Low: no shadows, no grass tufts, lower resolution, shorter view distance. High: sharper, finer shadows). If the scene draws under 20 frames a second for 7 seconds, the page offers a switch to Low.
- Changed: the 3D engine and the person are bundled in the app, so nothing is fetched from other sites.

## What is and is not realistic

- The person is a textured, rigged adult with real walk, jog and run clips. The clips were hand-authored by the model's maker, not motion-captured.
- Even with photo textures this is real-time 3D on a phone: it reads as a good-looking game park, not as film footage. The rest of the 3 km route has the new materials but not yet the showcase planting.
- (Before 0.6) The scenery was generated by code. After the upgrade it reads as a game-style park with leafy trees, shade and grass, not as a photograph. Photo-quality trees, rocks and ground need scanned 3D assets and textures.

## Sound and voice

- `src/lib/ambience.ts` makes the nature sounds in the browser: wind, birds (more of them in the forest), running water that grows louder near the two streams and the waterfall, and footsteps in time with the stride (step rates from the table above). No sound files. The speaker button on the scene turns it on and off.
- A guided program can be started from the park page (any of the five programs, or a session from the coach plan). The normal coach voice calls each speed change, and the current block shows inside the scene.
- In a free session the voice names each stretch of the park as it begins and each finished lap.

## Testing done

- Drawn for real in headless Chrome with a software WebGL renderer: scene loads, person loads from the bundled file, walk/brisk/jog/run/idle clips selected at the right paces, both cameras, all five checkpoints, quality levels, lap wrap at 3 km, pause, save to History, fallback when the engine or the model is blocked.
- Also checked the same way: guided program started from the park, coach session started from the park, sound starting and stopping, the spoken note at the bridge stretch, the slow-device hint and its switch to Low.
- Not done: any run on a real phone. Frame rate, battery use, how the motion looks at full speed and how the sounds actually sound are unmeasured. In the software renderer the upgraded scenery took about two to three times longer per frame than Part 1's, so start on Medium and drop to Low if it stutters.

## Licences

- Three.js 0.172.0: MIT (`public/virtual-park/vendor/LICENSE-three.txt`).
- Maya 3D person: CC0 1.0 (public domain), Innerscene. No credit required.
