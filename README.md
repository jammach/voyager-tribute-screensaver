# Voyager Tribute: a Windows screen saver

A real-time, physically grounded reconstruction of the **Voyager 1 and 2** flights, rendered as if by a camera riding the spacecraft.

* **Voyager 1**: Earth → Jupiter → Saturn/Titan → interstellar space (~11 min)
* **Voyager 2**: Earth → Jupiter → Saturn → Uranus → Neptune → interstellar space (~21 min)

Every leg between planets lasts exactly **60 s** of real time and every planet encounter exactly **240 s**. The two missions play back to back and loop.

## Install

Download `voyager_tribute.scr` from the [Releases](../../releases) page, right-click it and choose **Install**
(or run `voyager_tribute.scr /s` to try it; any key or mouse movement exits).

Requirements: Windows 10/11 x64, a WebGL 2 capable GPU, and the Microsoft Edge WebView2 Runtime (preinstalled on Windows 11).
The file is not code-signed, so SmartScreen may warn on first run. It is a single self-contained file that unpacks itself to
`%LOCALAPPDATA%\VoyagerTribute` on first launch. To remove it, delete the file and that folder.

## How it works

| Piece | Approach |
|---|---|
| Planet positions | JPL approximate Keplerian elements (Standish), J2000 equatorial frame |
| Trajectories | Lambert transfer arcs between the real flyby dates; hyperbolic flybys at the real closest-approach distances (Jupiter 349,000 km for V1, Neptune 29,300 km for V2). Computed launch energy and flyby turning angles agree with the real missions (`tools/check_orbits.py`) |
| Time compression | Mission time runs at a rate proportional to the distance from the nearest planets; constants are solved so cruises take 60 s and encounters 240 s |
| Stars | HYG catalogue (~120k real stars: true positions, magnitudes, colours) plus a Milky Way map; fixed at infinity, moving only with the camera |
| Bodies | Analytic ray-traced ellipsoids (perfect limbs at any zoom). Jupiter uses a Cassini map; Saturn, Uranus, Neptune and all moons are procedural |
| Lighting | Per-body sun direction/irradiance, planet and moon eclipses, ring and planet shadows, atmospheric scattering, Titan's haze |
| Rings | Procedural Saturn ringlet structure (C/B/Cassini/A/Encke/F), Uranian and Neptunian rings |
| Host | A tiny WinForms `.scr` hosting a WebView2 control running a three.js scene |

**Honest limitations:** the moons and the ice/gas giants other than Jupiter are procedural, not photographic. Moon orbit phases are tuned so
featured moons pass near the spacecraft at the documented times rather than taken from a full satellite ephemeris. The camera pointing is
a choreography (look back at the departing planet, then ahead), not Voyager's actual scan-platform log.

## Build from source

```powershell
powershell -ExecutionPolicy Bypass -File tools\build.ps1      # -> dist\voyager_tribute.scr
```
Uses the .NET Framework C# compiler that ships with Windows; downloads the WebView2 SDK NuGet package on first run.
`web/` also runs in a normal browser through any static server (e.g. `python -m http.server --directory web`).
Debug query parameters: `?still&at=io`, `?look=titan&dist=60000`, `?m=1&s=700`, `?dbg`, `?sweep`.

The star catalogue and Milky Way map are pre-generated into `web/data` and `web/tex`; `tools/prep_stars.py` and `tools/prep_milkyway.py`
regenerate them from the HYG CSV and NASA's `starmap_2020_4k.exr` (place those in `tools/cache/`; needs `numpy pillow scipy openexr`).

## Credits and licenses

* Original code in this repository: MIT (see `LICENSE`).
* Star data: [HYG Database](https://github.com/astronexus/HYG-Database) (astronexus), CC BY-SA 2.5.
* Milky Way: NASA Scientific Visualization Studio, *Deep Star Maps 2020* (public domain).
* Jupiter map: NASA/JPL/University of Arizona, Cassini PIA07782.
* Saturn/Uranus/Neptune colour profiles, Mars/Venus/Mercury, Earth and Moon maps: [threex.planets](https://github.com/jeromeetienne/threex.planets) and the three.js example textures (MIT).
* [three.js](https://threejs.org) (MIT). Microsoft Edge WebView2 SDK (Microsoft license).

Voyager is a NASA/JPL mission. This is an unofficial fan tribute.
