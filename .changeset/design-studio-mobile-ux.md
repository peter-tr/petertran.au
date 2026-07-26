---
"design-studio": minor
"web": minor
---

improve Design Studio's editor for mobile and add an Arrow tool. The canvas now scales to fit narrow/short viewports (via a CSS transform Konva already accounts for when mapping pointer coordinates, rather than the old fixed-size-plus-horizontal-scroll layout), capped by both available width and a fraction of viewport height so a short landscape phone screen doesn't get buried under an oversized canvas. The "Generate with AI" panel moved out of the cramped 14rem side rail into a full-width section with a multi-row prompt textarea instead of a one-line input. Double-clicking a text element to edit it no longer shows a near-opaque white box that made light/white-fill text invisible while editing - the overlay is transparent so the real canvas shows through. The toolbar also gained Excalidraw-style numbered shortcuts (1-5) and a new Arrow tool alongside Rectangle/Ellipse/Text.
