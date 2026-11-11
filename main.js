'use strict';

const {
  Plugin,
  PluginSettingTab,
  Setting,
  FuzzySuggestModal,
  TFile,
  TFolder,
  debounce,
  normalizePath,
  Notice,
} = require('obsidian');

const DEFAULT_SETTINGS = {
  property: 'image-icon',
  shape: 'circle',
  size: 18,
  folders: true,
  tabs: true,
  // Images for files and folders that have no frontmatter (folders without a folder note,
  // PDFs, canvases, images…): { "path/to/item": "path/to/image.png" }
  icons: {},
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const ICON_CLASS = 'image-icons-icon';
const HAS_ICON_CLASS = 'image-icons-has-icon';
const HIDDEN_CLASS = 'image-icons-hidden';
const TITLE_SELECTOR = '.nav-file-title[data-path], .nav-folder-title[data-path]';

function isImage(file) {
  return file instanceof TFile && IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

module.exports = class ImageIconsPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.icons = Object.assign({}, this.settings.icons);
    this.observers = new Map();
    this.applyBodyStyles();
    this.addSettingTab(new ImageIconsSettingTab(this.app, this));

    this.requestRefresh = debounce(() => this.refreshAll(), 150, true);

    this.app.workspace.onLayoutReady(() => {
      this.attachObservers();
      this.refreshAll();
    });

    this.registerEvent(this.app.metadataCache.on('changed', () => this.requestRefresh()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.onDelete(file)));
    this.registerEvent(this.app.workspace.on('file-open', () => this.requestRefresh()));
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.attachObservers();
        this.requestRefresh();
      })
    );

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => this.addMenuItems(menu, file)));

    this.addCommand({
      id: 'set-image-icon',
      name: 'Set image icon for current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.chooseImage(file);
        return true;
      },
    });
    this.addCommand({
      id: 'remove-image-icon',
      name: 'Remove image icon from current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.hasIcon(file)) return false;
        if (!checking) this.removeIcon(file);
        return true;
      },
    });
  }

  onunload() {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    document.querySelectorAll('.' + ICON_CLASS).forEach((el) => el.remove());
    document.querySelectorAll('.' + HAS_ICON_CLASS).forEach((el) => el.removeClass(HAS_ICON_CLASS));
    document.querySelectorAll('.' + HIDDEN_CLASS).forEach((el) => el.removeClass(HIDDEN_CLASS));
    document.body.removeClass('image-icons-circle');
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyBodyStyles();
    this.refreshAll();
  }

  async saveIcons() {
    await this.saveData(this.settings);
    this.requestRefresh();
  }

  // Keep stored icons attached to their items (and images) when things are renamed or moved.
  async onRename(file, oldPath) {
    const icons = this.settings.icons;
    let changed = false;
    const prefix = oldPath + '/';
    for (const key of Object.keys(icons)) {
      let newKey = key;
      if (key === oldPath) newKey = file.path;
      else if (key.startsWith(prefix)) newKey = file.path + '/' + key.slice(prefix.length);
      let value = icons[key];
      if (value === oldPath) value = file.path;
      else if (value.startsWith(prefix)) value = file.path + '/' + value.slice(prefix.length);
      if (newKey !== key || value !== icons[key]) {
        delete icons[key];
        icons[newKey] = value;
        changed = true;
      }
    }
    if (changed) await this.saveIcons();
    else this.requestRefresh();
  }

  async onDelete(file) {
    const icons = this.settings.icons;
    const prefix = file.path + '/';
    let changed = false;
    for (const key of Object.keys(icons)) {
      if (key === file.path || key.startsWith(prefix)) {
        delete icons[key];
        changed = true;
      }
    }
    if (changed) await this.saveIcons();
    else this.requestRefresh();
  }

  applyBodyStyles() {
    document.body.toggleClass('image-icons-circle', this.settings.shape === 'circle');
    document.body.setCssProps({ '--image-icons-size': this.settings.size + 'px' });
  }

  // ---------------------------------------------------------------------------
  // Resolving the image for a file or folder

  /** Raw frontmatter value of the icon property (string) or null. */
  getIconValue(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache && cache.frontmatter;
    if (!frontmatter) return null;
    let value = frontmatter[this.settings.property];
    if (Array.isArray(value)) value = value[0];
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim();
  }

  /** Resource URL of the image assigned to a markdown note, or null. */
  getImageSrcForNote(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return null;
    const value = this.getIconValue(file);
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;

    const key = this.settings.property;
    const cache = this.app.metadataCache.getFileCache(file);
    const fmLink = cache.frontmatterLinks && cache.frontmatterLinks.find((l) => l.key === key || l.key === key + '.0');
    let linkpath = fmLink ? fmLink.link : value.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0];
    linkpath = linkpath.split('#')[0].trim();
    if (!linkpath) return null;

    const target =
      this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path) ||
      this.app.vault.getAbstractFileByPath(normalizePath(linkpath));
    return isImage(target) ? this.app.vault.getResourcePath(target) : null;
  }

  /** Folder note of a folder: "Folder/Folder.md" (inside) or "Folder.md" next to it (outside). */
  getFolderNote(folder) {
    const inside = this.app.vault.getAbstractFileByPath(`${folder.path}/${folder.name}.md`);
    if (inside instanceof TFile) return inside;
    const parent = folder.parent && !folder.parent.isRoot() ? folder.parent.path + '/' : '';
    const outside = this.app.vault.getAbstractFileByPath(`${parent}${folder.name}.md`);
    return outside instanceof TFile ? outside : null;
  }

  /** Resource URL of an image stored in the plugin data for this path, or null. */
  getStoredImageSrc(path) {
    const imagePath = this.settings.icons[path];
    if (!imagePath) return null;
    if (/^https?:\/\//i.test(imagePath)) return imagePath;
    const image = this.app.vault.getAbstractFileByPath(imagePath);
    return isImage(image) ? this.app.vault.getResourcePath(image) : null;
  }

  /** Where the image of a file/folder is (or would be) kept: its own note or folder note, else the plugin data. */
  getIconNote(file) {
    if (file instanceof TFile && file.extension === 'md') return file;
    if (file instanceof TFolder && this.settings.folders) return this.getFolderNote(file);
    return null;
  }

  getImageSrcForFile(file) {
    if (!file) return null;
    const note = this.getIconNote(file);
    return (note && this.getImageSrcForNote(note)) || this.getStoredImageSrc(file.path);
  }

  getImageSrcForPath(path) {
    return this.getImageSrcForFile(this.app.vault.getAbstractFileByPath(path));
  }

  hasIcon(file) {
    const note = this.getIconNote(file);
    return !!((note && this.getIconValue(note)) || this.settings.icons[file.path]);
  }

  // ---------------------------------------------------------------------------
  // Rendering

  setIcon(containerEl, src) {
    let img = containerEl.querySelector(':scope > .' + ICON_CLASS);
    if (!src) {
      if (img) img.remove();
      containerEl.removeClass(HAS_ICON_CLASS);
      return;
    }
    if (!img) {
      img = createEl('img', { cls: ICON_CLASS, attr: { draggable: 'false', loading: 'lazy', alt: '' } });
      containerEl.insertBefore(img, containerEl.firstChild);
    }
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    containerEl.addClass(HAS_ICON_CLASS);
  }

  refreshTitle(titleEl) {
    const path = titleEl.getAttribute('data-path');
    if (path == null) return;
    const src = this.getImageSrcForPath(path);
    // Hide icons added by other icon plugins (e.g. Iconize) when an image is shown.
    titleEl.querySelectorAll(':scope > .iconize-icon').forEach((el) => el.toggleClass(HIDDEN_CLASS, !!src));
    this.setIcon(titleEl, src);
  }

  refreshWithin(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    if (rootEl.matches && rootEl.matches(TITLE_SELECTOR)) this.refreshTitle(rootEl);
    rootEl.querySelectorAll(TITLE_SELECTOR).forEach((el) => this.refreshTitle(el));
  }

  refreshTabs() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const iconEl = leaf.tabHeaderInnerIconEl;
      if (!iconEl) return;
      const file = this.settings.tabs && leaf.view && leaf.view.file;
      this.setIcon(iconEl, file ? this.getImageSrcForFile(file) : null);
    });
  }

  refreshAll() {
    this.app.workspace.getLeavesOfType('file-explorer').forEach((leaf) => this.refreshWithin(leaf.view.containerEl));
    this.refreshTabs();
  }

  /**
   * The file explorer renders rows lazily (scrolling, expanding folders),
   * so new rows are picked up with a MutationObserver per explorer view.
   */
  attachObservers() {
    const alive = new Set();
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const el = leaf.view.containerEl;
      alive.add(el);
      if (this.observers.has(el)) continue;

      let pending = [];
      const flush = debounce(
        () => {
          const nodes = pending;
          pending = [];
          nodes.forEach((node) => {
            if (node.isConnected) this.refreshWithin(node);
          });
        },
        50,
        false
      );
      const observer = new MutationObserver((mutations) => {
        let added = false;
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains(ICON_CLASS)) {
              pending.push(node);
              added = true;
            }
          });
        }
        if (added) flush();
      });
      observer.observe(el, { childList: true, subtree: true });
      this.observers.set(el, observer);
    }
    for (const [el, observer] of this.observers) {
      if (!alive.has(el)) {
        observer.disconnect();
        this.observers.delete(el);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Setting / removing the image

  addMenuItems(menu, file) {
    if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
    if (file instanceof TFolder && file.isRoot()) return;

    menu.addItem((item) =>
      item
        .setTitle('Set image icon…')
        .setIcon('image')
        .setSection('action')
        .onClick(() => this.chooseImage(file))
    );
    if (this.hasIcon(file)) {
      menu.addItem((item) =>
        item
          .setTitle('Remove image icon')
          .setIcon('image-minus')
          .setSection('action')
          .onClick(() => this.removeIcon(file))
      );
    }
  }

  chooseImage(file) {
    new ImageSuggestModal(this.app, this, (image) => this.assignImage(file, image)).open();
  }

  /** Notes (and folders with a folder note) keep the image in frontmatter, everything else in plugin data. */
  async assignImage(file, image) {
    const note = this.getIconNote(file);
    if (note) {
      const linktext = this.app.metadataCache.fileToLinktext(image, note.path, false);
      await this.updateFrontmatter(note, (frontmatter) => {
        frontmatter[this.settings.property] = `[[${linktext}]]`;
      });
      if (this.settings.icons[file.path]) {
        delete this.settings.icons[file.path];
        await this.saveIcons();
      }
    } else {
      this.settings.icons[file.path] = image.path;
      await this.saveIcons();
    }
  }

  async removeIcon(file) {
    const note = this.getIconNote(file);
    if (note && this.getIconValue(note)) {
      await this.updateFrontmatter(note, (frontmatter) => {
        delete frontmatter[this.settings.property];
      });
    }
    if (this.settings.icons[file.path]) {
      delete this.settings.icons[file.path];
      await this.saveIcons();
    }
  }

  /** Runs a frontmatter change on a note that may have been deleted or moved meanwhile. */
  async updateFrontmatter(note, change) {
    const current = this.app.vault.getAbstractFileByPath(note.path);
    if (!(current instanceof TFile)) {
      new Notice(`Image Icons: "${note.basename}" no longer exists.`);
      return;
    }
    try {
      await this.app.fileManager.processFrontMatter(current, change);
    } catch (error) {
      new Notice(`Image Icons: could not update "${current.basename}". ${error && error.message ? error.message : ''}`);
    }
  }

};

class ImageSuggestModal extends FuzzySuggestModal {
  constructor(app, plugin, onChoose) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
    this.setPlaceholder('Choose an image from the vault…');
    this.modalEl.addClass('image-icons-modal');
  }

  getItems() {
    return this.app.vault.getFiles().filter(isImage);
  }

  getItemText(file) {
    return file.path;
  }

  renderSuggestion(match, el) {
    el.addClass('image-icons-suggestion');
    el.createEl('img', {
      cls: 'image-icons-suggestion-thumb',
      attr: { src: this.app.vault.getResourcePath(match.item), loading: 'lazy', alt: '' },
    });
    const textEl = el.createDiv({ cls: 'image-icons-suggestion-text' });
    super.renderSuggestion(match, textEl);
  }

  onChooseItem(file) {
    this.onChoose(file);
  }
}

class ImageIconsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Property name')
      .setDesc('Frontmatter property that holds the image, e.g. image-icon: "[[cat.png]]". Existing notes are not renamed when you change it.')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.property)
          .setValue(plugin.settings.property)
          .onChange(async (value) => {
            plugin.settings.property = value.trim() || DEFAULT_SETTINGS.property;
            await plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName('Shape').addDropdown((dropdown) =>
      dropdown
        .addOption('circle', 'Circle')
        .addOption('square', 'Rounded square')
        .setValue(plugin.settings.shape)
        .onChange(async (value) => {
          plugin.settings.shape = value;
          await plugin.saveSettings();
        })
    );

    new Setting(containerEl).setName('Size').setDesc('In pixels.').addSlider((slider) =>
      slider
        .setLimits(12, 32, 1)
        .setValue(plugin.settings.size)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.size = value;
          await plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName('Folder icons from folder notes')
      .setDesc('A folder shows the image of its folder note ("Folder/Folder.md" or "Folder.md" next to the folder).')
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.folders).onChange(async (value) => {
          plugin.settings.folders = value;
          await plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Show in tab headers')
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.tabs).onChange(async (value) => {
          plugin.settings.tabs = value;
          await plugin.saveSettings();
        })
      );
  }
}
