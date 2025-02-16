export type DrawingTool = "freehand" | "line" | "rectangle" | "circle" | "eraser" | "laser";

export class DrawingAnnotation {
	private container: HTMLElement;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private toolbar: HTMLDivElement;
	private drawing: boolean = false;
	private startX: number = 0;
	private startY: number = 0;
	// The current tool (for freehand, eraser, laser) and for geometric tools.
	private currentTool: DrawingTool = "freehand";
	private currentGeometricTool: DrawingTool = "line";

	// Public drawing settings.
	public color: string = "#FF0000"; // default red
	public lineWidth: number = 2;

	constructor(container: HTMLElement) {
		this.container = container;

		// Create and append canvas overlay.
		this.canvas = document.createElement("canvas");
		this.canvas.style.position = "absolute";
		this.canvas.style.top = "0";
		this.canvas.style.left = "0";
		this.canvas.style.width = "100%";
		this.canvas.style.height = "100%";
		this.canvas.style.zIndex = "10";
		this.canvas.style.pointerEvents = "auto";
		this.container.appendChild(this.canvas);
		this.resizeCanvas();

		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Cannot get 2D context");
		this.ctx = ctx;

		// Create toolbar overlay.
		this.toolbar = document.createElement("div");
		// Center the toolbar at the top of the container.
		this.toolbar.style.position = "absolute";
		this.toolbar.style.top = "5px";
		this.toolbar.style.left = "50%";
		this.toolbar.style.transform = "translateX(-50%)";
		// Use dark background with 50% opacity and rounded corners.
		this.toolbar.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
		this.toolbar.style.borderRadius = "4px";
		this.toolbar.style.padding = "4px";
		this.toolbar.style.display = "flex";
		this.toolbar.style.gap = "4px";
		this.toolbar.style.zIndex = "20";
        this.toolbar.className = "drawing-toolbar";
		this.container.appendChild(this.toolbar);
		this.createToolbar();

		// Bind pointer events.
		this.enableDrawing();

		// Update canvas size on window resize.
		window.addEventListener("resize", this.resizeCanvasBound);
	}

	private resizeCanvasBound = (): void => {
		this.resizeCanvas();
	};

	private resizeCanvas(): void {
		this.canvas.width = this.container.clientWidth;
		this.canvas.height = this.container.clientHeight;
	}

	private resetToolbarHighlights(): void {
		// Set each button's background to the default dark style.
		Array.from(this.toolbar.children).forEach(child => {
			(child as HTMLElement).style.backgroundColor = "rgba(0, 0, 0, 0.5)";
		});
	}

	private createToolbar(): void {
		// Common button style.
		const btnStyle = {
			fontSize: "14px",
			background: "rgba(0, 0, 0, 0.5)",
			color: "#fff",
			border: "none",
			cursor: "pointer",
			padding: "4px",
			borderRadius: "4px"
		};

		// Helper to apply styles.
		const applyStyles = (el: HTMLElement, styles: { [key: string]: string }): void => {
			for (const key in styles) {
				el.style[key] = styles[key];
			}
		};

		// Freehand button.
		const freehandBtn = document.createElement("button");
		freehandBtn.textContent = "✏️";
		freehandBtn.title = "Freehand";
		applyStyles(freehandBtn, btnStyle);
		freehandBtn.onclick = () => {
			this.currentTool = "freehand";
			this.resetToolbarHighlights();
			freehandBtn.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
		};
		this.toolbar.appendChild(freehandBtn);

		// Geometric tools dropdown.
		const geomDropdown = document.createElement("details");
		geomDropdown.style.position = "relative";
		geomDropdown.style.display = "inline-block";
		geomDropdown.style.fontSize = "14px";
		geomDropdown.style.background = "rgba(0, 0, 0, 0.5)";
		geomDropdown.style.border = "none";
		geomDropdown.style.borderRadius = "4px";
		// Summary shows current geometric tool (default "line").
		const geomSummary = document.createElement("summary");
		geomSummary.textContent = "➖"; // default for line
		geomSummary.title = "Geometric Tools (Line, Rect, Circle)";
		geomSummary.style.listStyle = "none";
		geomSummary.style.cursor = "pointer";
		geomSummary.style.background = "transparent";
		geomSummary.style.color = "#fff";
		geomSummary.style.outline = "none";
		geomDropdown.appendChild(geomSummary);

		// Container for dropdown options.
		const geomOptions = document.createElement("div");
		geomOptions.style.display = "flex";
		geomOptions.style.flexDirection = "column";
		geomOptions.style.position = "absolute";
		geomOptions.style.top = "100%";
		geomOptions.style.left = "0";
		geomOptions.style.background = "rgba(0, 0, 0, 0.5)";
		geomOptions.style.border = "none";
		geomOptions.style.borderRadius = "4px";
		geomOptions.style.zIndex = "30";

		const geomTools: { tool: DrawingTool; icon: string; label: string }[] = [
			{ tool: "line", icon: "➖", label: "Line" },
			{ tool: "rectangle", icon: "▭", label: "Rectangle" },
			{ tool: "circle", icon: "◯", label: "Circle" },
		];

		geomTools.forEach(opt => {
			const btn = document.createElement("button");
			btn.textContent = opt.icon;
			btn.title = opt.label;
			applyStyles(btn, { fontSize: "14px", padding: "2px", border: "none", background: "transparent", color: "#fff", cursor: "pointer" });
			btn.onclick = (e) => {
				e.stopPropagation();
				this.currentTool = opt.tool;
				this.currentGeometricTool = opt.tool;
				geomSummary.textContent = opt.icon;
				geomDropdown.removeAttribute("open");
			};
			geomOptions.appendChild(btn);
		});
		geomDropdown.appendChild(geomOptions);
		this.toolbar.appendChild(geomDropdown);

		// Eraser button.
		const eraserBtn = document.createElement("button");
		eraserBtn.textContent = "🧽";
		eraserBtn.title = "Eraser";
		applyStyles(eraserBtn, btnStyle);
		eraserBtn.onclick = () => {
			this.currentTool = "eraser";
			this.resetToolbarHighlights();
			eraserBtn.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
		};
		this.toolbar.appendChild(eraserBtn);

		// Laser button.
		const laserBtn = document.createElement("button");
		laserBtn.textContent = "🔦";
		laserBtn.title = "Laser (temporary)";
		applyStyles(laserBtn, btnStyle);
		laserBtn.onclick = () => {
			this.currentTool = "laser";
			this.resetToolbarHighlights();
			laserBtn.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
		};
		this.toolbar.appendChild(laserBtn);

		// Color picker.
		const colorInput = document.createElement("input");
		colorInput.type = "color";
		colorInput.value = this.color;
		applyStyles(colorInput, { width: "30px", height: "30px", border: "none", cursor: "pointer" });
		colorInput.onchange = () => {
			this.color = colorInput.value;
		};
		this.toolbar.appendChild(colorInput);

		// Line width input.
		const widthInput = document.createElement("input");
		widthInput.type = "number";
		widthInput.min = "1";
		widthInput.max = "10";
		widthInput.value = this.lineWidth.toString();
		applyStyles(widthInput, { width: "40px", border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", textAlign: "center" });
		widthInput.onchange = () => {
			this.lineWidth = Number(widthInput.value);
		};
		this.toolbar.appendChild(widthInput);
	}

	private handlePointerDown = (e: PointerEvent): void => {
		this.drawing = true;
		this.startX = e.offsetX;
		this.startY = e.offsetY;
		// For freehand, eraser, and laser, begin a path immediately.
		if (this.currentTool === "freehand" || this.currentTool === "eraser" || this.currentTool === "laser") {
			this.ctx.beginPath();
			this.ctx.moveTo(this.startX, this.startY);
		}
	};

	private handlePointerMove = (e: PointerEvent): void => {
		if (!this.drawing) return;
		const currentX = e.offsetX;
		const currentY = e.offsetY;
		if (this.currentTool === "freehand") {
			this.ctx.strokeStyle = this.color;
			this.ctx.lineWidth = this.lineWidth;
			this.ctx.lineCap = "round";
			this.ctx.lineTo(currentX, currentY);
			this.ctx.stroke();
		} else if (this.currentTool === "laser") {
			this.ctx.strokeStyle = this.color;
			this.ctx.lineWidth = 1;
			this.ctx.lineCap = "round";
			this.ctx.shadowColor = this.color;
			this.ctx.shadowBlur = 10;
			this.ctx.lineTo(currentX, currentY);
			this.ctx.stroke();
			this.ctx.shadowBlur = 0;
		} else if (this.currentTool === "eraser") {
			this.ctx.globalCompositeOperation = "destination-out";
			this.ctx.lineWidth = this.lineWidth * 5;
			this.ctx.lineTo(currentX, currentY);
			this.ctx.stroke();
			this.ctx.globalCompositeOperation = "source-over";
		}
		// For geometric tools, drawing is deferred until pointer up.
	};

	private handlePointerUp = (e: PointerEvent): void => {
		if (!this.drawing) return;
		this.drawing = false;
		const endX = e.offsetX;
		const endY = e.offsetY;
		this.ctx.strokeStyle = this.currentTool === "eraser" ? "rgba(0,0,0,1)" : this.color;
		this.ctx.lineWidth = this.lineWidth;
		this.ctx.lineCap = "round";

		if (this.currentTool === "line") {
			this.ctx.beginPath();
			this.ctx.moveTo(this.startX, this.startY);
			this.ctx.lineTo(endX, endY);
			this.ctx.stroke();
		} else if (this.currentTool === "rectangle") {
			const rectWidth = endX - this.startX;
			const rectHeight = endY - this.startY;
			this.ctx.strokeRect(this.startX, this.startY, rectWidth, rectHeight);
		} else if (this.currentTool === "circle") {
			const radius = Math.sqrt(Math.pow(endX - this.startX, 2) + Math.pow(endY - this.startY, 2));
			this.ctx.beginPath();
			this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
			this.ctx.stroke();
		} else if (this.currentTool === "laser") {
			// For laser, clear the drawn line after a brief delay.
			setTimeout(() => {
				this.clear();
			}, 200);
		}
		// For freehand and eraser, nothing extra is needed.
	};

	public enableDrawing(): void {
		this.canvas.addEventListener("pointerdown", this.handlePointerDown);
		this.canvas.addEventListener("pointermove", this.handlePointerMove);
		this.canvas.addEventListener("pointerup", this.handlePointerUp);
		this.canvas.addEventListener("pointerout", this.handlePointerUp);
	}

	public disableDrawing(): void {
		this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
		this.canvas.removeEventListener("pointermove", this.handlePointerMove);
		this.canvas.removeEventListener("pointerup", this.handlePointerUp);
		this.canvas.removeEventListener("pointerout", this.handlePointerUp);
	}

	public clear(): void {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	public getAnnotation(): string {
		return this.canvas.toDataURL("image/png");
	}

	public destroy(): void {
		window.removeEventListener("resize", this.resizeCanvasBound);
		this.disableDrawing();
		if (this.toolbar.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
		if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
	}
}
