// drawing.ts
export type DrawingTool = "freehand" | "line" | "rectangle" | "circle" | "eraser" | "laser";

import { setIcon } from "obsidian";

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

	private previewImageData: ImageData | null = null;

	constructor(container: HTMLElement) {
		this.container = container;

		// Create and append canvas overlay.
		this.canvas = document.createElement("canvas");
		// Apply styling via CSS class.
		this.canvas.classList.add("drawing-canvas");
		this.container.appendChild(this.canvas);
		this.resizeCanvas();

		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Cannot get 2D context");
		this.ctx = ctx;

		// Create toolbar overlay.
		this.toolbar = document.createElement("div");
		// Apply styling via CSS class.
		this.toolbar.classList.add("drawing-toolbar");
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
		// Remove active class from each button.
		Array.from(this.toolbar.children).forEach(child => {
			(child as HTMLElement).classList.remove("active-tool");
		});
	}

	private createToolbar(): void {
		// Freehand button.
		const freehandBtn = document.createElement("button");
		freehandBtn.textContent = "";
		setIcon(freehandBtn, "pencil");
		freehandBtn.title = "Freehand";
		freehandBtn.classList.add("drawing-btn", "freehand-btn");
		freehandBtn.onclick = () => {
			this.currentTool = "freehand";
			this.resetToolbarHighlights();
			freehandBtn.classList.add("active-tool");
			sizeSlider.value = this.lineWidth.toString();
			sizeNumber.value = this.lineWidth.toString();
			sizeSlider.style.display = '';
			sizeNumber.style.display = '';
		};
		this.toolbar.appendChild(freehandBtn);

		// Geometric tool buttons (inline)
		const lineBtn = document.createElement("button");
		lineBtn.textContent = "";
		setIcon(lineBtn, "slash");
		lineBtn.title = "Line";
		lineBtn.classList.add("drawing-btn", "line-btn");
		lineBtn.onclick = () => {
			this.currentTool = "line";
			this.currentGeometricTool = "line";
			this.resetToolbarHighlights();
			lineBtn.classList.add("active-tool");
			sizeSlider.value = this.lineWidth.toString();
			sizeNumber.value = this.lineWidth.toString();
			sizeSlider.style.display = '';
			sizeNumber.style.display = '';
		};
		this.toolbar.appendChild(lineBtn);

		const rectBtn = document.createElement("button");
		rectBtn.textContent = "";
		setIcon(rectBtn, "square");
		rectBtn.title = "Rectangle";
		rectBtn.classList.add("drawing-btn", "rect-btn");
		rectBtn.onclick = () => {
			this.currentTool = "rectangle";
			this.currentGeometricTool = "rectangle";
			this.resetToolbarHighlights();
			rectBtn.classList.add("active-tool");
			sizeSlider.value = this.lineWidth.toString();
			sizeNumber.value = this.lineWidth.toString();
			sizeSlider.style.display = '';
			sizeNumber.style.display = '';
		};
		this.toolbar.appendChild(rectBtn);

		const circleBtn = document.createElement("button");
		circleBtn.textContent = "";
		setIcon(circleBtn, "circle");
		circleBtn.title = "Circle";
		circleBtn.classList.add("drawing-btn", "circle-btn");
		circleBtn.onclick = () => {
			this.currentTool = "circle";
			this.currentGeometricTool = "circle";
			this.resetToolbarHighlights();
			circleBtn.classList.add("active-tool");
			sizeSlider.value = this.lineWidth.toString();
			sizeNumber.value = this.lineWidth.toString();
			sizeSlider.style.display = '';
			sizeNumber.style.display = '';
		};
		this.toolbar.appendChild(circleBtn);

		// Eraser button.
		const eraserBtn = document.createElement("button");
		eraserBtn.textContent = "";
		setIcon(eraserBtn, "eraser");
		eraserBtn.title = "Eraser";
		eraserBtn.classList.add("drawing-btn", "eraser-btn");
		eraserBtn.onclick = () => {
			this.currentTool = "eraser";
			this.resetToolbarHighlights();
			eraserBtn.classList.add("active-tool");
			sizeSlider.value = this.lineWidth.toString();
			sizeNumber.value = this.lineWidth.toString();
			sizeSlider.style.display = '';
			sizeNumber.style.display = '';
		};
		this.toolbar.appendChild(eraserBtn);

		// Laser button.
		const laserBtn = document.createElement("button");
		laserBtn.textContent = "";
		setIcon(laserBtn, "activity");
		laserBtn.title = "Laser (temporary)";
		laserBtn.classList.add("drawing-btn", "laser-btn");
		laserBtn.onclick = () => {
			this.currentTool = "laser";
			this.resetToolbarHighlights();
			laserBtn.classList.add("active-tool");
			sizeSlider.style.display = 'none';
			sizeNumber.style.display = 'none';
		};
		this.toolbar.appendChild(laserBtn);

		// Color picker.
		const colorInput = document.createElement("input");
		colorInput.type = "color";
		colorInput.value = this.color;
		colorInput.classList.add("drawing-color-input");
		colorInput.onchange = () => {
			this.color = colorInput.value;
		};
		this.toolbar.appendChild(colorInput);

		// Line width number input.
		const sizeNumber = document.createElement("input");
		sizeNumber.type = "number";
		sizeNumber.min = "1";
		sizeNumber.max = "30";
		sizeNumber.value = this.lineWidth.toString();
		sizeNumber.classList.add("drawing-linewidth-input");
		sizeNumber.onchange = () => {
			this.lineWidth = Number(sizeNumber.value);
			sizeSlider.value = sizeNumber.value;
		};
		this.toolbar.appendChild(sizeNumber);

		// Add a slider for size
		const sizeSlider = document.createElement('input');
		sizeSlider.type = 'range';
		sizeSlider.min = '1';
		sizeSlider.max = '30';
		sizeSlider.value = this.lineWidth.toString();
		sizeSlider.className = 'drawing-size-slider';
		sizeSlider.oninput = (e) => {
			const val = (e.target as HTMLInputElement).value;
			this.lineWidth = Number(val);
			sizeNumber.value = val;
		};
		this.toolbar.appendChild(sizeSlider);
	}

	private handlePointerDown = (e: PointerEvent): void => {
		this.drawing = true;
		this.startX = e.offsetX;
		this.startY = e.offsetY;
		if (this.currentTool === "rectangle" || this.currentTool === "circle" || this.currentTool === "line") {
			this.previewImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
		}
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
		if (this.currentTool === "rectangle" || this.currentTool === "circle" || this.currentTool === "line") {
			if (this.previewImageData) {
				this.ctx.putImageData(this.previewImageData, 0, 0);
			}
			this.ctx.strokeStyle = this.color;
			this.ctx.lineWidth = this.lineWidth;
			this.ctx.lineCap = "round";
			if (this.currentTool === "rectangle") {
				const rectWidth = currentX - this.startX;
				const rectHeight = currentY - this.startY;
				this.ctx.strokeRect(this.startX, this.startY, rectWidth, rectHeight);
			} else if (this.currentTool === "circle") {
				const radius = Math.sqrt(Math.pow(currentX - this.startX, 2) + Math.pow(currentY - this.startY, 2));
				this.ctx.beginPath();
				this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
				this.ctx.stroke();
			} else if (this.currentTool === "line") {
				this.ctx.beginPath();
				this.ctx.moveTo(this.startX, this.startY);
				this.ctx.lineTo(currentX, currentY);
				this.ctx.stroke();
			}
			return;
		}
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
			this.ctx.lineWidth = this.lineWidth;
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

		if (this.currentTool === "rectangle") {
			if (this.previewImageData) {
				this.ctx.putImageData(this.previewImageData, 0, 0);
				this.previewImageData = null;
			}
			const rectWidth = endX - this.startX;
			const rectHeight = endY - this.startY;
			this.ctx.strokeRect(this.startX, this.startY, rectWidth, rectHeight);
		} else if (this.currentTool === "circle") {
			if (this.previewImageData) {
				this.ctx.putImageData(this.previewImageData, 0, 0);
				this.previewImageData = null;
			}
			const radius = Math.sqrt(Math.pow(endX - this.startX, 2) + Math.pow(endY - this.startY, 2));
			this.ctx.beginPath();
			this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
			this.ctx.stroke();
		} else if (this.currentTool === "line") {
			if (this.previewImageData) {
				this.ctx.putImageData(this.previewImageData, 0, 0);
				this.previewImageData = null;
			}
			this.ctx.beginPath();
			this.ctx.moveTo(this.startX, this.startY);
			this.ctx.lineTo(endX, endY);
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
