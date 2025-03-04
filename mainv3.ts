// main.ts
import {
	Plugin,
	PluginSettingTab,
	App,
	Setting,
	MarkdownPostProcessorContext,
	TFile,
	MarkdownRenderer,
	MarkdownView,
    parseYaml
} from "obsidian";
import { compressImage } from "./src/compression";
import { NotesManager } from "./src/notes";
import { DrawingAnnotation } from "./src/drawing";
import { Visualizer, VisualizerOptions } from "./src/visualizer";

interface MediaSliderSettings {
	// Existing settings
	enableDrawingAnnotation: boolean;
	enableVisualizer: boolean;
	visualizerColor: string;
	visualizerHeight: string;
	attachmentLocation: "default" | "custom" | "same";
	customAttachmentFolder: string;
	// New settings for image manipulation:
	enableImageManipulation: boolean;
	defaultFlip: "none" | "horizontal" | "vertical" | "both";
	defaultRotate: number;
	defaultZoom: number;
	defaultPanX: number;
	defaultPanY: number;
	// New compression quality option:
	compressionQuality: number;
}

const DEFAULT_SETTINGS: MediaSliderSettings = {
	enableDrawingAnnotation: false,
	enableVisualizer: false,
	visualizerColor: "#00ff00",
	visualizerHeight: "50px",
	attachmentLocation: "default",
	customAttachmentFolder: "SliderAttachment",
	// New image manipulation defaults:
	enableImageManipulation: false,
	defaultFlip: "none",
	defaultRotate: 0,
	defaultZoom: 1,
	defaultPanX: 0,
	defaultPanY: 0,
	// Compression quality default (0.7 means 70% quality)
	compressionQuality: 0.7
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

		// Register code block processor (for preview mode)
		this.registerMarkdownCodeBlockProcessor("media-slider", (source, el, ctx) => {
			this.createMediaSlider(source, el, ctx);
		});

		// Register editor-paste event for live preview mode.
		this.registerEvent(
			this.app.workspace.on("editor-paste", async (evt: ClipboardEvent, editor: any) => {
				const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!mdView) return;
				const clipboardData = evt.clipboardData;
				if (!clipboardData) return;
				for (const item of clipboardData.items) {
					if (item.type.indexOf("image") !== -1) {
						const file = item.getAsFile();
						if (!file) continue;
						const reader = new FileReader();
						reader.onload = async (e) => {
							const dataUrl = e.target?.result as string;
							const response = await fetch(dataUrl);
							const blob = await response.blob();
							const arrayBuffer = await blob.arrayBuffer();
							const uint8Array = new Uint8Array(arrayBuffer);
							let folderPath: string;
							if (this.settings.attachmentLocation === "default") {
								folderPath = this.app.vault.getConfig("attachmentFolderPath") || "";
							} else if (this.settings.attachmentLocation === "custom") {
								folderPath = this.settings.customAttachmentFolder;
							} else {
								folderPath = mdView.file.parent.path;
							}
							if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
								try {
									await this.app.vault.createFolder(folderPath);
								} catch (error) {
									console.error("Error creating folder:", error);
								}
							}
							const newFileName = folderPath
								? `${folderPath}/pasteimage-${Date.now()}.png`
								: `pasteimage-${Date.now()}.png`;
							try {
								await this.app.vault.createBinary(newFileName, uint8Array);
							} catch (error) {
								console.error("Error creating pasted image file:", error);
							}
							const cmEditor = editor.cm;
							const doc = cmEditor.getDoc();
							const cursor = doc.getCursor();
							doc.replaceRange(`[[${newFileName}]]\n`, cursor);
							evt.preventDefault();
						};
						reader.readAsDataURL(file);
						break;
					}
				}
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	refreshSliders() {
		this.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
			if (leaf.view instanceof MarkdownView && typeof leaf.view.load === "function") {
				leaf.view.load();
			}
		});
	}

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

	// A simple YAML parser.
	private parseYAML(yaml: string): Record<string, any> {
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

	private isYouTubeURL(url: string): boolean {
		return url.includes("youtube.com/watch") || url.includes("youtu.be/");
	}

	private getYouTubeEmbedURL(url: string): string {
		let videoId = "";
		const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/;
		const match = url.match(youtubeRegex);
		if (match && match[1]) {
			videoId = match[1];
		}
		return `https://www.youtube.com/embed/${videoId}`;
	}

	private getYouTubeThumbnail(url: string): string {
		let videoId = "";
		const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/;
		const match = url.match(youtubeRegex);
		if (match && match[1]) {
			videoId = match[1];
		}
		return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
	}

	private async getMarkdownContent(fileName: string): Promise<string> {
		if (this.markdownCache.has(fileName)) {
			return this.markdownCache.get(fileName)!;
		}
		const abstractFile = this.app.vault.getAbstractFileByPath(fileName);
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

	private async appendImageToCodeBlock(ctx: MarkdownPostProcessorContext, fileName: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile;
		if (!file) {
			console.warn("Could not find file for this code block. (ctx.sourcePath:", ctx.sourcePath, ")");
			return;
		}
		const fileContent = await this.app.vault.read(file);
		const updatedContent = fileContent.replace(
			/(```media-slider[\s\S]+?```)/,
			(match) => {
				return match.replace(/```$/, `[[${fileName}]]\n\`\`\``);
			}
		);
		if (updatedContent === fileContent) {
			console.log("No media-slider code block replaced. Possibly none found or multiple blocks exist.");
			return;
		}
		await this.app.vault.modify(file, updatedContent);
	}

	private createMediaSlider(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Parse YAML metadata (if any) from the code block.
		const metadataMatch = source.match(/---\n([\s\S]+?)\n---/);
		const mediaContent = source.replace(/---\n[\s\S]+?\n---/, "").trim();
		const mediaFiles = mediaContent.split("\n").map(line => line.trim()).filter(Boolean);
		let settings: any = {
			sliderId: "",
			carouselShowThumbnails: true,
			thumbnailPosition: "bottom",
			captionMode: "overlay",
			autoplay: false,
			slideshowSpeed: 0,
			width: "100%",
			height: "350px",
			transitionEffect: "fade",
			transitionDuration: 100,
			enhancedView: true,
			interactiveNotes: false,
			// Slider-specific settings for image manipulation and compression.
			enableImageManipulation: false,
			compression: undefined
		};
		if (metadataMatch) {
			try {
				const parsedSettings = this.parseYAML(metadataMatch[1]);
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
		this.renderSlider(el, validFiles, settings, sliderId, ctx);
	}

	private renderSlider(
		container: HTMLElement,
		files: string[],
		settings: any,
		sliderId: string,
		ctx: MarkdownPostProcessorContext
	) {
		container.empty();
		let updateDrawingOverlay: ((mediaKey: string) => void) | undefined;
		const sliderWrapper = container.createDiv("media-slider-wrapper");
		if (settings.carouselShowThumbnails &&
			(settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right")) {
			sliderWrapper.classList.add("flex-row");
		} else {
			sliderWrapper.classList.add("flex-column", "center");
		}
		const sliderContent = sliderWrapper.createDiv("slider-content");
		sliderContent.style.setProperty('--slider-width', settings.width);
		sliderContent.style.setProperty('--slider-height', settings.height);
		sliderContent.style.setProperty('--transition-duration', settings.transitionDuration + 'ms');
		const sliderContainer = sliderContent.createDiv("slider-container");
		const mediaWrapper = sliderContainer.createDiv("media-wrapper");
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
			if (settings.thumbnailPosition === "top" || settings.thumbnailPosition === "left") {
				sliderWrapper.insertBefore(thumbnailContainer, sliderContent);
			} else {
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
							const existingOverlay2 = sliderContainer.querySelector(".drawing-overlay");
							if (existingOverlay2) existingOverlay2.remove();
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
		// Update media display with transitions and media element rendering.
		const updateMediaDisplay = async () => {
			mediaWrapper.classList.remove(
				"transition-fade-in", "transition-slide-next-in", "transition-slide-prev-in", "transition-zoom-in",
				"transition-slide-up-in", "transition-slide-down-in", "transition-flip-in", "transition-flip-vertical-in",
				"transition-rotate-in", "transition-blur-in", "transition-squeeze-in"
			);
			switch (settings.transitionEffect) {
				case "fade":
					mediaWrapper.classList.add("transition-fade-out");
					break;
				case "slide":
					mediaWrapper.classList.add(currentDirection === "next" ? "transition-slide-next-out" : "transition-slide-prev-out");
					break;
				case "zoom":
					mediaWrapper.classList.add("transition-zoom-out");
					break;
				case "slide-up":
					mediaWrapper.classList.add("transition-slide-up-out");
					break;
				case "slide-down":
					mediaWrapper.classList.add("transition-slide-down-out");
					break;
				case "flip":
					mediaWrapper.classList.add("transition-flip-out");
					break;
				case "flip-vertical":
					mediaWrapper.classList.add("transition-flip-vertical-out");
					break;
				case "rotate":
					mediaWrapper.classList.add("transition-rotate-out");
					break;
				case "blur":
					mediaWrapper.classList.add("transition-blur-out");
					break;
				case "squeeze":
					mediaWrapper.classList.add("transition-squeeze-out");
					break;
				default:
					mediaWrapper.classList.add("transition-fade-out");
			}
			setTimeout(async () => {
				mediaWrapper.empty();
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
				// Use YAML compression if provided; otherwise, use the global setting.
				const quality = (settings.compression !== undefined) ? settings.compression : this.settings.compressionQuality;
				if (/\.(png|jpg|jpeg|gif)$/i.test(fileName)) {
					try {
						const compressedUrl = await compressImage(filePath, 800, 600, quality);
						const img = mediaWrapper.createEl("img", { attr: { src: compressedUrl } });
						// Add interactive image manipulation if enabled.
						if (settings.enableImageManipulation || this.settings.enableImageManipulation) {
							if (!sliderWrapper.querySelector(".manipulation-btn")) {
								const manipulationBtn = sliderWrapper.createEl("button", { text: "Edit Image", cls: "manipulation-btn" });
								let isManipulationActive = false;
								let currentTransform = {
									scale: 1,
									translateX: 0,
									translateY: 0,
									rotate: 0,
									flip: "none" as "none" | "horizontal" | "vertical" | "both"
								};
								const updateTransform = () => {
									let transformStr = `translate(${currentTransform.translateX}px, ${currentTransform.translateY}px) scale(${currentTransform.scale}) rotate(${currentTransform.rotate}deg)`;
									if (currentTransform.flip === "horizontal") {
										transformStr += " scaleX(-1)";
									} else if (currentTransform.flip === "vertical") {
										transformStr += " scaleY(-1)";
									} else if (currentTransform.flip === "both") {
										transformStr += " scaleX(-1) scaleY(-1)";
									}
									img.style.transform = transformStr;
									img.style.transformOrigin = "center center";
								};
								let isDragging = false;
								let startX = 0, startY = 0;
								const onMouseDown = (e: MouseEvent) => {
									isDragging = true;
									startX = e.clientX;
									startY = e.clientY;
								};
								const onMouseMove = (e: MouseEvent) => {
									if (!isDragging) return;
									const dx = e.clientX - startX;
									const dy = e.clientY - startY;
									currentTransform.translateX += dx;
									currentTransform.translateY += dy;
									startX = e.clientX;
									startY = e.clientY;
									updateTransform();
								};
								const onMouseUp = () => {
									isDragging = false;
								};
								const onWheel = (e: WheelEvent) => {
									e.preventDefault();
									const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
									currentTransform.scale *= zoomFactor;
									updateTransform();
								};
								const onKeyDown = (e: KeyboardEvent) => {
									const panStep = 10;
									const rotateStep = 15;
									if (e.key === "ArrowUp") {
										currentTransform.translateY -= panStep;
									} else if (e.key === "ArrowDown") {
										currentTransform.translateY += panStep;
									} else if (e.key === "ArrowLeft") {
										currentTransform.translateX -= panStep;
									} else if (e.key === "ArrowRight") {
										currentTransform.translateX += panStep;
									} else if (e.key.toLowerCase() === "r") {
										currentTransform.rotate += rotateStep;
									} else if (e.key.toLowerCase() === "f") {
										currentTransform.flip = currentTransform.flip === "horizontal" ? "none" : "horizontal";
									}
									updateTransform();
								};
								manipulationBtn.onclick = () => {
									if (!isManipulationActive) {
										isManipulationActive = true;
										img.addEventListener("mousedown", onMouseDown);
										window.addEventListener("mousemove", onMouseMove);
										window.addEventListener("mouseup", onMouseUp);
										img.addEventListener("wheel", onWheel);
										window.addEventListener("keydown", onKeyDown);
										manipulationBtn.textContent = "Stop Editing";
									} else {
										isManipulationActive = false;
										img.removeEventListener("mousedown", onMouseDown);
										window.removeEventListener("mousemove", onMouseMove);
										window.removeEventListener("mouseup", onMouseUp);
										img.removeEventListener("wheel", onWheel);
										window.removeEventListener("keydown", onKeyDown);
										manipulationBtn.textContent = "Edit Image";
									}
								};
							}
						}
						img.classList.add("slider-media");
					} catch (err) {
						const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
						img.classList.add("slider-media");
					}
				} else if (/\.(mp4|webm)$/i.test(fileName)) {
					const video = mediaWrapper.createEl("video", { attr: { src: filePath, controls: "true" } });
					if (settings.autoplay) video.setAttribute("autoplay", "true");
					video.classList.add("slider-media");
					if (this.settings.enableVisualizer) {
						new Visualizer(video, sliderContainer, {
							color: this.settings.visualizerColor,
							height: this.settings.visualizerHeight
						});
					}
				} else if (/\.(mp3|ogg|wav)$/i.test(fileName)) {
					const audio = mediaWrapper.createEl("audio", { attr: { src: filePath, controls: "true" } });
					audio.classList.add("slider-media", "audio-media");
					if (this.settings.enableVisualizer) {
						new Visualizer(audio, sliderContainer, {
							color: this.settings.visualizerColor,
							height: this.settings.visualizerHeight
						});
					}
				} else if (/\.(pdf)$/i.test(fileName)) {
					const iframe = mediaWrapper.createEl("iframe", { attr: { src: filePath, width: "100%", height: "100%" } });
					iframe.classList.add("slider-media");
				} else if (/\.(md)$/i.test(fileName)) {
					const abstractFile = this.app.vault.getAbstractFileByPath(fileName);
					if (abstractFile && "extension" in abstractFile) {
						const content = await this.getMarkdownContent(fileName);
						mediaWrapper.empty();
						await MarkdownRenderer.render(this.app, content, mediaWrapper, abstractFile.path, this);
					}
				} else if (this.isYouTubeURL(fileName)) {
					const embedUrl = this.getYouTubeEmbedURL(fileName);
					const iframe = mediaWrapper.createEl("iframe", { 
						attr: { 
							src: embedUrl,
							frameborder: "0", 
							allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture", 
							allowfullscreen: "true" 
						} 
					});
					iframe.style.width = sliderContainer.clientWidth + "px";
					iframe.style.height = sliderContainer.clientHeight + "px";
					iframe.classList.add("slider-media");
				} else {
					const link = mediaWrapper.createEl("a", { text: "Open File", attr: { href: filePath, target: "_blank" } });
					link.classList.add("slider-media");
				}
				if (caption) {
					if (settings.captionMode === "overlay") {
						const capEl = mediaWrapper.createEl("div", { text: caption });
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
				void mediaWrapper.offsetWidth;
				mediaWrapper.classList.remove(
					"transition-fade-out", "transition-slide-next-out", "transition-slide-prev-out", "transition-zoom-out",
					"transition-slide-up-out", "transition-slide-down-out", "transition-flip-out", "transition-flip-vertical-out",
					"transition-rotate-out", "transition-blur-out", "transition-squeeze-out"
				);
				switch (settings.transitionEffect) {
					case "fade":
						mediaWrapper.classList.add("transition-fade-in");
						break;
					case "slide":
						mediaWrapper.classList.add(currentDirection === "next" ? "transition-slide-next-in" : "transition-slide-prev-in");
						break;
					case "zoom":
						mediaWrapper.classList.add("transition-zoom-in");
						break;
					case "slide-up":
						mediaWrapper.classList.add("transition-slide-up-in");
						break;
					case "slide-down":
						mediaWrapper.classList.add("transition-slide-down-in");
						break;
					case "flip":
						mediaWrapper.classList.add("transition-flip-in");
						break;
					case "flip-vertical":
						mediaWrapper.classList.add("transition-flip-vertical-in");
						break;
					case "rotate":
						mediaWrapper.classList.add("transition-rotate-in");
						break;
					case "blur":
						mediaWrapper.classList.add("transition-blur-in");
						break;
					case "squeeze":
						mediaWrapper.classList.add("transition-squeeze-in");
						break;
					default:
						mediaWrapper.classList.add("transition-fade-in");
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
		const prevBtn = sliderContent.createEl("button", { text: "⮜", cls: "slider-btn prev" });
		const nextBtn = sliderContent.createEl("button", { text: "⮞", cls: "slider-btn next" });
		prevBtn.onclick = goPrev;
		nextBtn.onclick = goNext;
		sliderContent.tabIndex = 0;
		sliderContent.addEventListener("mouseenter", () => sliderContent.focus());
		sliderContent.addEventListener("mouseleave", () => sliderContent.blur());
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
				if (this.isYouTubeURL(fileName)) {
					const thumbUrl = this.getYouTubeThumbnail(fileName);
					thumbEl = thumbnailContainer.createEl("img", { attr: { src: thumbUrl }, cls: "thumbnail" });
				} else if (/\.(png|jpg|jpeg|gif)$/i.test(fileName)) {
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
		sliderWrapper.tabIndex = 0;
		sliderWrapper.addEventListener("click", () => {
			sliderWrapper.focus();
		});
		sliderWrapper.addEventListener("paste", async (evt: ClipboardEvent) => {
			const clipboardData = evt.clipboardData;
			if (!clipboardData) return;
			for (const item of clipboardData.items) {
				if (item.type.indexOf("image") !== -1) {
					const file = item.getAsFile();
					if (!file) continue;
					const reader = new FileReader();
					reader.onload = async (e) => {
						const dataUrl = e.target?.result as string;
						const response = await fetch(dataUrl);
						const blob = await response.blob();
						const arrayBuffer = await blob.arrayBuffer();
						const uint8Array = new Uint8Array(arrayBuffer);
						let folderPath: string;
						if (this.settings.attachmentLocation === "default") {
							folderPath = this.app.vault.getConfig("attachmentFolderPath") || "";
						} else if (this.settings.attachmentLocation === "custom") {
							folderPath = this.settings.customAttachmentFolder;
						} else {
							const fileObj = this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile;
							folderPath = fileObj ? fileObj.parent.path : "";
						}
						if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
							try {
								await this.app.vault.createFolder(folderPath);
							} catch (error) {
								console.error("Error creating folder:", error);
							}
						}
						const newFileName = folderPath
							? `${folderPath}/pasteimage-${Date.now()}.png`
							: `pasteimage-${Date.now()}.png`;
						try {
							await this.app.vault.createBinary(newFileName, uint8Array);
						} catch (error) {
							console.error("Error creating pasted image file:", error);
						}
						files.push(`[[${newFileName}]]`);
						throttledUpdate();
						await this.appendImageToCodeBlock(ctx, newFileName);
					};
					reader.readAsDataURL(file);
					break;
				}
			}
		});
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
		new Setting(containerEl)
			.setName("Pasted attachment location")
			.setDesc("Where to save pasted images.")
			.addDropdown(dropdown => {
				dropdown.addOption("default", "Default");
				dropdown.addOption("custom", "Custom folder");
				dropdown.addOption("same", "Same folder as current note");
				dropdown.setValue(this.plugin.settings.attachmentLocation);
				dropdown.onChange(async (value: "default" | "custom" | "same") => {
					this.plugin.settings.attachmentLocation = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName("Custom attachment folder")
			.setDesc("Folder to save pasted images when using the custom option.")
			.addText(text => {
				text.setPlaceholder("SliderAttachment");
				text.setValue(this.plugin.settings.customAttachmentFolder);
				text.onChange(async (value) => {
					this.plugin.settings.customAttachmentFolder = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName("Enable drawing annotation")
			.setDesc("Toggle to enable drawing annotations on the slider. (default: off)")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDrawingAnnotation)
				.onChange(async (value) => {
					this.plugin.settings.enableDrawingAnnotation = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		new Setting(containerEl)
			.setName("Enable visualizer")
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
			.setName("Visualizer color")
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
			.setName("Visualizer height")
			.setDesc("Height of the visualizer (e.g., '50px').")
			.addText(text => text
				.setValue(this.plugin.settings.visualizerHeight)
				.onChange(async (value) => {
					this.plugin.settings.visualizerHeight = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		// Image manipulation settings
		new Setting(containerEl)
			.setName("Enable image manipulation")
			.setDesc("Toggle to enable interactive image manipulation via keyboard/mouse gestures.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableImageManipulation)
				.onChange(async (value) => {
					this.plugin.settings.enableImageManipulation = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		new Setting(containerEl)
			.setName("Default flip")
			.setDesc("Default flip option: 'none', 'horizontal', 'vertical', or 'both'.")
			.addDropdown(dropdown => {
				dropdown.addOption("none", "None");
				dropdown.addOption("horizontal", "Horizontal");
				dropdown.addOption("vertical", "Vertical");
				dropdown.addOption("both", "Both");
				dropdown.setValue(this.plugin.settings.defaultFlip);
				dropdown.onChange(async (value: "none" | "horizontal" | "vertical" | "both") => {
					this.plugin.settings.defaultFlip = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				});
			});
		new Setting(containerEl)
			.setName("Default rotation")
			.setDesc("Default rotation in degrees (e.g., 0, 90, 180).")
			.addText(text => text
				.setPlaceholder("0")
				.setValue(String(this.plugin.settings.defaultRotate))
				.onChange(async (value) => {
					this.plugin.settings.defaultRotate = Number(value);
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		new Setting(containerEl)
			.setName("Default zoom")
			.setDesc("Default zoom scale factor (1 = 100%).")
			.addText(text => text
				.setPlaceholder("1")
				.setValue(String(this.plugin.settings.defaultZoom))
				.onChange(async (value) => {
					this.plugin.settings.defaultZoom = Number(value);
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		new Setting(containerEl)
			.setName("Default pan X")
			.setDesc("Default horizontal pan offset in pixels.")
			.addText(text => text
				.setPlaceholder("0")
				.setValue(String(this.plugin.settings.defaultPanX))
				.onChange(async (value) => {
					this.plugin.settings.defaultPanX = Number(value);
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		new Setting(containerEl)
			.setName("Default pan Y")
			.setDesc("Default vertical pan offset in pixels.")
			.addText(text => text
				.setPlaceholder("0")
				.setValue(String(this.plugin.settings.defaultPanY))
				.onChange(async (value) => {
					this.plugin.settings.defaultPanY = Number(value);
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);
		// Compression quality setting.
		new Setting(containerEl)
			.setName("Compression Quality")
			.setDesc("Set the image compression quality (0 to 1, e.g., 0.7 for 70% quality).")
			.addText(text => text
				.setPlaceholder("0.7")
				.setValue(String(this.plugin.settings.compressionQuality))
				.onChange(async (value) => {
					const parsed = parseFloat(value);
					if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
						this.plugin.settings.compressionQuality = parsed;
						await this.plugin.saveSettings();
						this.plugin.refreshSliders();
					} else {
						console.warn("Please enter a number between 0 and 1.");
					}
				})
			);
	}
}
