# Image Icons

Use **any image from your vault** as the icon of any file or folder — in the file explorer and in tab headers.

Icon plugins usually let you choose from icon packs or emoji. Image Icons lets you use your own pictures instead: a photo of a person in your people notes, a book cover, a project logo, a screenshot…

## Usage

### From the menu

- Right-click **any file or folder** in the file explorer → **Set image icon…** and pick an image (the picker shows thumbnails).
- Right-click → **Remove image icon** to clear it.
- Command palette: **Image Icons: Set image icon for current file** / **Remove image icon from current file**.

Where the image is stored:

- **Notes** (and folders with a folder note) keep it in a frontmatter property — see below.
- **Everything else** (folders without a folder note, PDFs, canvases, images, …) keeps it in the plugin's data. These icons follow the item when you rename or move it, and are cleaned up when you delete it.

### By hand (or from templates)

The image is stored as a normal property in the note's frontmatter:

```yaml
---
image-icon: "[[cat.png]]"
---
```

Any image format Obsidian can display works (PNG, JPG, GIF, WebP, SVG, AVIF, BMP). A plain path (`image-icon: attachments/cat.png`) or an `https://` URL works too. Because it is a regular link, it is updated automatically when you rename or move the image.

### Folders

A folder shows the image of its **folder note** — `Folder/Folder.md` inside the folder, or `Folder.md` next to it (the conventions used by the popular folder note plugins). Setting an image on such a folder writes it to the folder note. Folders without a folder note can have an image too (stored in the plugin's data).

## Settings

- **Property name** — default `image-icon`.
- **Shape** — circle or rounded square.
- **Size** — 12–32 px.
- **Folder icons from folder notes** — on/off.
- **Show in tab headers** — on/off.

## Compatibility

- Works on desktop and mobile.
- Works alongside Iconize: when a file or folder has an image icon, the Iconize icon is hidden for that item; everything else keeps its Iconize icon.

## Installation

From Obsidian: **Settings → Community plugins → Browse**, search for **Image Icons**.

Manually: download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases) into `<vault>/.obsidian/plugins/image-icons/` and enable the plugin.

## License

[MIT](LICENSE)
