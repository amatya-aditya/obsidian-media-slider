// main.ts
import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, TFile, MarkdownRenderer, MarkdownView } from "obsidian";
import { compressImage } from "./src/compression";
import { NotesManager } from "./src/notes";
import { DrawingAnnotation } from "./src/drawing";
import { Visualizer, VisualizerOptions } from "./src/visualizer";

interface MediaSliderSettings {
	enableDrawingAnnotation: boolean;
	enableVisualizer: boolean;
	visualizerColor: string;
	visualizerHeight: string;
}

const DEFAULT_SETTINGS: MediaSliderSettings = {
	enableDrawingAnnotation: false,
	enableVisualizer: false,
	visualizerColor: "#00ff00",
	visualizerHeight: "50px"
};

export default class MediaSliderPlugin extends Plugin {
	settings: MediaSliderSettings;
	private filePathCache: Map<string, string> = new Map();
	private markdownCache: Map<string, string> = new Map();
	private notesManager: NotesManager;
	private drawingData: { [key: string]: string } = {};
	private static sliderCounter = 0;

	async onload() {
		console.log("Loading Media Slider Plugin...");
		await this.loadSettings();
		this.addSettingTab(new MediaSliderSettingTab(this.app, this));
		this.notesManager = new NotesManager(this);
		await this.notesManager.load();
		await this.loadDrawingData();
		this.registerMarkdownCodeBlockProcessor("media-slider", (source, el, ctx) => {
			this.createMediaSlider(source, el, ctx);
		});
	}

	// --- Settings Persistence ---
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// --- Force Refresh for Immediate Settings Effect ---
	refreshSliders() {
		this.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
			// Instead of casting to any, check if leaf.view is a MarkdownView with a load method.
			if (leaf.view instanceof MarkdownView && typeof leaf.view.load === "function") {
				leaf.view.load();
			}
		});
	}

	// --- Persistent Drawing Data Management ---
	private async loadDrawingData(): Promise<void> {
		const data = await this.loadData();
		this.drawingData = data?.drawings || {};
	}

	private async saveDrawingData(): Promise<void> {
		const data = (await this.loadData()) || {};
		data.drawings = this.drawingData;
		await this.saveData(data);
	}

	private async cleanupDrawingData(sliderId: string, validFiles: string[]): Promise<void> {
		for (const key of Object.keys(this.drawingData)) {
			if (key.startsWith(`${sliderId}-`)) {
				const mediaFile = key.substring(sliderId.length + 1);
				if (!validFiles.includes(mediaFile)) {
					delete this.drawingData[key];
				}
			}
		}
		await this.saveDrawingData();
	}

	// --- Simple YAML Parser ---
	private parseSimpleYAML(yaml: string): Record<string, any> {
		const result: Record<string, any> = {};
		const lines = yaml.split("\n");
		for (let line of lines) {
			line = line.trim();
			if (!line) continue;
			const separatorIndex = line.indexOf(":");
			if (separatorIndex === -1) continue;
			const key = line.substring(0, separatorIndex).trim();
			let rawValue = line.substring(separatorIndex + 1).trim();
			let value: string | boolean | number;
			if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
				(rawValue.startsWith("'") && rawValue.endsWith("'"))) {
				value = rawValue.slice(1, -1);
			} else if (rawValue === "true") {
				value = true;
			} else if (rawValue === "false") {
				value = false;
			} else if (!isNaN(Number(rawValue))) {
				value = Number(rawValue);
			} else {
				value = rawValue;
			}
			result[key] = value;
		}
		return result;
	}

	// --- Resource Helpers ---
	private getCachedResourcePath(fileName: string): string {
		if (this.filePathCache.has(fileName)) {
			return this.filePathCache.get(fileName)!;
		}
		const path = this.app.vault.adapter.getResourcePath(fileName);
		this.filePathCache.set(fileName, path);
		return path;
	}

	private getMediaSource(fileName: string): string {
		if (fileName.startsWith("http://") || fileName.startsWith("https://")) {
			return fileName;
		}
		let file = this.app.vault.getAbstractFileByPath(fileName);
		if (!file) {
			const matchingFiles = this.app.vault.getFiles().filter(
				f => f.name.toLowerCase() === fileName.toLowerCase()
			);
			if (matchingFiles.length > 0) {
				fileName = matchingFiles[0].path;
			} else {
				console.error("File not found in vault:", fileName);
			}
		}
		return this.getCachedResourcePath(fileName);
	}

	// --- Revised getMarkdownContent without unsafe casting ---
	private async getMarkdownContent(fileName: string): Promise<string> {
		if (this.markdownCache.has(fileName)) {
			return this.markdownCache.get(fileName)!;
		}
		const abstractFile = this.app.vault.getAbstractFileByPath(fileName);
		// Check if the abstractFile is a file by verifying it has an "extension" property.
		if (abstractFile && "extension" in abstractFile) {
			const content = await this.app.vault.read(abstractFile);
			this.markdownCache.set(fileName, content);
			return content;
		}
		return "";
	}

	private throttle<T extends (...args: any[]) => any>(fn: T, delay: number): T {
		let lastCall = 0;
		return ((...args: any[]) => {
			const now = Date.now();
			if (now - lastCall < delay) return;
			lastCall = now;
			return fn(...args);
		}) as T;
	}

	// --- Slider Creation ---
	private createMediaSlider(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const metadataMatch = source.match(/---\n([\s\S]+?)\n---/);
		const mediaContent = source.replace(/---\n[\s\S]+?\n---/, "").trim();
		const mediaFiles = mediaContent.split("\n").map(line => line.trim()).filter(Boolean);

		let settings: any = {
			sliderId: "",
			carouselShowThumbnails: true,
			thumbnailPosition: "bottom",
			captionMode: "below",
			autoplay: false,
			slideshowSpeed: 5,
			width: "100%",
			height: "300px",
			transitionEffect: "fade",
			transitionDuration: 500,
			enhancedView: false,
			interactiveNotes: false
		};

		if (metadataMatch) {
			try {
				const parsedSettings = this.parseSimpleYAML(metadataMatch[1]);
				settings = Object.assign(settings, parsedSettings);
			} catch (error) {
				console.error("Failed to parse media-slider metadata:", error);
			}
		}

		let sliderId = settings.sliderId;
		if (!sliderId) {
			sliderId = `slider-${MediaSliderPlugin.sliderCounter++}`;
		}

		const validFiles = mediaFiles.map(file => {
			let match = file.match(/!?\[\[(.*?)\]\]/);
			if (!match) {
				match = file.match(/!\[\]\((.*?)\)/);
			}
			return match ? match[1] : "";
		}).filter(Boolean);

		if (validFiles.length === 0) {
			el.createEl("p", { text: "No valid media files found." });
			return;
		}

		this.notesManager.cleanupNotesForSlider(sliderId, validFiles).catch(console.error);
		this.cleanupDrawingData(sliderId, validFiles).catch(console.error);

		this.renderSlider(el, validFiles, settings, sliderId);
	}

	// --- Render Slider UI ---
	private renderSlider(container: HTMLElement, files: string[], settings: any, sliderId: string) {
		container.empty();
		let updateDrawingOverlay: ((mediaKey: string) => void) | undefined;
		const sliderWrapper = container.createDiv("media-slider-wrapper");

		// Layout classes based on thumbnail position
		if (settings.carouselShowThumbnails && (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right")) {
			sliderWrapper.classList.add("flex-row");
		} else {
			sliderWrapper.classList.add("flex-column", "center");
		}

		const sliderContent = sliderWrapper.createDiv("slider-content");
		// Inline width assignment removed in favor of CSS

		const sliderContainer = sliderContent.createDiv("slider-container");
		// Inline width and height removed; CSS now handles these

		const captionContainer = sliderContent.createDiv("slider-caption-container");

		let thumbnailContainer: HTMLElement | null = null;
		let thumbnailEls: HTMLElement[] = [];
		if (settings.carouselShowThumbnails) {
			thumbnailContainer = document.createElement("div");
			thumbnailContainer.classList.add("thumbnail-container");
			if (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right") {
				thumbnailContainer.classList.add("vertical");
			} else {
				thumbnailContainer.classList.add("horizontal");
			}
			// Inline thumbnail dimension assignments removed
			if (settings.thumbnailPosition === "top" || settings.thumbnailPosition === "left") {
				sliderWrapper.insertBefore(thumbnailContainer, sliderContent);
			} else if (settings.thumbnailPosition === "bottom" || settings.thumbnailPosition === "right") {
				sliderWrapper.appendChild(thumbnailContainer);
			}
		}

		let currentIndex = 0;
		let currentDirection: "next" | "prev" = "next";

		if (settings.enhancedView) {
			const fullScreenBtn = sliderWrapper.createEl("button", { text: "⛶", cls: "fullscreen-btn" });
			fullScreenBtn.onclick = () => {
				if (!document.fullscreenElement) {
					sliderWrapper.requestFullscreen().catch(err => console.error("Error enabling fullscreen:", err));
					sliderContainer.classList.add("fullscreen-slider");
				} else {
					document.exitFullscreen();
					sliderContainer.classList.remove("fullscreen-slider");
				}
			};

			const copyBtn = sliderWrapper.createEl("button", { text: "📋", cls: "copy-btn" });
			copyBtn.onclick = async () => {
				const currentEntry = files[currentIndex];
				let [fileName] = currentEntry.split("|").map(s => s.trim());
				const markdownLink = `![[${fileName}]]`;
				try {
					await navigator.clipboard.writeText(markdownLink);
					console.log("Copied markdown link to clipboard:", markdownLink);
				} catch (err) {
					console.error("Failed to copy markdown link:", err);
				}
			};
		}

		let notesContainer: HTMLElement | null = null;
		let notesTextarea: HTMLTextAreaElement | null = null;
		let notesToggleBtn: HTMLElement | null = null;
		if (settings.interactiveNotes) {
			notesToggleBtn = sliderWrapper.createEl("button", { text: "📝", cls: "notes-toggle-btn" });
			notesToggleBtn.onclick = () => {
				if (notesContainer) {
					notesContainer.classList.toggle("visible");
					const mediaKey = `${sliderId}-${files[currentIndex]}`;
					if (notesContainer.classList.contains("visible") && notesTextarea) {
						notesTextarea.value = this.notesManager.getNote(mediaKey);
					}
				}
			};

			notesContainer = sliderWrapper.createDiv("notes-container");
			notesTextarea = document.createElement("textarea");
			notesTextarea.classList.add("notes-textarea");
			notesTextarea.placeholder = "Add your notes here...";
			notesContainer.appendChild(notesTextarea);

			const saveNotesBtn = document.createElement("button");
			saveNotesBtn.textContent = "💾";
			saveNotesBtn.classList.add("notes-save-btn");
			saveNotesBtn.onclick = async () => {
				const mediaKey = `${sliderId}-${files[currentIndex]}`;
				if (notesTextarea) {
					await this.notesManager.setNote(mediaKey, notesTextarea.value);
				}
				if (notesContainer) notesContainer.classList.remove("visible");
			};
			notesContainer.appendChild(saveNotesBtn);
		}

		let drawingAnnotation: DrawingAnnotation | null = null;
		let clearDrawingBtn: HTMLElement | null = null;
		if (this.settings.enableDrawingAnnotation) {
			const drawingToggleBtn = sliderWrapper.createEl("button", { text: "✏️", cls: "drawing-toggle-btn" });

			updateDrawingOverlay = (mediaKey: string) => {
				const existingOverlay = sliderContainer.querySelector(".drawing-overlay");
				if (existingOverlay) {
					existingOverlay.remove();
				}
				const savedDrawing = this.drawingData[mediaKey];
				if (savedDrawing) {
					const overlay = sliderContainer.createEl("img", { attr: { src: savedDrawing } });
					overlay.classList.add("drawing-overlay");
					if (!clearDrawingBtn) {
						clearDrawingBtn = sliderWrapper.createEl("button", { text: "🗑️", cls: "clear-drawing-btn" });
						clearDrawingBtn.onclick = async () => {
							delete this.drawingData[mediaKey];
							await this.saveDrawingData();
							const existingOverlay = sliderContainer.querySelector(".drawing-overlay");
							if (existingOverlay) existingOverlay.remove();
							clearDrawingBtn!.remove();
							clearDrawingBtn = null;
						};
					}
				} else {
					if (clearDrawingBtn) {
						clearDrawingBtn.remove();
						clearDrawingBtn = null;
					}
				}
			};

			drawingToggleBtn.onclick = async () => {
				const mediaKey = `${sliderId}-${files[currentIndex]}`;
				if (drawingAnnotation) {
					const drawingDataUrl = drawingAnnotation.getAnnotation();
					this.drawingData[mediaKey] = drawingDataUrl;
					await this.saveDrawingData();
					drawingAnnotation.destroy();
					drawingAnnotation = null;
					drawingToggleBtn.textContent = "✏️";
					updateDrawingOverlay?.(mediaKey);
				} else {
					if (this.drawingData[mediaKey]) {
						delete this.drawingData[mediaKey];
						await this.saveDrawingData();
						const existingOverlay = sliderContainer.querySelector(".drawing-overlay");
						if (existingOverlay) existingOverlay.remove();
						if (clearDrawingBtn) {
							clearDrawingBtn.remove();
							clearDrawingBtn = null;
						}
					}
					drawingAnnotation = new DrawingAnnotation(sliderContainer);
					drawingToggleBtn.textContent = "💾";
				}
			};
		}

		container.appendChild(sliderWrapper);

		const prevBtn = sliderContent.createEl("button", { text: "⮜", cls: "slider-btn prev" });
		const nextBtn = sliderContent.createEl("button", { text: "⮞", cls: "slider-btn next" });

		const updateMediaDisplay = async () => {
			// Remove any previous transition classes.
			sliderContainer.classList.remove(
				"transition-fade-out", "transition-slide-next-out", "transition-slide-prev-out", "transition-zoom-out",
				"transition-slide-up-out", "transition-slide-down-out", "transition-flip-out", "transition-flip-vertical-out",
				"transition-rotate-out", "transition-blur-out", "transition-squeeze-out"
			);
			
			switch (settings.transitionEffect) {
				case "fade":
					sliderContainer.classList.add("transition-fade-out");
					break;
				case "slide":
					sliderContainer.classList.add(currentDirection === "next" ? "transition-slide-next-out" : "transition-slide-prev-out");
					break;
				case "zoom":
					sliderContainer.classList.add("transition-zoom-out");
					break;
				case "slide-up":
					sliderContainer.classList.add("transition-slide-up-out");
					break;
				case "slide-down":
					sliderContainer.classList.add("transition-slide-down-out");
					break;
				case "flip":
					sliderContainer.classList.add("transition-flip-out");
					break;
				case "flip-vertical":
					sliderContainer.classList.add("transition-flip-vertical-out");
					break;
				case "rotate":
					sliderContainer.classList.add("transition-rotate-out");
					break;
				case "blur":
					sliderContainer.classList.add("transition-blur-out");
					break;
				case "squeeze":
					sliderContainer.classList.add("transition-squeeze-out");
					break;
				default:
					sliderContainer.classList.add("transition-fade-out");
			}

			setTimeout(async () => {
				sliderContainer.empty();
				if (settings.captionMode === "below") captionContainer.empty();
				if (thumbnailEls.length > 0) {
					thumbnailEls.forEach((thumb, idx) => {
						thumb.classList.toggle("active-thumbnail", idx === currentIndex);
					});
				}

				const currentEntry = files[currentIndex];
				let [fileName, caption] = currentEntry.split("|").map(s => s.trim());
				if (!fileName.includes(".")) {
					const mdFile = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
					if (mdFile && mdFile.extension === "md") {
						fileName = mdFile.path;
					}
				}
				const filePath = this.getMediaSource(fileName);

				if (/\.(png|jpg|jpeg|gif)$/i.test(fileName)) {
					try {
						const compressedUrl = await compressImage(filePath, 800, 600, 0.7);
						const img = sliderContainer.createEl("img", { attr: { src: compressedUrl } });
						img.classList.add("slider-media");
					} catch (err) {
						const img = sliderContainer.createEl("img", { attr: { src: filePath } });
						img.classList.add("slider-media");
					}
				} else if (/\.(mp4|webm)$/i.test(fileName)) {
					const video = sliderContainer.createEl("video", { attr: { src: filePath, controls: "true" } });
					if (settings.autoplay) video.setAttribute("autoplay", "true");
					video.classList.add("slider-media");
					if (this.settings.enableVisualizer) {
						new Visualizer(video, sliderContainer, {
							color: this.settings.visualizerColor,
							height: this.settings.visualizerHeight
						});
					}
				} else if (/\.(mp3|ogg|wav)$/i.test(fileName)) {
					const audio = sliderContainer.createEl("audio", { attr: { src: filePath, controls: "true" } });
					audio.classList.add("slider-media", "audio-media");
					if (this.settings.enableVisualizer) {
						new Visualizer(audio, sliderContainer, {
							color: this.settings.visualizerColor,
							height: this.settings.visualizerHeight
						});
					}
				} else if (/\.(pdf)$/i.test(fileName)) {
					const iframe = sliderContainer.createEl("iframe", { attr: { src: filePath, width: "100%", height: "100%" } });
					iframe.classList.add("slider-media");
				} else if (/\.(md)$/i.test(fileName)) {
					const abstractFile = this.app.vault.getAbstractFileByPath(fileName);
					if (abstractFile && "extension" in abstractFile) {
						const content = await this.getMarkdownContent(fileName);
						sliderContainer.empty();
						await MarkdownRenderer.renderMarkdown(content, sliderContainer, abstractFile.path, this);
					}
				} else {
					const link = sliderContainer.createEl("a", { text: "Open File", attr: { href: filePath, target: "_blank" } });
					link.classList.add("slider-media");
				}

				if (caption) {
					if (settings.captionMode === "overlay") {
						const capEl = sliderContainer.createEl("div", { text: caption });
						capEl.classList.add("slider-caption-overlay");
					} else {
						const capEl = captionContainer.createEl("div", { text: caption });
						capEl.classList.add("slider-caption");
					}
				}

				if (settings.interactiveNotes && notesTextarea) {
					const mediaKey = `${sliderId}-${files[currentIndex]}`;
					notesTextarea.value = this.notesManager.getNote(mediaKey);
				}

				if (this.settings.enableDrawingAnnotation) {
					const mediaKey = `${sliderId}-${files[currentIndex]}`;
					updateDrawingOverlay?.(mediaKey);
				}

				// Remove out transition classes and add in transition classes
				sliderContainer.classList.remove(
					"transition-fade-out", "transition-slide-next-out", "transition-slide-prev-out", "transition-zoom-out",
					"transition-slide-up-out", "transition-slide-down-out", "transition-flip-out", "transition-flip-vertical-out",
					"transition-rotate-out", "transition-blur-out", "transition-squeeze-out"
				);
				switch (settings.transitionEffect) {
					case "fade":
						sliderContainer.classList.add("transition-fade-in");
						break;
					case "slide":
						sliderContainer.classList.add(currentDirection === "next" ? "transition-slide-next-in" : "transition-slide-prev-in");
						break;
					case "zoom":
						sliderContainer.classList.add("transition-zoom-in");
						break;
					case "slide-up":
						sliderContainer.classList.add("transition-slide-up-in");
						break;
					case "slide-down":
						sliderContainer.classList.add("transition-slide-down-in");
						break;
					case "flip":
						sliderContainer.classList.add("transition-flip-in");
						break;
					case "flip-vertical":
						sliderContainer.classList.add("transition-flip-vertical-in");
						break;
					case "rotate":
						sliderContainer.classList.add("transition-rotate-in");
						break;
					case "blur":
						sliderContainer.classList.add("transition-blur-in");
						break;
					case "squeeze":
						sliderContainer.classList.add("transition-squeeze-in");
						break;
					default:
						sliderContainer.classList.add("transition-fade-in");
				}
			}, settings.transitionDuration);
		};

		const throttledUpdate = this.throttle(updateMediaDisplay, 100);
		const goPrev = () => {
			currentDirection = "prev";
			currentIndex = (currentIndex - 1 + files.length) % files.length;
			throttledUpdate();
		};
		const goNext = () => {
			currentDirection = "next";
			currentIndex = (currentIndex + 1) % files.length;
			throttledUpdate();
		};

		prevBtn.onclick = goPrev;
		nextBtn.onclick = goNext;

		sliderContent.addEventListener("mouseenter", () => sliderContent.focus());
		sliderContent.addEventListener("mouseleave", () => sliderContent.blur());
		sliderContent.tabIndex = 0;
		sliderContent.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "ArrowLeft") goPrev();
			else if (evt.key === "ArrowRight") goNext();
		});
		sliderContent.addEventListener("wheel", (evt: WheelEvent) => {
			if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) {
				if (evt.deltaX > 30) {
					goNext();
					evt.preventDefault();
				} else if (evt.deltaX < -30) {
					goPrev();
					evt.preventDefault();
				}
			}
		});
		let touchStartX = 0;
		sliderContent.addEventListener("touchstart", (evt: TouchEvent) => {
			touchStartX = evt.touches[0].clientX;
		});
		sliderContent.addEventListener("touchend", (evt: TouchEvent) => {
			const touchEndX = evt.changedTouches[0].clientX;
			const diff = touchStartX - touchEndX;
			if (Math.abs(diff) > 50) diff > 0 ? goNext() : goPrev();
		});

		throttledUpdate();

		if (thumbnailContainer) {
			thumbnailContainer.empty();
			files.forEach((entry, index) => {
				let [fileName] = entry.split("|").map(s => s.trim());
				let thumbEl: HTMLElement;
				if (/\.(png|jpg|jpeg|gif)$/i.test(fileName)) {
					thumbEl = thumbnailContainer.createEl("img", {
						attr: { src: this.getMediaSource(fileName) },
						cls: "thumbnail"
					});
				} else {
					const ext = fileName.split('.').pop()?.toUpperCase() || "FILE";
					thumbEl = thumbnailContainer.createEl("div", { text: ext });
					thumbEl.classList.add("thumbnail-placeholder");
				}
				if (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right") {
					thumbEl.classList.add("vertical-thumb");
				}
				thumbEl.onclick = () => {
					currentIndex = index;
					throttledUpdate();
				};
				thumbnailEls.push(thumbEl);
			});
		}

		if (settings.slideshowSpeed > 0) {
			setInterval(goNext, settings.slideshowSpeed * 1000);
		}
	}
}

class MediaSliderSettingTab extends PluginSettingTab {
	plugin: MediaSliderPlugin;

	constructor(app: App, plugin: MediaSliderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Media Slider Plugin Settings" });

		new Setting(containerEl)
			.setName("Enable Drawing Annotation")
			.setDesc("Toggle to enable drawing annotations on the slider. (Default: off)")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDrawingAnnotation)
				.onChange(async (value) => {
					this.plugin.settings.enableDrawingAnnotation = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);

		new Setting(containerEl)
			.setName("Enable Visualizer")
			.setDesc("Toggle to enable wave-like visualization for audio/video playback.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableVisualizer)
				.onChange(async (value) => {
					this.plugin.settings.enableVisualizer = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);

		new Setting(containerEl)
			.setName("Visualizer Color")
			.setDesc("CSS color value for the visualizer wave.")
			.addText(text => text
				.setValue(this.plugin.settings.visualizerColor)
				.onChange(async (value) => {
					this.plugin.settings.visualizerColor = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);

		new Setting(containerEl)
			.setName("Visualizer Height")
			.setDesc("Height of the visualizer (e.g., '50px').")
			.addText(text => text
				.setValue(this.plugin.settings.visualizerHeight)
				.onChange(async (value) => {
					this.plugin.settings.visualizerHeight = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
	}
}
