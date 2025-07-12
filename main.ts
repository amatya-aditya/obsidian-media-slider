import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, TFile, MarkdownRenderer, MarkdownView, parseYaml, setIcon } from "obsidian";
import { compressImage } from "./src/compression";
import { NotesManager } from "./src/notes";
import { DrawingAnnotation } from "./src/drawing";
import { Visualizer, VisualizerOptions } from "./src/visualizer";
import { CompareMode, CompareOptions } from "./src/compareMode";

interface MediaSliderSettings {
	enableDrawingAnnotation: boolean;
	enableVisualizer: boolean;
	visualizerColor: string;
	visualizerHeight: string;
	compressionQuality: number;
	enableCompression: boolean;
	enableCompareMode: boolean; 
}

const DEFAULT_SETTINGS: MediaSliderSettings = {
	enableDrawingAnnotation: false,
	enableVisualizer: false,
	visualizerColor: "#00ff00",
	visualizerHeight: "50px",
	compressionQuality: 1,
	enableCompression: true,
	enableCompareMode: true 
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

		this.registerMarkdownCodeBlockProcessor("media-slider", async (source, el, ctx) => {
			await this.createMediaSlider(source, el, ctx);
		});

		
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
		
		const markdownImageMatch = fileName.match(/!\[(.*?)\]\((.*?)\)/);
		if (markdownImageMatch) {
			fileName = markdownImageMatch[2].trim();
		}

		
		const markdownLinkMatch = fileName.match(/!?\[\[(.*?)(?:\|(.*?))?\]\]/);
		if (markdownLinkMatch) {
			fileName = markdownLinkMatch[1].trim();
		}

		
		if (fileName.startsWith('<') && fileName.endsWith('>')) {
			fileName = fileName.slice(1, -1).trim();
		}

		
		if (fileName.startsWith("http://") || fileName.startsWith("https://")) {
			
			try {
				return decodeURIComponent(fileName);
			} catch (e) {
				return fileName;
			}
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
		if (abstractFile instanceof TFile) {
			const content = await this.app.vault.read(abstractFile as TFile);
			this.markdownCache.set(fileName, content);
			return content;
		} else {
			console.warn("Abstract file is not a TFile:", abstractFile);
			return "";
		}
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

	private async generateUniqueFileName(baseName: string, folderPath: string): Promise<string> {
		let uniqueName = baseName;
		let counter = 1;
		while (await this.app.vault.adapter.exists(`${folderPath}/${uniqueName}`)) {
			const extIndex = baseName.lastIndexOf(".");
			const nameWithoutExt = extIndex !== -1 ? baseName.slice(0, extIndex) : baseName;
			const ext = extIndex !== -1 ? baseName.slice(extIndex) : "";
			uniqueName = `${nameWithoutExt}-${counter}${ext}`;
			counter++;
		}
		return uniqueName;
	}

	private async insertImageToCodeBlock(ctx: MarkdownPostProcessorContext, fileName: string, insertAfterIndex: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile;
		if (!file) {
			console.warn("Could not find file for this code block. (ctx.sourcePath:", ctx.sourcePath, ")");
			return;
		}
		
		const fileContent = await this.app.vault.read(file);
		
		
		const codeBlockMatch = fileContent.match(/(```media-slider[\s\S]+?```)/);
		if (!codeBlockMatch) {
			console.log("No media-slider code block found.");
			return;
		}
		
		const codeBlock = codeBlockMatch[1];
		
		
		const lines = codeBlock.split('\n');
		
		
		const contentLines = lines.slice(1, -1);
		
		
		
		const yamlStartIndex = contentLines.findIndex(line => line.trim() === '---');
		let contentStartIndex = 0;
		
		if (yamlStartIndex !== -1) {
			
			const yamlEndIndex = contentLines.slice(yamlStartIndex + 1).findIndex(line => line.trim() === '---');
			if (yamlEndIndex !== -1) {
				contentStartIndex = yamlStartIndex + yamlEndIndex + 2; 
			}
		}
		
		
		const actualInsertIndex = contentStartIndex + insertAfterIndex + 1; 
		
		
		contentLines.splice(actualInsertIndex, 0, `![[${fileName}]]`);
		
		
		lines[0] = '```media-slider';
		for (let i = 0; i < contentLines.length; i++) {
			lines[i + 1] = contentLines[i];
		}
		lines[contentLines.length + 1] = '```';
		
		const updatedCodeBlock = lines.join('\n');
		
		
		const updatedContent = fileContent.replace(codeBlockMatch[0], updatedCodeBlock);
		
		
		await this.app.vault.modify(file, updatedContent);
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
				return match.replace(/```$/, `![[${fileName}]]\n\`\`\``);
			}
		);
		if (updatedContent === fileContent) {
			console.log("No media-slider code block replaced. Possibly none found or multiple blocks exist.");
			return;
		}
		await this.app.vault.modify(file, updatedContent);
	}

	private async getFolderMedia(folderPath: string, settings: any): Promise<string[]> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !("children" in folder)) {
			console.error("Folder not found or not a folder:", folderPath);
			return [];
		}

		
		const mediaFiles: string[] = [];
		
		
		let fileTypeFilters = [
			"png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif",
			"mp4", "webm", "mkv", "mov", "ogv",
			"mp3", "ogg", "wav", "flac", "m4a",
			"pdf", "md"
		];
		
		
		if (settings.fileTypes && Array.isArray(settings.fileTypes)) {
			fileTypeFilters = settings.fileTypes;
		}
		
		const recursive = settings.recursive !== false; 
		
		const collectMediaFiles = (file: any) => {
			if (file.children) {
				
				if (file === folder || recursive) {
					file.children.forEach(collectMediaFiles);
				}
			} else if ("extension" in file) {
				
				if (fileTypeFilters.includes(file.extension.toLowerCase())) {
					mediaFiles.push(file.path);
				}
			}
		};
		
		collectMediaFiles(folder);
		
		
		return mediaFiles.sort();
	}

	
	private parseMediaFiles(mediaLines: string[]): {
		fileEntries: { path: string; caption: string | null; compareGroup: string | null }[];
		compareGroups: Map<string, { files: { path: string; caption: string | null }[]; processed: boolean }>;
	} {
		const fileEntries: { path: string; caption: string | null; compareGroup: string | null }[] = [];
		
		
		for (const line of mediaLines) {
			let path = "";
			let caption = null;
			let compareGroup = null;
			
			
			const markdownMatch = line.match(/!?\[(.*?)\]\((.*?)(?:\s*\|\s*(.*?))?\)/);
			if (markdownMatch) {
				path = markdownMatch[2].trim();
				
				caption = markdownMatch[3] ? markdownMatch[3].trim() : 
						 (markdownMatch[1] ? markdownMatch[1].trim() : null);
				fileEntries.push({ path, caption, compareGroup });
				continue;
			}
			
			
			const compareModeMatch = line.match(/!?\[\[(.*?)(?:\|(.*?))?\s*\|\|\s*([\w\d-]+)\s*\]\]/);
			if (compareModeMatch) {
				path = compareModeMatch[1].trim();
				caption = compareModeMatch[2] ? compareModeMatch[2].trim() : null;
				compareGroup = compareModeMatch[3].trim();
				fileEntries.push({ path, caption, compareGroup });
				continue;
			}
			
			
			const match = line.match(/!?\[\[(.*?)(?:\|(.*?))?\]\]/);
			if (match) {
				path = match[1].trim();
				caption = match[2] ? match[2].trim() : null;
				fileEntries.push({ path, caption, compareGroup: null });
				continue;
			}
			
			
			if (line.trim()) {
				path = line.trim();
				fileEntries.push({ path, caption: null, compareGroup: null });
			}
		}
		
		
		const compareGroups = new Map<string, { files: { path: string; caption: string | null }[]; processed: boolean }>();
		
		for (const entry of fileEntries) {
			if (entry.compareGroup) {
				const groupId = entry.compareGroup.split('-')[0];
				if (!compareGroups.has(groupId)) {
					compareGroups.set(groupId, { files: [], processed: false });
				}
				const group = compareGroups.get(groupId);
				if (group) {
					group.files.push({
						path: entry.path,
						caption: entry.caption
					});
				}
			}
		}
		
		return { fileEntries, compareGroups };
	}

	private async createMediaSlider(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		
		const metadataMatch = source.match(/---\n([\s\S]+?)\n---/);
		const mediaContent = source.replace(/---\n[\s\S]+?\n---/, "").trim();
		const mediaLines = mediaContent.split("\n").map(line => line.trim()).filter(Boolean);

		
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
			fileTypes: null, 
			recursive: false, 
			compression: null, 
			compareMode: {  
				enabled: this.settings.enableCompareMode,
				orientation: "vertical",
				initialPosition: 50,
				showLabels: false,
				label1: "",
				label2: "",
				swapImages: false
			}
		};

		if (metadataMatch) {
			try {
				const parsedSettings = parseYaml(metadataMatch[1]);
				settings = Object.assign({}, settings, parsedSettings);
                
                
                if (parsedSettings.compareMode !== undefined) {
                    if (typeof parsedSettings.compareMode === 'boolean') {
                        
                        
                        const compareModeDefaults = Object.assign({}, settings.compareMode, { enabled: parsedSettings.compareMode });
                        
                        const compareModeKeys = ['orientation', 'initialPosition', 'showLabels', 'label1', 'label2', 'swapImages'];
                        for (const key of compareModeKeys) {
                            if (parsedSettings[key] !== undefined) {
                                compareModeDefaults[key] = parsedSettings[key];
                            }
                        }
                        settings.compareMode = compareModeDefaults;
                    } else if (typeof parsedSettings.compareMode === 'object') {
                        
                        settings.compareMode = Object.assign({}, settings.compareMode, parsedSettings.compareMode);
                    }
                }
			} catch (error) {
				console.error("Failed to parse media-slider metadata:", error);
			}
		}

		let sliderId = settings.sliderId;
		if (!sliderId) {
			sliderId = `slider-${MediaSliderPlugin.sliderCounter++}`;
		}

		
		let mediaFiles: string[] = [];
		
		
		for (const line of mediaLines) {
			
			const folderMatch = line.match(/!?\[\[(.*?\/)\]\]/);
			if (folderMatch) {
				const folderPath = folderMatch[1].endsWith('/') 
					? folderMatch[1].slice(0, -1) 
					: folderMatch[1];
					
				
				const folderFiles = await this.getFolderMedia(folderPath, settings);
				
				
				mediaFiles = mediaFiles.concat(folderFiles.map(file => `![[${file}]]`));
			} else {
				
				mediaFiles.push(line);
			}
		}
		
		
		const { fileEntries, compareGroups } = this.parseMediaFiles(mediaFiles);
		
		
		const processedFiles: string[] = [];
		const processedGroupIds = new Set<string>();
		
		for (const entry of fileEntries) {
			if (entry.compareGroup) {
				const groupId = entry.compareGroup.split('-')[0];
				if (!processedGroupIds.has(groupId)) {
					processedGroupIds.add(groupId);
					if (settings.compareMode && settings.compareMode.enabled) {
						
						processedFiles.push(`__COMPARE_GROUP_${groupId}`);
					} else {
						
						const group = compareGroups.get(groupId);
						if (group && group.files.length >= 2) {
							for (const file of group.files) {
								processedFiles.push(file.caption 
									? `![[${file.path}|${file.caption}]]`
									: `![[${file.path}]]`);
							}
						}
					}
				}
			} else {
				
				processedFiles.push(entry.caption 
					? `![[${entry.path}|${entry.caption}]]` 
					: `![[${entry.path}]]`);
			}
		}

	
		
		
	
		const validFiles = processedFiles.map(file => {
		  if (file.startsWith('__COMPARE_GROUP_')) {
		    return file;
		  }
		  const m = file.match(/!?\[\[(.*?)(?:\|(.*?))?\]\]/);
		  if (!m) return "";
		  const path    = m[1].trim();
		  const caption = (m[2] ?? "").trim();
		  return caption
		    ? `${path}|${caption}`
		    : path;
		}).filter(Boolean);

		if (validFiles.length === 0) {
			el.createEl("p", { text: "No valid media files found." });
			return;
		}

		await this.notesManager.cleanupNotesForSlider(sliderId, validFiles).catch(console.error);
		await this.cleanupDrawingData(sliderId, validFiles).catch(console.error);

		this.renderSlider(el, validFiles, settings, sliderId, ctx, compareGroups);
	}

	private renderSlider(
		container: HTMLElement,
		files: string[],
		settings: any,
		sliderId: string,
		ctx: MarkdownPostProcessorContext,
		compareGroups: Map<string, { files: { path: string; caption: string | null }[]; processed: boolean }> = new Map()
	) {
		
		container.querySelectorAll('.fullscreen-btn, .copy-btn, .notes-toggle-btn, .drawing-toggle-btn').forEach(btn => btn.remove());

		container.empty();

		let updateDrawingOverlay: ((mediaKey: string) => void) | undefined;
		const sliderWrapper = container.createDiv("media-slider-wrapper");

		
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
		let mediaWrapper = sliderContainer.createDiv("media-wrapper");
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
		
		
		const compareInstances: { [key: string]: CompareMode } = {};

		
		if (settings.enhancedView) {
			const fullScreenBtn = sliderWrapper.createEl("button", { cls: "fullscreen-btn" });
			setIcon(fullScreenBtn, "maximize");
			fullScreenBtn.onclick = () => {
				if (!document.fullscreenElement) {
					sliderWrapper.requestFullscreen().catch(err => console.error("Error enabling fullscreen:", err));
					sliderContainer.classList.add("fullscreen-slider");
				} else {
					document.exitFullscreen();
					sliderContainer.classList.remove("fullscreen-slider");
				}
			};

			const copyBtn = sliderWrapper.createEl("button", { cls: "copy-btn" });
			setIcon(copyBtn, "copy");
			copyBtn.onclick = async () => {
				const currentEntry = files[currentIndex];
				
				
				if (currentEntry.startsWith('__COMPARE_GROUP_')) return;
				
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
		if (settings.interactiveNotes) {
			const notesToggleBtn = sliderWrapper.createEl("button", { cls: "notes-toggle-btn" });
			setIcon(notesToggleBtn, "sticky-note");
			notesContainer = sliderWrapper.createDiv("notes-container");
			notesTextarea = document.createElement("textarea");
			notesTextarea.classList.add("notes-textarea");
			notesTextarea.placeholder = "Add your notes here...";
			notesContainer.appendChild(notesTextarea);

			const saveNotesBtn = document.createElement("button");
			saveNotesBtn.classList.add("notes-save-btn");
			setIcon(saveNotesBtn, "save");
			saveNotesBtn.onclick = async () => {
				const mediaKey = `${sliderId}-${files[currentIndex]}`;
				if (notesTextarea) {
					await this.notesManager.setNote(mediaKey, notesTextarea.value);
				}
				if (notesContainer) {
					notesContainer.classList.remove("visible");
				}
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

		
		let drawingAnnotation: DrawingAnnotation | null = null;
		let clearDrawingBtn: HTMLElement | null = null;
		if (this.settings.enableDrawingAnnotation) {
			const drawingToggleBtn = sliderWrapper.createEl("button", { cls: "drawing-toggle-btn" });
			setIcon(drawingToggleBtn, "edit-3");
			updateDrawingOverlay = (mediaKey: string) => {
				const existingOverlay = sliderContainer.querySelector(".drawing-overlay");
				if (existingOverlay) existingOverlay.remove();
				const savedDrawing = this.drawingData[mediaKey];
				if (savedDrawing) {
					const overlay = sliderContainer.createEl("img", { attr: { src: savedDrawing } });
					overlay.classList.add("drawing-overlay");
					if (!clearDrawingBtn) {
						clearDrawingBtn = sliderWrapper.createEl("button", { cls: "clear-drawing-btn" });
						setIcon(clearDrawingBtn, "trash");
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
					setIcon(drawingToggleBtn, "edit-3");
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
					setIcon(drawingToggleBtn, "save");
				}
			};
		}

		
		
		
		const updateMediaDisplay = async () => {
			
			Object.values(compareInstances).forEach(instance => {
				instance.destroy();
			});
			
			
			Object.keys(compareInstances).forEach(key => {
				delete compareInstances[key];
			});
			
			
			mediaWrapper.classList.remove(
				"transition-fade-in", "transition-slide-next-in", "transition-slide-prev-in", "transition-zoom-in",
				"transition-slide-up-in", "transition-slide-down-in", "transition-flip-in", "transition-flip-vertical-in",
				"transition-rotate-in", "transition-blur-in", "transition-squeeze-in",
				"transition-fade-out", "transition-slide-next-out", "transition-slide-prev-out", "transition-zoom-out",
				"transition-slide-up-out", "transition-slide-down-out", "transition-flip-out", "transition-flip-vertical-out",
				"transition-rotate-out", "transition-blur-out", "transition-squeeze-out"
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

			
			await new Promise(resolve => setTimeout(resolve, settings.transitionDuration));

			
			mediaWrapper.empty();
			if (settings.captionMode === "below") captionContainer.empty();

			
			if (thumbnailEls.length > 0) {
				thumbnailEls.forEach((thumb, idx) => {
					thumb.classList.toggle("active-thumbnail", idx === currentIndex);
				});

				
				const activeThumb = thumbnailEls[currentIndex];
				if (activeThumb && thumbnailContainer) {
					
					const containerRect = thumbnailContainer.getBoundingClientRect();
					const thumbRect = activeThumb.getBoundingClientRect();

					
					if (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right") {
						
						const scrollTop = activeThumb.offsetTop - (containerRect.height / 2) + (thumbRect.height / 2);
						thumbnailContainer.scrollTo({
							top: scrollTop,
							behavior: 'smooth'
						});
					} else {
						
						const scrollLeft = activeThumb.offsetLeft - (containerRect.width / 2) + (thumbRect.width / 2);
						thumbnailContainer.scrollTo({
							left: scrollLeft,
							behavior: 'smooth'
						});
					}
				}
			}

			
			const currentEntry = files[currentIndex];
			console.log("Current entry:", currentEntry);
			
			
			if (currentEntry && currentEntry.startsWith('__COMPARE_GROUP_')) {
				const groupId = currentEntry.slice('__COMPARE_GROUP_'.length);
				console.log("Rendering compare group:", groupId);
				console.log("Available groups:", Array.from(compareGroups.keys()));
				
				const group = compareGroups.get(groupId);
				console.log("Group data:", group);
				
				if (group && group.files.length >= 2) {
					
					const file1 = group.files[0];
					const file2 = group.files[1];
					
					console.log("Compare files:", file1.path, file2.path);
					
					try {
						
						const img1Path = this.getMediaSource(file1.path);
						const img2Path = this.getMediaSource(file2.path);
						
						console.log("Image paths:", img1Path, img2Path);
						
						
						if (settings.compareMode?.enabled) {
							
							const compareOptions: CompareOptions = {
								orientation: settings.compareMode?.orientation || "vertical",
								initialPosition: settings.compareMode?.initialPosition || 50,
								showLabels: settings.compareMode?.showLabels || false,
								label1: settings.compareMode?.label1 || "Before",
								label2: settings.compareMode?.label2 || "After",
								swapImages: settings.compareMode?.swapImages || false,
								enabled: true
							};
							
							
							const compareInstance = new CompareMode(
								mediaWrapper,
								img1Path,
								img2Path,
								file1.caption,
								file2.caption,
								compareOptions
							);
							
							
							compareInstance.render();
							
							
							compareInstances[groupId] = compareInstance;
						} else {
							
							
							const img1 = mediaWrapper.createEl("img", { attr: { src: img1Path } });
							img1.classList.add("slider-media");
							this.addZoomPanSupport(img1, sliderContainer);
							
							if (file1.caption) {
								if (settings.captionMode === "overlay") {
									const capEl = mediaWrapper.createEl("div", { text: file1.caption });
									capEl.classList.add("slider-caption-overlay");
								} else {
									const capEl = captionContainer.createEl("div", { text: file1.caption });
									capEl.classList.add("slider-caption");
								}
							}

							
							const img2 = mediaWrapper.createEl("img", { attr: { src: img2Path } });
							img2.classList.add("slider-media");
							this.addZoomPanSupport(img2, sliderContainer);
							
							if (file2.caption) {
								if (settings.captionMode === "overlay") {
									const capEl = mediaWrapper.createEl("div", { text: file2.caption });
									capEl.classList.add("slider-caption-overlay");
								} else {
									const capEl = captionContainer.createEl("div", { text: file2.caption });
									capEl.classList.add("slider-caption");
								}
							}
						}
					} catch (error) {
						console.error("Error rendering comparison:", error);
						mediaWrapper.createEl("div", { text: `Error rendering comparison: ${error.message || "Unknown error"}` });
					}
				} else {
					
					const errorMessage = group 
						? `Not enough images in group ${groupId} (found ${group.files?.length || 0}, need at least 2)` 
						: `Group ${groupId} not found`;
					
					console.error(errorMessage);
					mediaWrapper.createEl("div", { text: errorMessage });
				}
			} else {
				
				let [fileName, caption] = currentEntry.split("|").map(s => s.trim());
				if (!fileName.includes(".")) {
					const mdFile = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
					if (mdFile && mdFile.extension === "md") {
						fileName = mdFile.path;
					}
				}

				const filePath = this.getMediaSource(fileName);

				
				let useCompression = this.settings.enableCompression;
				
				
				if (settings.compression !== null && settings.compression !== undefined) {
					
					if (settings.compression === "off" || settings.compression === false) {
						useCompression = false;
					} else {
						useCompression = true;
					}
				}

				
				const quality = typeof settings.compression === 'number'
					? settings.compression
					: this.settings.compressionQuality;

				if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|avif)$/i.test(fileName)) {
					try {
						if (/\.gif$/i.test(fileName)) {
							
							const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
							img.classList.add("slider-media", "gif-media");
							this.addZoomPanSupport(img, sliderContainer);
						}
						
						else if (/\.svg$/i.test(fileName)) {
							const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
							img.classList.add("slider-media");
							this.addZoomPanSupport(img, sliderContainer);
						} else if (!useCompression) {
							
							const img = mediaWrapper.createEl("img", { attr: { src: filePath } });
							img.classList.add("slider-media");
							this.addZoomPanSupport(img, sliderContainer);
						} else {
							
							const compressedUrl = await compressImage(filePath, 1600, 1200, quality);
							const img = mediaWrapper.createEl("img", { attr: { src: compressedUrl } });
							img.classList.add("slider-media");
							this.addZoomPanSupport(img, sliderContainer);
						}
					} catch (err) {
						
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
					
					const pdfContainer = mediaWrapper.createEl("div", { cls: "pdf-container" });
					
					
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
					
					
				} else if (/\.(md)$/i.test(fileName)) {
					const abstractFile = this.app.vault.getAbstractFileByPath(fileName);
					if (abstractFile && (abstractFile as any) instanceof TFile) {
						const content = await this.getMarkdownContent(fileName);
						mediaWrapper.empty();
						mediaWrapper.style.display = "block";
						await MarkdownRenderer.render(this.app, content, mediaWrapper, abstractFile.path, this);
					}
				} else if (this.isYouTubeURL(fileName)) {
					const embedUrl = this.getYouTubeEmbedURL(fileName);
					const iframe = mediaWrapper.createEl("iframe", {
						attr: {
							src: embedUrl,
							frameborder: "0",
							allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
							allowfullscreen: "true",
							width: "100%",
							height: "100%"
						}
					});
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

			
			if (settings.interactiveNotes && notesTextarea) {
				const mediaKey = `${sliderId}-${files[currentIndex]}`;
				notesTextarea.value = this.notesManager.getNote(mediaKey);
			}

			
			if (this.settings.enableDrawingAnnotation) {
				const mediaKey = `${sliderId}-${files[currentIndex]}`;
				updateDrawingOverlay?.(mediaKey);
			}
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

		
		const prevBtn = sliderContent.createEl("button", { cls: "slider-btn prev" });
		const nextBtn = sliderContent.createEl("button", { cls: "slider-btn next" });
		
		
		setIcon(prevBtn, "chevron-left");
		setIcon(nextBtn, "chevron-right");
		
		prevBtn.onclick = goPrev;
		nextBtn.onclick = goNext;

		
		prevBtn.addEventListener("touchstart", (e) => {
			e.preventDefault();
			goPrev();
		}, { passive: false });
		
		nextBtn.addEventListener("touchstart", (e) => {
			e.preventDefault();
			goNext();
		}, { passive: false });

		sliderContent.tabIndex = 0;
		
		sliderContent.addEventListener("focus", () => {
		    this.activeSliderContent = sliderContent;
		});

		
		sliderContent.addEventListener("wheel", (evt: WheelEvent) => {
		    const target = evt.target as HTMLElement;
		    if (!target) return;
		    
		    
		    if (!target.matches('input, textarea')) {
		        if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) {
		            if (evt.deltaX > 30) {
		                goNext();
		                evt.preventDefault();
		            } else if (evt.deltaX < -30) {
		                goPrev();
		                evt.preventDefault();
		            }
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

		
		if (thumbnailContainer) {
			thumbnailContainer.empty();
			files.forEach((entry, index) => {
				
				if (entry.startsWith('__COMPARE_GROUP_')) {
					const groupId = entry.replace('__COMPARE_GROUP_', '');
					const group = compareGroups.get(groupId);
					
					if (group && group.files.length > 0) {
						
						const thumbEl = thumbnailContainer!.createEl("div", { cls: "thumbnail compare-thumbnail" });
						
						
						thumbEl.classList.add(settings.compareMode.orientation === "horizontal" ? 
							"compare-horizontal" : "compare-vertical");
						
						
						if (group.files.length >= 2) {
							const file1 = group.files[0];
							const file2 = group.files[1];
							
							try {
								const img1Path = this.getMediaSource(file1.path);
								const img2Path = this.getMediaSource(file2.path);
								
								
								const isImage1 = /\.(png|jpg|jpeg|gif|svg|webp|bmp|avif)$/i.test(file1.path);
								const isImage2 = /\.(png|jpg|jpeg|gif|svg|webp|bmp|avif)$/i.test(file2.path);
								
								if (isImage1 && isImage2) {
									
									const thumbContainer = thumbEl.createEl("div", { cls: "compare-thumb-container" });
									
									
									const leftImg = thumbContainer.createEl("img", { 
										attr: { src: img1Path },
										cls: "compare-thumb-left"
									});
									
									
									const rightImg = thumbContainer.createEl("img", { 
										attr: { src: img2Path },
										cls: "compare-thumb-right"
									});
									
									
									const divider = thumbContainer.createEl("div", { cls: "compare-thumb-divider" });
									
									
									const compareIcon = thumbEl.createEl("div", { 
										text: "⟷",
										cls: "compare-thumb-icon"
									});
								} else {
									
									thumbEl.textContent = "COMP";
									thumbEl.classList.add("thumbnail-placeholder");
								}
							} catch (error) {
								console.error("Error creating compare thumbnail:", error);
								thumbEl.textContent = "ERR";
								thumbEl.classList.add("thumbnail-placeholder");
							}
						} else {
							
							thumbEl.textContent = "CMP";
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
					}
				} else {
					
					let [fileName] = entry.split("|").map(s => s.trim());
					let thumbEl: HTMLElement;
					
					if (this.isYouTubeURL(fileName)) {
						const thumbUrl = this.getYouTubeThumbnail(fileName);
						thumbEl = thumbnailContainer!.createEl("img", { attr: { src: thumbUrl }, cls: "thumbnail" });
					} else if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|avif)$/i.test(fileName)) {
						thumbEl = thumbnailContainer!.createEl("img", {
							attr: { src: this.getMediaSource(fileName) },
							cls: "thumbnail"
						});
					} else {
						const ext = fileName.split('.').pop()?.toUpperCase() || "FILE";
						thumbEl = thumbnailContainer!.createEl("div", { text: ext });
						thumbEl.classList.add("thumbnail-placeholder");
					}
					
					if (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right") {
						thumbEl.classList.add("vertical-thumb");
					}
					
					
					thumbEl.tabIndex = 0;
					
					thumbEl.onclick = () => {
						currentIndex = index;
						throttledUpdate();
					};
					
					thumbnailEls.push(thumbEl);
				}
			});
			
			
			thumbnailContainer.tabIndex = 0;
		}

		
		let slideshowInterval: number | NodeJS.Timeout | null = null;
		let isNoteActive = true;

		
		const startSlideshow = () => {
			if (settings.slideshowSpeed > 0 && isNoteActive) {
				slideshowInterval = setInterval(goNext, settings.slideshowSpeed * 1000);
				// console.log(`[Media-Slider] Started slideshow for ${ctx.sourcePath}`);
			}
		};

		
		const stopSlideshow = () => {
			if (slideshowInterval) {
				clearInterval(slideshowInterval);
				slideshowInterval = null;
				// console.log(`[Media-Slider] Stopped slideshow for ${ctx.sourcePath}`);
			}
		};

		
		const checkNoteActive = () => {
			const activeLeaf = this.app.workspace.activeLeaf;
			const shouldBeActive = !!(activeLeaf && 
				activeLeaf.view instanceof MarkdownView && 
				activeLeaf.view.file && 
				activeLeaf.view.file.path === ctx.sourcePath);
			
			const wasActive = isNoteActive;
			isNoteActive = shouldBeActive;
			
			// console.log(`[Media-Slider] Note ${ctx.sourcePath}: wasActive=${wasActive}, isNoteActive=${isNoteActive}, shouldBeActive=${shouldBeActive}`);
			
			
			if (wasActive && !isNoteActive) {
				// console.log(`[Media-Slider] Note became inactive, stopping slideshow`);
				stopSlideshow();
			}
			
			else if (!wasActive && isNoteActive && settings.slideshowSpeed > 0) {
				// console.log(`[Media-Slider] Note became active, starting slideshow`);
				startSlideshow();
			}
		};

		
		if (settings.slideshowSpeed > 0) {
			
			checkNoteActive();
			if (isNoteActive) {
				startSlideshow();
			}
		}

		
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', checkNoteActive)
		);

		
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				
				const noteStillExists = this.app.workspace.getLeavesOfType("markdown").some(leaf => {
					if (leaf.view instanceof MarkdownView) {
						return leaf.view.file && leaf.view.file.path === ctx.sourcePath;
					}
					return false;
				});
				
				
				if (!noteStillExists && isNoteActive) {
					isNoteActive = false;
					stopSlideshow();
				}
			})
		);



		
		this.register(() => {
			
			stopSlideshow();
			
			
			Object.values(compareInstances).forEach(instance => {
				instance.destroy();
			});
		});

		
		throttledUpdate();

		
		sliderWrapper.tabIndex = 0;

		container.appendChild(sliderWrapper);

		
		if (!this.keydownHandlerInitialized) {
			document.addEventListener("keydown", (evt: KeyboardEvent) => {
				
				const target = evt.target as EventTarget | null;
				if (this.activeSliderContent && target && target instanceof HTMLElement) {
					const tag = target.tagName.toLowerCase();
					if (tag !== 'input' && tag !== 'textarea') {
						if (evt.key === "ArrowLeft") {
							const sliderWrapper = this.activeSliderContent.closest(".media-slider-wrapper");
							if (sliderWrapper) {
								const prevBtn = sliderWrapper.querySelector(".slider-btn.prev") as HTMLElement;
								if (prevBtn) {
									prevBtn.click();
									evt.preventDefault();
								}
							}
						} else if (evt.key === "ArrowRight") {
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
				}
			});

			document.addEventListener("click", (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				if (!target) return;
				const clickedSlider = target.closest(".slider-content");
				if (clickedSlider && !target.matches('input, textarea')) {
					this.activeSliderContent = clickedSlider as HTMLElement;
				}
			});

			this.keydownHandlerInitialized = true;
		}
	}

	private addZoomPanSupport(img: HTMLImageElement, container: HTMLElement): void {
		
		let scale = 1;
		let translateX = 0;
		let translateY = 0;
		let isDragging = false;
		let startX = 0;
		let startY = 0;
		let initialScale = 1;

		const minScale = 1;
		const maxScale = 5;

		
		const existingControls = container.querySelector(".zoom-controls");
		if (existingControls) {
			existingControls.remove();
		}

		
		const zoomControls = container.createEl("div", { cls: "zoom-controls" });

		
		const zoomInBtn = zoomControls.createEl("button", { cls: "zoom-btn" });
		setIcon(zoomInBtn, "zoom-in");

		
		const zoomOutBtn = zoomControls.createEl("button", { cls: "zoom-btn" });
		setIcon(zoomOutBtn, "zoom-out");

		
		const resetBtn = zoomControls.createEl("button", { cls: "zoom-btn" });
		setIcon(resetBtn, "refresh-cw");

		
		img.classList.add("can-zoom");

		
		img.addEventListener("dblclick", (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			
			if (scale > 1) {
				
				resetZoomPan();
			} else {
				
				const rect = img.getBoundingClientRect();
				
				
				const clickX = e.clientX - rect.left;
				const clickY = e.clientY - rect.top;
				
				
				const centerX = clickX / rect.width;
				const centerY = clickY / rect.height;
				
				
				scale = 1.25;
				
				
				
				translateX = -(centerX * rect.width * (scale - 1));
				translateY = -(centerY * rect.height * (scale - 1));
				
				applyTransform();
			}
		});

		
		const applyTransform = () => {
			img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
			img.classList.add("img-transformed");
		
			if (isDragging) {
				img.classList.add("dragging");
			} else {
				img.classList.remove("dragging");
			}
		
			
			zoomControls.style.opacity = scale > 1 ? "1" : "0.5";
			zoomOutBtn.disabled = scale <= minScale;
			resetBtn.disabled = scale <= minScale && translateX === 0 && translateY === 0;
		
			
			if (scale > 1) {
				img.classList.add("zoomed");
			} else {
				img.classList.remove("zoomed");
			}
		};

		
		const zoom = (delta: number, centerX: number, centerY: number) => {
			
			const rect = img.getBoundingClientRect();
			const imgCenterX = rect.left + rect.width / 2;
			const imgCenterY = rect.top + rect.height / 2;
		
			
			const offsetX = centerX - imgCenterX;
			const offsetY = centerY - imgCenterY;
		
			
			const oldScale = scale;
			scale = Math.max(minScale, Math.min(maxScale, scale + delta));
		
			
			if (scale !== oldScale) {
				
				if (delta > 0) {
					translateX -= offsetX * (scale / oldScale - 1);
					translateY -= offsetY * (scale / oldScale - 1);
				} else {
					
					translateX = translateX * (scale / oldScale);
					translateY = translateY * (scale / oldScale);
				}
			
				applyTransform();
				return true;
			}
			return false;
		};

		
		const resetZoomPan = () => {
			scale = 1;
			translateX = 0;
			translateY = 0;
			applyTransform();
		};

		
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

		
		container.addEventListener("wheel", (e: WheelEvent) => {
			
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				e.stopPropagation();
				const delta = e.deltaY < 0 ? 0.2 : -0.2;
				const rect = container.getBoundingClientRect();
				zoom(delta, e.clientX - rect.left, e.clientY - rect.top);
			}
		}, { passive: false });

		
		img.addEventListener("mousedown", (e: MouseEvent) => {
			if (scale > 1) {
				isDragging = true;
				startX = e.clientX - translateX;
				startY = e.clientY - translateY;
				e.preventDefault();
				e.stopPropagation();
			}
		});

		document.addEventListener("mousemove", (e: MouseEvent) => {
			if (isDragging) {
				translateX = e.clientX - startX;
				translateY = e.clientY - startY;
				applyTransform();
				e.preventDefault();
				e.stopPropagation();
			}
		});

		document.addEventListener("mouseup", (e: MouseEvent) => {
			if (isDragging) {
				isDragging = false;
				applyTransform();
				e.preventDefault();
				e.stopPropagation();
			}
		});

		
		img.addEventListener("touchstart", (e: TouchEvent) => {
			if (e.touches.length === 1 && scale > 1) {
				isDragging = true;
				startX = e.touches[0].clientX - translateX;
				startY = e.touches[0].clientY - translateY;
				e.preventDefault();
			} else if (e.touches.length === 2) {
				
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
				
				e.preventDefault();
				const touch1 = e.touches[0];
				const touch2 = e.touches[1];
			
				
				const currentDistance = Math.hypot(
					touch1.clientX - touch2.clientX,
					touch1.clientY - touch2.clientY
				);
			
				const centerX = (touch1.clientX + touch2.clientX) / 2;
				const centerY = (touch1.clientY + touch2.clientY) / 2;
			
				
				const newScale = Math.max(minScale, Math.min(maxScale, initialScale * (currentDistance / 150)));
			
				if (newScale !== scale) {
					scale = newScale;
					applyTransform();
				}
			}
		}, { passive: false });

		img.addEventListener("touchend", () => {
			isDragging = false;
			applyTransform(); 
		});

		
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

		
		new Setting(containerEl)
			.setName("Enable image compression")
			.setDesc("Toggle to enable/disable image compression globally. Can be overridden per slider in YAML.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCompression)
				.onChange(async (value) => {
					this.plugin.settings.enableCompression = value;
					await this.plugin.saveSettings();
					this.plugin.refreshSliders();
				})
			);

		
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
            
        
        new Setting(containerEl)
            .setName("Enable compare mode")
            .setDesc("Toggle to enable image comparison feature globally. Can be configured per slider in YAML.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCompareMode)
                .onChange(async (value) => {
                    this.plugin.settings.enableCompareMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSliders();
                })
            );
	}
}