import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, TFile, MarkdownRenderer, MarkdownView, parseYaml } from "obsidian";
import { compressImage } from "./src/compression";
import { NotesManager } from "./src/notes";
import { DrawingAnnotation } from "./src/drawing";
import { Visualizer, VisualizerOptions } from "./src/visualizer";

interface MediaSliderSettings {
	enableDrawingAnnotation: boolean;
	enableVisualizer: boolean;
	visualizerColor: string;
	visualizerHeight: string;
	attachmentLocation: "default" | "custom" | "same";
	customAttachmentFolder: string;
	compressionQuality: number;
}

const DEFAULT_SETTINGS: MediaSliderSettings = {
	enableDrawingAnnotation: false,
	enableVisualizer: false,
	visualizerColor: "#00ff00",
	visualizerHeight: "50px",
	attachmentLocation: "default",
	customAttachmentFolder: "SliderAttachment",
	compressionQuality: 0.7
};

export default class MediaSliderPlugin extends Plugin {
	settings: MediaSliderSettings;
	private filePathCache: Map<string, string> = new Map();
	private markdownCache: Map<string, string> = new Map();
	private notesManager: NotesManager;
	private drawingData: { [key: string]: string } = {};
	private static sliderCounter = 0;
	activeSliderContent: HTMLElement | null = null;
    keydownHandlerInitialized: boolean = false;

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
		// Attempt to parse YAML front matter from the code block
		const metadataMatch = source.match(/---\n([\s\S]+?)\n---/);
		const mediaContent = source.replace(/---\n[\s\S]+?\n---/, "").trim();
		const mediaFiles = mediaContent.split("\n").map(line => line.trim()).filter(Boolean);

		// Default slider config
		let settings: any = {
			sliderId: "",
			carouselShowThumbnails: true,
			thumbnailPosition: "bottom",
			captionMode: "overlay",
			autoplay: false,
			slideshowSpeed: 0,
			width: "100%",
			height: "380px",
			transitionEffect: "fade",
			transitionDuration: 0.1,
			enhancedView: true,
			interactiveNotes: false,

			// If you want to allow per-slider overrides:
			enableImageManipulation: false,
			compression: undefined
		};

		if (metadataMatch) {
			try {
				const parsedSettings = parseYaml(metadataMatch[1]);
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

		// Layout
		if (
			settings.carouselShowThumbnails &&
			(settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right")
		) {
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

		// Enhanced view (fullscreen, copy link, etc.)
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

		// Interactive notes
		let notesContainer: HTMLElement | null = null;
		let notesTextarea: HTMLTextAreaElement | null = null;
		if (settings.interactiveNotes) {
			const notesToggleBtn = sliderWrapper.createEl("button", { text: "📝", cls: "notes-toggle-btn" });
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
				notesContainer.classList.remove("visible");
			};
			notesContainer.appendChild(saveNotesBtn);

			notesToggleBtn.onclick = () => {
				if (notesContainer) {
					notesContainer.classList.toggle("visible");
					if (notesContainer.classList.contains("visible") && notesTextarea) {
						const mediaKey = `${sliderId}-${files[currentIndex]}`;
						notesTextarea.value = this.notesManager.getNote(mediaKey);
					}
				}
			};
		}

		// Drawing annotation
		let drawingAnnotation: DrawingAnnotation | null = null;
		let clearDrawingBtn: HTMLElement | null = null;
		if (this.settings.enableDrawingAnnotation) {
			const drawingToggleBtn = sliderWrapper.createEl("button", { text: "✏️", cls: "drawing-toggle-btn" });
			updateDrawingOverlay = (mediaKey: string) => {
				const existingOverlay = sliderContainer.querySelector(".drawing-overlay");
				if (existingOverlay) existingOverlay.remove();
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

		//----------------------------------------------------------------------
		//  Create or update the media display
		//----------------------------------------------------------------------
		const updateMediaDisplay = async () => {
			// Transition out
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

				// Use local slider "compression" or fallback to global
				const quality = (settings.compression !== undefined)
					? settings.compression
					: this.settings.compressionQuality;

				if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|avif)$/i.test(fileName)) {
					try {
						if (/\.gif$/i.test(fileName)) {
							// For GIFs, avoid compression to preserve animation
							const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
							img.classList.add("slider-media", "gif-media");
							this.addZoomPanSupport(img, sliderContainer);
						}
						// For SVG files, we don't need compression
						else if (/\.svg$/i.test(fileName)) {
							const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
							img.classList.add("slider-media");
							this.addZoomPanSupport(img, sliderContainer);
						} else {
							// For other image formats, use compression if possible
							const compressedUrl = await compressImage(filePath, 1600, 1200, quality);
							const img = mediaWrapper.createEl("img", { attr: { src: compressedUrl } });
							img.classList.add("slider-media");
							this.addZoomPanSupport(img, sliderContainer);
						}
					} catch (err) {
						// If compression fails, fallback to direct display
						console.error("Error processing image:", err);
						const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
						img.classList.add("slider-media");
						this.addZoomPanSupport(img, sliderContainer);
					}
				} else if (/\.(mp4|webm|mkv|mov|ogv)$/i.test(fileName)) {
					const video = mediaWrapper.createEl("video", { attr: { src: filePath, controls: "true" } });
					if (settings.autoplay) video.setAttribute("autoplay", "true");
					video.classList.add("slider-media");

					if (this.settings.enableVisualizer) {
						new Visualizer(video, sliderContainer, {
							color: this.settings.visualizerColor,
							height: this.settings.visualizerHeight
						});
					}
				} else if (/\.(mp3|ogg|wav|flac|webm|3gp||m4a)$/i.test(fileName)) {
					const audio = mediaWrapper.createEl("audio", { attr: { src: filePath, controls: "true" } });
					audio.classList.add("slider-media", "audio-media");

					if (this.settings.enableVisualizer) {
						new Visualizer(audio, sliderContainer, {
							color: this.settings.visualizerColor,
							height: this.settings.visualizerHeight
						});
					}
				} else if (/\.(pdf)$/i.test(fileName)) {
					// Create a container with CSS classes instead of inline styles
					const pdfContainer = mediaWrapper.createEl("div", { cls: "pdf-container" });
					
					// Create the iframe with proper attributes and CSS classes
					const iframe = pdfContainer.createEl("iframe", {
						attr: { 
							src: filePath, 
							width: "100%", 
							height: "100%",
							frameborder: "0",
							allowfullscreen: "true"
						}
					});
					
					iframe.classList.add("slider-media", "pdf-media");
					
					// The media-wrapper CSS class will be automatically targeted by the CSS selector
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
					const link = mediaWrapper.createEl("a", {
						text: "Open File",
						attr: { href: filePath, target: "_blank" }
					});
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
		// Make this slider the active one on focus
		sliderContent.addEventListener("focus", () => {
		    this.activeSliderContent = sliderContent;
		});

		// Auto-focus on initialization
		setTimeout(() => {
		    sliderContent.focus();
		    this.activeSliderContent = sliderContent;
		}, 100);

		// Setup a global document keydown handler if not already done
		if (!this.keydownHandlerInitialized) {
		    // Add this as a one-time setup
		    document.addEventListener("keydown", (evt: KeyboardEvent) => {
		        // If we have an active slider, handle its navigation
		        if (this.activeSliderContent) {
		            if (evt.key === "ArrowLeft") {
		                // Find the associated goPrev function for this slider
		                const sliderWrapper = this.activeSliderContent.closest(".media-slider-wrapper");
		                if (sliderWrapper) {
		                    const prevBtn = sliderWrapper.querySelector(".slider-btn.prev") as HTMLElement;
		                    if (prevBtn) {
		                        prevBtn.click();
		                        evt.preventDefault();
		                    }
		                }
		            } else if (evt.key === "ArrowRight") {
		                // Find the associated goNext function for this slider
		                const sliderWrapper = this.activeSliderContent.closest(".media-slider-wrapper");
		                if (sliderWrapper) {
		                    const nextBtn = sliderWrapper.querySelector(".slider-btn.next") as HTMLElement;
		                    if (nextBtn) {
		                        nextBtn.click();
		                        evt.preventDefault();
		                    }
		                }
		            }
		        }
		    });
		
		    // Also handle clicks outside the slider to maintain slider context
		    document.addEventListener("click", (evt: MouseEvent) => {
		        // Check if the click was inside a slider
		        const clickedSlider = (evt.target as HTMLElement).closest(".slider-content");
		        if (clickedSlider) {
		            // Update active slider
		            this.activeSliderContent = clickedSlider as HTMLElement;
		        }
		        // Note: We don't clear activeSliderContent when clicking outside
		        // to maintain navigation context
		    });
		
		    // Mark that we've initialized the global handler
		    this.keydownHandlerInitialized = true;
		}		

		// Keep the original slider-specific key handler as backup
		sliderContent.addEventListener("keydown", (evt: KeyboardEvent) => {
		    if (evt.key === "ArrowLeft") {
		        goPrev();
		        evt.preventDefault();
		    } else if (evt.key === "ArrowRight") {
		        goNext();
		        evt.preventDefault();
		    }
		});		

		// Keep the original wheel handler
		sliderContent.addEventListener("wheel", (evt: WheelEvent) => {
		    // Only interpret left-right wheel movement as next/prev
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
				} else if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|avif)$/i.test(fileName)) {
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

		// Paste images into the slider
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

		container.appendChild(sliderWrapper);
	}

	// Zoom and Pan Support

	/**
	 * Adds zoom and pan functionality to an image element
	 * @param img - The image element to add zoom/pan support to
	 * @param container - The container element that holds the image
	 */
	private addZoomPanSupport(img: HTMLImageElement, container: HTMLElement): void {
	    // State variables for zoom and pan
	    let scale = 1;
	    let translateX = 0;
	    let translateY = 0;
	    let isDragging = false;
	    let startX = 0;
	    let startY = 0;
	    let initialScale = 1;
	
	    const minScale = 1;
	    const maxScale = 5;
	
	    // Add zoom controls container
	    const zoomControls = container.createEl("div", { cls: "zoom-controls" });
	
	    // Add zoom in button
	    const zoomInBtn = zoomControls.createEl("button", { text: "🔍+", cls: "zoom-btn" });
	
	    // Add zoom out button
	    const zoomOutBtn = zoomControls.createEl("button", { text: "🔍-", cls: "zoom-btn" });
	
	    // Add reset button
	    const resetBtn = zoomControls.createEl("button", { text: "↺", cls: "zoom-btn" });
	
	    // Add CSS classes for cursor
	    img.classList.add("can-zoom");
	
	    // Helper function to apply transform
	    const applyTransform = () => {
	        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
	        img.classList.add("img-transformed");
		
	        if (isDragging) {
	            img.classList.add("dragging");
	        } else {
	            img.classList.remove("dragging");
	        }
		
	        // Show/hide zoom controls based on zoom state
	        zoomControls.style.opacity = scale > 1 ? "1" : "0.5";
	        zoomOutBtn.disabled = scale <= minScale;
	        resetBtn.disabled = scale <= minScale && translateX === 0 && translateY === 0;
		
	        // Update cursor classes
	        if (scale > 1) {
	            img.classList.add("zoomed");
	        } else {
	            img.classList.remove("zoomed");
	        }
	    };
	
	    // Helper function to handle zoom
	    const zoom = (delta: number, centerX: number, centerY: number) => {
	        // Capture original dimensions and position
	        const rect = img.getBoundingClientRect();
	        const imgCenterX = rect.left + rect.width / 2;
	        const imgCenterY = rect.top + rect.height / 2;
		
	        // Calculate offset from center
	        const offsetX = centerX - imgCenterX;
	        const offsetY = centerY - imgCenterY;
		
	        // Calculate old scale and new scale
	        const oldScale = scale;
	        scale = Math.max(minScale, Math.min(maxScale, scale + delta));
		
	        // Only apply zoom if scale changed
	        if (scale !== oldScale) {
	            // Adjust translation to zoom toward cursor position
	            if (delta > 0) {
	                translateX -= offsetX * (scale / oldScale - 1);
	                translateY -= offsetY * (scale / oldScale - 1);
	            } else {
	                // When zooming out, gradually move back to center
	                translateX = translateX * (scale / oldScale);
	                translateY = translateY * (scale / oldScale);
	            }
			
	            applyTransform();
	            return true;
	        }
	        return false;
	    };
	
	    // Reset function
	    const resetZoomPan = () => {
	        scale = 1;
	        translateX = 0;
	        translateY = 0;
	        applyTransform();
	    };
	
	    // Button event handlers
	    zoomInBtn.addEventListener("click", (e) => {
	        e.stopPropagation();
	        const rect = container.getBoundingClientRect();
	        zoom(0.5, rect.left + rect.width / 2, rect.top + rect.height / 2);
	    });
	
	    zoomOutBtn.addEventListener("click", (e) => {
	        e.stopPropagation();
	        const rect = container.getBoundingClientRect();
	        zoom(-0.5, rect.left + rect.width / 2, rect.top + rect.height / 2);
	    });
	
	    resetBtn.addEventListener("click", (e) => {
	        e.stopPropagation();
	        resetZoomPan();
	    });
	
	    // Mouse wheel zoom handler
	    container.addEventListener("wheel", (e: WheelEvent) => {
	        // Check if ctrl key is pressed for zoom, otherwise let the slider's wheel handler work
	        if (e.ctrlKey || e.metaKey) {
	            e.preventDefault();
	            const delta = e.deltaY < 0 ? 0.2 : -0.2;
	            zoom(delta, e.clientX, e.clientY);
	        }
	    }, { passive: false });
	
	    // Pan handlers (mouse)
	    img.addEventListener("mousedown", (e: MouseEvent) => {
	        if (scale > 1) {
	            isDragging = true;
	            startX = e.clientX - translateX;
	            startY = e.clientY - translateY;
	            e.preventDefault();
	        }
	    });
	
	    document.addEventListener("mousemove", (e: MouseEvent) => {
	        if (isDragging) {
	            translateX = e.clientX - startX;
	            translateY = e.clientY - startY;
	            applyTransform();
	            e.preventDefault();
	        }
	    });
	
	    document.addEventListener("mouseup", () => {
	        isDragging = false;
	        applyTransform(); // Update classes
	    });
	
	    // Touch handlers for mobile
	    img.addEventListener("touchstart", (e: TouchEvent) => {
	        if (e.touches.length === 1 && scale > 1) {
	            isDragging = true;
	            startX = e.touches[0].clientX - translateX;
	            startY = e.touches[0].clientY - translateY;
	            e.preventDefault();
	        } else if (e.touches.length === 2) {
	            // Handle pinch zoom
	            e.preventDefault();
	            const touch1 = e.touches[0];
	            const touch2 = e.touches[1];
	            initialScale = scale;
	            startX = (touch1.clientX + touch2.clientX) / 2;
	            startY = (touch1.clientY + touch2.clientY) / 2;
	        }
	    }, { passive: false });
	
	    img.addEventListener("touchmove", (e: TouchEvent) => {
	        if (e.touches.length === 1 && isDragging) {
	            translateX = e.touches[0].clientX - startX;
	            translateY = e.touches[0].clientY - startY;
	            applyTransform();
	            e.preventDefault();
	        } else if (e.touches.length === 2) {
	            // Handle pinch zoom
	            e.preventDefault();
	            const touch1 = e.touches[0];
	            const touch2 = e.touches[1];
			
	            // Calculate distance between fingers
	            const currentDistance = Math.hypot(
	                touch1.clientX - touch2.clientX,
	                touch1.clientY - touch2.clientY
	            );
			
	            const centerX = (touch1.clientX + touch2.clientX) / 2;
	            const centerY = (touch1.clientY + touch2.clientY) / 2;
			
	            // Calculate new scale based on finger distance change
	            const newScale = Math.max(minScale, Math.min(maxScale, initialScale * (currentDistance / 150)));
			
	            if (newScale !== scale) {
	                scale = newScale;
	                applyTransform();
	            }
	        }
	    }, { passive: false });
	
	    img.addEventListener("touchend", () => {
	        isDragging = false;
	        applyTransform(); // Update classes
	    });
	
	    // Keyboard zoom and pan
	    container.addEventListener("keydown", (e: KeyboardEvent) => {
	        // Make sure this isn't intercepted for navigation
	        if (e.ctrlKey || e.metaKey || e.altKey) {
	            const rect = container.getBoundingClientRect();
	            const centerX = rect.left + rect.width / 2;
	            const centerY = rect.top + rect.height / 2;
			
	            switch (e.key) {
	                case "=":
	                case "+":
	                    if (e.ctrlKey || e.metaKey) {
	                        e.preventDefault();
	                        zoom(0.2, centerX, centerY);
	                    }
	                    break;
	                case "-":
	                    if (e.ctrlKey || e.metaKey) {
	                        e.preventDefault();
	                        zoom(-0.2, centerX, centerY);
	                    }
	                    break;
	                case "0":
	                    if (e.ctrlKey || e.metaKey) {
	                        e.preventDefault();
	                        resetZoomPan();
	                    }
	                    break;
	                case "ArrowUp":
	                    if (scale > 1 && (e.ctrlKey || e.altKey)) {
	                        e.preventDefault();
	                        translateY += 20;
	                        applyTransform();
	                    }
	                    break;
	                case "ArrowDown":
	                    if (scale > 1 && (e.ctrlKey || e.altKey)) {
	                        e.preventDefault();
	                        translateY -= 20;
	                        applyTransform();
	                    }
	                    break;
	                case "ArrowLeft":
	                    if (scale > 1 && (e.ctrlKey || e.altKey)) {
	                        e.preventDefault();
	                        translateX += 20;
	                        applyTransform();
	                    }
	                    break;
	                case "ArrowRight":
	                    if (scale > 1 && (e.ctrlKey || e.altKey)) {
	                        e.preventDefault();
	                        translateX -= 20;
	                        applyTransform();
	                    }
	                    break;
	            }
	        }
	    });
	
	    // Double-click to zoom in/out
	    img.addEventListener("dblclick", (e: MouseEvent) => {
	        if (scale > 1) {
	            resetZoomPan();
	        } else {
	            zoom(1, e.clientX, e.clientY);
	        }
	    });
	
	    // Initial setup
	    applyTransform();
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

		

		// Compression
		new Setting(containerEl)
			.setName("Compression quality")
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
