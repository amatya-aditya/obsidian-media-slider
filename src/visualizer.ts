export interface VisualizerOptions {
	/** Height of the visualizer canvas (e.g., "80px") */
	height?: string;
	/** Select the gradient type: "blue-red", "rainbow", or "custom" */
	gradientType?: "blue-red" | "rainbow" | "custom";
	/** If using a custom gradient, supply an array of CSS color strings */
	customColors?: string[];
}

export class Visualizer {
	private mediaElement: HTMLMediaElement;
	private container: HTMLElement;
	private options: VisualizerOptions;
	private canvas: HTMLCanvasElement;
	private canvasCtx: CanvasRenderingContext2D;
	private audioContext: AudioContext;
	private analyser: AnalyserNode;
	private source: MediaElementAudioSourceNode;
	private animationFrameId: number;

	constructor(mediaElement: HTMLMediaElement, container: HTMLElement, options: VisualizerOptions = {}) {
		this.mediaElement = mediaElement;
		this.container = container;
		// Default options: increased height, rainbow gradient.
		this.options = {
			height: options.height ?? "100px",
			gradientType: options.gradientType ?? "blue-red",
			customColors: options.customColors
		};

		// Create a canvas overlay.
		this.canvas = document.createElement("canvas");
		this.canvas.style.position = "absolute";
		this.canvas.style.bottom = "0";
		this.canvas.style.left = "0";
		this.canvas.style.width = "100%";
		this.canvas.style.height = this.options.height ?? "80px";
		this.canvas.style.pointerEvents = "none";
		this.canvas.style.zIndex = "100";
		// Set explicit dimensions.
		this.canvas.width = container.clientWidth;
		this.canvas.height = parseInt(this.options.height ?? "80", 10);
		this.canvasCtx = this.canvas.getContext("2d")!;
		container.appendChild(this.canvas);

		// Set up the audio context and analyser.
		this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		this.source = this.audioContext.createMediaElementSource(this.mediaElement);
		this.analyser = this.audioContext.createAnalyser();
		// Increase resolution and responsiveness.
		this.analyser.fftSize = 512;
		this.analyser.smoothingTimeConstant = 0.05;
		this.analyser.minDecibels = -100;
		this.analyser.maxDecibels = -30;
		this.source.connect(this.analyser);
		this.analyser.connect(this.audioContext.destination);

		this.animationFrameId = 0;
		this.draw();
	}

	private draw() {
		const bufferLength = this.analyser.frequencyBinCount;
		const dataArray = new Uint8Array(bufferLength);
		// Mirror the left and right halves for symmetry.
		const halfBins = Math.floor(bufferLength / 2);
		const gap = 2; // Gap between bars.
		const canvasWidth = this.canvas.width;
		const canvasHeight = this.canvas.height;
		const midX = canvasWidth / 2;
		// Set baseline at vertical center.
		const baseline = canvasHeight / 2;
		// Calculate the width available on one side.
		const slotWidth = midX / halfBins;
		// Use 60% of the slot width for a thin bar.
		const barWidth = slotWidth * 0.6;
		
		const drawBars = () => {
			this.analyser.getByteFrequencyData(dataArray);
			this.canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);
			
			for (let i = 0; i < halfBins; i++) {
				// Get normalized intensity and accentuate differences.
				const rawIntensity = dataArray[i] / 255;
				const intensity = Math.pow(rawIntensity, 2);
				// Bar height: maximum height is the distance from baseline to top.
				const barHeight = intensity * baseline;
				
				// Build a gradient from the baseline upward.
				let gradient: CanvasGradient;
				if (this.options.gradientType === "blue-red") {
					gradient = this.canvasCtx.createLinearGradient(0, baseline, 0, baseline - barHeight);
					gradient.addColorStop(0, "hsl(240,80%,40%)");
					gradient.addColorStop(1, "hsl(0,90%,50%)");
				} else if (this.options.gradientType === "rainbow") {
					gradient = this.canvasCtx.createLinearGradient(0, baseline, 0, baseline - barHeight);
					gradient.addColorStop(0, "hsl(240,100%,50%)");  // blue
					gradient.addColorStop(0.25, "hsl(180,100%,50%)"); // cyan
					gradient.addColorStop(0.5, "hsl(120,100%,50%)");  // green
					gradient.addColorStop(0.75, "hsl(60,100%,50%)");  // yellow
					gradient.addColorStop(1, "hsl(0,100%,50%)");      // red
				} else if (this.options.gradientType === "custom" && this.options.customColors && this.options.customColors.length > 0) {
					gradient = this.canvasCtx.createLinearGradient(0, baseline, 0, baseline - barHeight);
					const n = this.options.customColors.length;
					for (let j = 0; j < n; j++) {
						gradient.addColorStop(j / (n - 1), this.options.customColors[j]);
					}
				} else {
					// Fallback to rainbow.
					gradient = this.canvasCtx.createLinearGradient(0, baseline, 0, baseline - barHeight);
					gradient.addColorStop(0, "hsl(240,100%,50%)");
					gradient.addColorStop(0.25, "hsl(180,100%,50%)");
					gradient.addColorStop(0.5, "hsl(120,100%,50%)");
					gradient.addColorStop(0.75, "hsl(60,100%,50%)");
					gradient.addColorStop(1, "hsl(0,100%,50%)");
				}
				
				// Determine x positions for symmetric bars.
				const xRight = midX + i * (barWidth + gap);
				const xLeft = midX - (i + 1) * (barWidth + gap);
				
				// Draw bars rising upward from the baseline.
				this.canvasCtx.fillStyle = gradient;
				this.canvasCtx.fillRect(xRight, baseline - barHeight, barWidth, barHeight);
				this.canvasCtx.fillRect(xLeft, baseline - barHeight, barWidth, barHeight);
			}
			this.animationFrameId = requestAnimationFrame(drawBars);
		};
		drawBars();
	}

	public destroy() {
		cancelAnimationFrame(this.animationFrameId);
		this.canvas.remove();
		this.source.disconnect();
		this.analyser.disconnect();
		if (this.audioContext.state !== "closed") {
			this.audioContext.close();
		}
	}
}
