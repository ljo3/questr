---
template: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT_50KNJP2Pb5y0R7OR50FhxB70o3XktCx207-EJ1pEmw&s=10
photos: []
date: 2026-07-04
---

# 🖼️ Collage Request

**Edit this file on GitHub to build a collage.** Change the `template:` URL in
the front matter above to any reference image whose layout and mood you want to
emulate, commit, and push. A GitHub Action
([`.github/workflows/collage-from-template.yml`](.github/workflows/collage-from-template.yml))
picks up the change, reads the template, and builds a matching collage.

How it works:

1. The **`template:`** URL points at a reference collage/layout image.
2. **`photos:`** is an optional list of image URLs to place into the collage.
   Leave it as `[]` to use the bundled sample photos in
   [`collage/sample/`](collage/sample/).
3. On push, the Action runs
   [`python -m collage.from_template`](collage/from_template.py): it asks the
   vision model to emulate the template, runs the optimize/evaluate loop (the
   judge scores each candidate by resemblance to your template), commits the
   finished image to [`collage/output/collage.jpg`](collage/output/collage.jpg),
   uploads it to S3 when credentials are configured, and rewrites the **Result**
   section below.

To supply your own photos, replace the `photos:` block with URLs, e.g.:

```yaml
photos:
  - https://example.com/beach.jpg
  - https://example.com/market.jpg
  - https://example.com/sunset.jpg
```

<!-- RESULT:START -->
## Result

![collage](https://photo-bucket-333886071196-eu-west-3-an.s3.eu-west-3.amazonaws.com/2026-07-04/collage.jpg)

- **Title:** Quiet Blue Reverie
- **Mood:** serene
- **Layout:** polaroid (score 72.0, judge: vision)
- **Theme source:** template-vision
- **Photos:** 5
- **Committed image:** [`collage/output/collage.jpg`](collage/output/collage.jpg)
- **S3:** https://photo-bucket-333886071196-eu-west-3-an.s3.eu-west-3.amazonaws.com/2026-07-04/collage.jpg
- **Built:** 2026-07-04 21:50:15 UTC

<!-- RESULT:END -->
