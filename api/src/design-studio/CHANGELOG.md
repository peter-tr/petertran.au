# design-studio

## 0.2.0

### Minor Changes

- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- 2356941: add AI-assisted design generation to Design Studio - a "Generate with AI" prompt that produces a set of design elements from a natural-language description (via a new `generateDesignElements` mutation, Anthropic structured output, and a Mongo-backed rate limiter since Design Studio has no DynamoDB table). The result renders as a dashed-outline draft overlay, draggable/resizable independently of the real canvas and outside undo/redo history, until the user explicitly Accepts (adding it to the design) or Discards it.
- 0282fe0: support multiple canvas formats in Design Studio (Poster, Presentation, Resume) instead of one fixed 900x600 size, add a Resume template, and resize the Presentation template to a true 16:9 slideshow canvas
- 00c05fd: add a "Save as template" action to Design Studio's editor, letting the current canvas be saved into the shared templates library (colors auto-derived from the design's own fills, new templates default to popularity 0)
- 6168fb9: personalize Design Studio's starter templates and stop "Use template" from persisting a design until the user explicitly saves it

### Patch Changes

- d2802bd: fix Design Studio's AI generation UX: the draft overlay's yellow outline was hard to see against similarly-colored designs (now a high-contrast pink outline with a glow, visible regardless of the underlying palette); the Accept/Discard buttons were in the wrong order (Discard now sits left/secondary, Accept right/primary, matching standard dialog conventions); and the one-shot prompt form has been replaced with a persistent chat-style panel that stays open across generations, so a follow-up like "make it bigger" refines the current draft instead of starting over.
- Updated dependencies [0d1e57a]
  - api-shared@1.2.0
