import { Plugin, MarkdownPostProcessorContext, TFile, MarkdownRenderer } from "obsidian";
import { compressImage } from "./compression";
import { NotesManager } from "./notes";

export default class MediaSliderPlugin extends Plugin {
    // Caches for resource paths and markdown content.
    private filePathCache: Map<string, string> = new Map();
    private markdownCache: Map<string, string> = new Map();
    // Persistent notes manager.
    private notesManager: NotesManager;
    // Counter for generating unique slider IDs when one is not provided.
    private static sliderCounter = 0;

    async onload() {
        console.log("Loading Media Slider Plugin...");
        this.notesManager = new NotesManager(this);
        await this.notesManager.load();
        this.registerMarkdownCodeBlockProcessor("media-slider", (source, el, ctx) => {
            this.createMediaSlider(source, el, ctx);
        });
    }

    // A simple YAML parser.
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

    // Caching function for resource paths.
    private getCachedResourcePath(fileName: string): string {
        if (this.filePathCache.has(fileName)) {
            return this.filePathCache.get(fileName)!;
        }
        const path = this.app.vault.adapter.getResourcePath(fileName);
        this.filePathCache.set(fileName, path);
        return path;
    }

    // Returns the media source URL, supporting online URLs.
    private getMediaSource(fileName: string): string {
        if (fileName.startsWith("http://") || fileName.startsWith("https://")) {
            return fileName;
        }
        return this.getCachedResourcePath(fileName);
    }

    // Caching function for Markdown file content.
    private async getMarkdownContent(fileName: string): Promise<string> {
        if (this.markdownCache.has(fileName)) {
            return this.markdownCache.get(fileName)!;
        }
        const mdFile = this.app.vault.getAbstractFileByPath(fileName) as TFile;
        if (mdFile) {
            const content = await this.app.vault.read(mdFile);
            this.markdownCache.set(fileName, content);
            return content;
        }
        return "";
    }

    // Throttle helper to limit rapid function calls.
    private throttle<T extends (...args: any[]) => any>(fn: T, delay: number): T {
        let lastCall = 0;
        return ((...args: any[]) => {
            const now = Date.now();
            if (now - lastCall < delay) return;
            lastCall = now;
            return fn(...args);
        }) as T;
    }

    // Create the media slider.
    private createMediaSlider(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        // Parse YAML front matter.
        const metadataMatch = source.match(/---\n([\s\S]+?)\n---/);
        // Read the remaining content.
        const mediaContent = source.replace(/---\n[\s\S]+?\n---/, "").trim();
        const mediaFiles = mediaContent.split("\n").map(line => line.trim()).filter(Boolean);

        // Default settings. Note the optional "sliderId" parameter.
        let settings: any = {
            sliderId: "",                 // Optional: Provide a unique identifier to persist notes across sessions.
            carouselShowThumbnails: true,
            thumbnailPosition: "bottom",  // Options: "top", "bottom", "left", "right"
            captionMode: "below",         // Options: "below", "overlay"
            autoplay: false,
            slideshowSpeed: 5,            // Seconds; set to 0 to disable auto-advance
            width: "100%",
            height: "300px",
            transitionEffect: "fade",     // Options: "fade", "slide", "zoom"
            transitionDuration: 500,      // Milliseconds
            enhancedView: false,          // Fullscreen toggle if true
            interactiveNotes: false       // Interactive notes if true
        };

        if (metadataMatch) {
            try {
                const parsedSettings = this.parseSimpleYAML(metadataMatch[1]);
                settings = Object.assign(settings, parsedSettings);
            } catch (error) {
                console.error("Failed to parse media-slider metadata:", error);
            }
        }

        // Use provided sliderId if available; otherwise, use an auto-generated one.
        let sliderId = settings.sliderId;
        if (!sliderId) {
            // Warning: Without a stable sliderId, notes may not persist between sessions.
            sliderId = `slider-${MediaSliderPlugin.sliderCounter++}`;
        }

        // Process media links; supports both Obsidian-style ![[...]] and Markdown image syntax ![](...)
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

        // Clean up any notes for this slider that are no longer relevant.
        this.notesManager.cleanupNotesForSlider(sliderId, validFiles).catch(console.error);

        this.renderSlider(el, validFiles, settings, sliderId);
    }

    // Render the slider UI.
    private renderSlider(container: HTMLElement, files: string[], settings: any, sliderId: string) {
        container.empty();

        // Main wrapper.
        const sliderWrapper = container.createDiv("media-slider-wrapper");
        sliderWrapper.style.position = "relative";
        if (settings.carouselShowThumbnails && (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right")) {
            sliderWrapper.classList.add("flex-row");
        } else {
            sliderWrapper.style.display = "flex";
            sliderWrapper.style.flexDirection = "column";
            sliderWrapper.style.alignItems = "center";
        }

        // Slider content container.
        const sliderContent = sliderWrapper.createDiv("slider-content");
        sliderContent.style.position = "relative";
        sliderContent.style.display = "flex";
        sliderContent.style.flexDirection = "column";
        sliderContent.style.alignItems = "center";
        sliderContent.style.width = settings.width;

        // Media container with transition support.
        const sliderContainer = sliderContent.createDiv("slider-container");
        sliderContainer.style.width = settings.width;
        sliderContainer.style.height = settings.height;
        sliderContainer.style.opacity = "1";

        // Caption container.
        const captionContainer = sliderContent.createDiv("slider-caption-container");

        // Thumbnail container.
        let thumbnailContainer: HTMLElement | null = null;
        let thumbnailEls: HTMLElement[] = [];
        if (settings.carouselShowThumbnails) {
            thumbnailContainer = document.createElement("div");
            thumbnailContainer.className = "thumbnail-container";
            if (settings.thumbnailPosition === "left" || settings.thumbnailPosition === "right") {
                thumbnailContainer.classList.add("vertical");
                thumbnailContainer.style.height = settings.height;
                thumbnailContainer.style.overflowY = "auto";
            } else {
                thumbnailContainer.classList.add("horizontal");
                thumbnailContainer.style.width = settings.width;
                thumbnailContainer.style.overflowX = "auto";
                thumbnailContainer.style.whiteSpace = "nowrap";
                thumbnailContainer.style.margin = "10px 0";
            }
            if (settings.thumbnailPosition === "top" || settings.thumbnailPosition === "left") {
                sliderWrapper.insertBefore(thumbnailContainer, sliderContent);
            } else if (settings.thumbnailPosition === "bottom" || settings.thumbnailPosition === "right") {
                sliderWrapper.appendChild(thumbnailContainer);
            }
        }

        // Enhanced viewing: Fullscreen toggle.
        if (settings.enhancedView) {
            const fullScreenBtn = sliderWrapper.createEl("button", { text: "⛶", cls: "fullscreen-btn" });
            fullScreenBtn.style.position = "absolute";
            fullScreenBtn.style.top = "10px";
            fullScreenBtn.style.right = "10px";
            fullScreenBtn.onclick = () => {
                if (!document.fullscreenElement) {
                    sliderWrapper.requestFullscreen().catch(err => console.error("Error enabling fullscreen:", err));
                } else {
                    document.exitFullscreen();
                }
            };
        }

        // Adjust height when in fullscreen.
        sliderWrapper.addEventListener("fullscreenchange", () => {
            if (document.fullscreenElement === sliderWrapper) {
                sliderContainer.style.height = "85vh";
            } else {
                sliderContainer.style.height = settings.height;
            }
        });

        // Interactive notes: Toggle button remains visible.
        let notesContainer: HTMLElement | null = null;
        let notesTextarea: HTMLTextAreaElement | null = null;
        let notesToggleBtn: HTMLElement | null = null;
        if (settings.interactiveNotes) {
            notesToggleBtn = sliderWrapper.createEl("button", { text: "📝", cls: "notes-toggle-btn" });
            notesToggleBtn.style.position = "absolute";
            notesToggleBtn.style.top = "10px";
            notesToggleBtn.style.left = "10px";
            notesToggleBtn.onclick = () => {
                if (notesContainer) {
                    notesContainer.style.display = notesContainer.style.display === "block" ? "none" : "block";
                    const mediaKey = `${sliderId}-${files[currentIndex]}`;
                    if (notesContainer.style.display === "block" && notesTextarea) {
                        notesTextarea.value = this.notesManager.getNote(mediaKey);
                    }
                }
            };

            notesContainer = sliderWrapper.createDiv("notes-container");
            notesContainer.style.position = "absolute";
            notesContainer.style.bottom = "10px";
            notesContainer.style.left = "10px";
            notesContainer.style.width = "calc(100% - 20px)";
            notesContainer.style.background = "rgba(255,255,255,0.8)";
            notesContainer.style.padding = "5px";
            notesContainer.style.display = "none";

            notesTextarea = document.createElement("textarea");
            notesTextarea.style.width = "100%";
            notesTextarea.style.height = "60px";
            notesTextarea.placeholder = "Add your notes here...";
            notesContainer.appendChild(notesTextarea);

            const saveNotesBtn = document.createElement("button");
            saveNotesBtn.textContent = "Save Notes";
            saveNotesBtn.className = "notes-save-btn";
            saveNotesBtn.style.marginTop = "5px";
            saveNotesBtn.onclick = async () => {
                const mediaKey = `${sliderId}-${files[currentIndex]}`;
                if (notesTextarea) {
                    await this.notesManager.setNote(mediaKey, notesTextarea.value);
                }
                if (notesContainer) notesContainer.style.display = "none";
            };
            notesContainer.appendChild(saveNotesBtn);
        }

        container.appendChild(sliderWrapper);

        // Navigation buttons.
        const prevBtn = sliderContent.createEl("button", { text: "⮜", cls: "slider-btn prev" });
        const nextBtn = sliderContent.createEl("button", { text: "⮞", cls: "slider-btn next" });
        prevBtn.style.position = "absolute";
        nextBtn.style.position = "absolute";
        prevBtn.style.top = "50%";
        nextBtn.style.top = "50%";
        prevBtn.style.left = "10px";
        nextBtn.style.right = "10px";
        prevBtn.style.transform = "translateY(-50%)";
        nextBtn.style.transform = "translateY(-50%)";

        let currentIndex = 0;
        let currentDirection: "next" | "prev" = "next";

        const updateMediaDisplay = async () => {
            switch (settings.transitionEffect) {
                case "fade":
                    sliderContainer.style.transition = `opacity ${settings.transitionDuration}ms ease-in-out`;
                    sliderContainer.style.opacity = "0";
                    break;
                case "slide":
                    sliderContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;
                    sliderContainer.style.transform = currentDirection === "next" ? "translateX(-100%)" : "translateX(100%)";
                    break;
                case "zoom":
                    sliderContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out, opacity ${settings.transitionDuration}ms ease-in-out`;
                    sliderContainer.style.transform = "scale(0.8)";
                    sliderContainer.style.opacity = "0";
                    break;
                default:
                    sliderContainer.style.transition = `opacity ${settings.transitionDuration}ms ease-in-out`;
                    sliderContainer.style.opacity = "0";
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
                } else if (/\.(pdf)$/i.test(fileName)) {
                    const iframe = sliderContainer.createEl("iframe", { attr: { src: filePath, width: "100%", height: "100%" } });
                    iframe.style.border = "none";
                    iframe.classList.add("slider-media");
                } else if (/\.(md)$/i.test(fileName)) {
                    const mdFile = this.app.vault.getAbstractFileByPath(fileName) as TFile;
                    if (mdFile) {
                        const content = await this.getMarkdownContent(fileName);
                        sliderContainer.empty();
                        await MarkdownRenderer.renderMarkdown(content, sliderContainer, mdFile.path, this);
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

                switch (settings.transitionEffect) {
                    case "fade":
                        sliderContainer.style.opacity = "1";
                        break;
                    case "slide":
                        sliderContainer.style.transform = currentDirection === "next" ? "translateX(100%)" : "translateX(-100%)";
                        sliderContainer.offsetHeight; // Force reflow.
                        sliderContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;
                        sliderContainer.style.transform = "translateX(0)";
                        break;
                    case "zoom":
                        sliderContainer.style.transform = "scale(1)";
                        sliderContainer.style.opacity = "1";
                        break;
                    default:
                        sliderContainer.style.opacity = "1";
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
        sliderContent.style.outline = "none";
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

        // Render thumbnails.
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
                    // Set dimensions to match image thumbnails.
                    // thumbEl.style.width = "80px";
                    // thumbEl.style.height = "80px";
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
